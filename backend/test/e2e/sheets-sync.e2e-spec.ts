import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { generateKeyPairSync } from 'crypto';
import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { SheetsSyncService } from '../../src/modules/sheets-sync/sheets-sync.service';

/**
 * /api/admin/sheets-sync — сервер читает Google-таблицы через сервисный аккаунт.
 * Google подменён заглушкой (fetchFn): токен, метаданные таблицы, значения листов.
 * Проверяем: без дублей при повторе, правка ячейки, удаление строки, защита от очистки,
 * записи приложения не трогаются, позиция склада из приложения подхватывается по имени.
 */
describe('Sheets sync (Google service account)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  let sync: SheetsSyncService;
  const SID = 'TEST_SHEET_1234567890abcdefghij';

  // Состояние «Google-таблицы»
  let supply: unknown[][];
  let stock: unknown[][];
  let shared = true;

  const fakeGoogle: typeof fetch = async (input) => {
    const url = String(input);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('oauth2')) return json(200, { access_token: 'fake', expires_in: 3600 });
    if (!shared) return json(403, { error: { message: 'The caller does not have permission' } });
    if (url.includes('values:batchGet')) {
      const ranges = new URL(url).searchParams.getAll('ranges');
      return json(200, { valueRanges: ranges.map((r) => ({ values: r.includes('Склад') ? stock : supply })) });
    }
    return json(200, { properties: { title: 'Снабжение и склад (тест)' }, sheets: [{ properties: { title: 'Снабжение' } }, { properties: { title: 'Склад' } }, { properties: { title: 'Прочее' } }] });
  };

  const db = () => ctx!.connection.db!;
  const live = (c: string) => db().collection(c).find({ deletedAt: null }).toArray();
  const run = () => request(app.getHttpServer()).post('/api/admin/sheets-sync/run').set(authHeader(token.access)).expect(200);

  beforeAll(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gsa-'));
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
    process.env.GOOGLE_SA_FILE = join(dir, 'google-sa.json');
    writeFileSync(process.env.GOOGLE_SA_FILE, JSON.stringify({ client_email: 'robot@test.iam.gserviceaccount.com', private_key: privateKey, token_uri: 'https://oauth2.googleapis.com/token' }));

    ctx = await createTestApp();
    app = ctx.app;
    sync = app.get(SheetsSyncService);
    sync.fetchFn = fakeGoogle;
    token = await loginAsAdmin(app);
    for (const c of ['app_supply_requests', 'app_warehouse_items', 'sheets_sync_sources']) await db().collection(c).deleteMany({});

    const head = ['№', 'Дата', 'Наименование', 'Кол-во', 'Статус', 'Фото'];
    supply = [head, ...Array.from({ length: 10 }, (_, i) => [i + 1, '18.10.2026', `Заявка ${i + 1}`, i + 1, '✅ Заказать', '=IMAGE(x)'])];
    stock = [['Склад'], [], [], [], [], ['Категория', 'Наименование ТМЦ', 'Ед. изм.', 'Текущий остаток'], ['Метизы', 'Болт М8', 'шт', 50], ['Метизы', 'Гайка М8', 'шт', 30]];
  });

  afterAll(async () => {
    delete process.env.GOOGLE_SA_FILE;
    await ctx?.cleanup();
  });

  it('статус: ключ найден, показан адрес сервисного аккаунта', async () => {
    const r = await request(app.getHttpServer()).get('/api/admin/sheets-sync').set(authHeader(token.access)).expect(200);
    expect(r.body.configured).toBe(true);
    expect(r.body.serviceEmail).toBe('robot@test.iam.gserviceaccount.com');
  });

  it('без админа — 401', async () => {
    await request(app.getHttpServer()).get('/api/admin/sheets-sync').expect(401);
  });

  it('нет доступа к таблице → понятная ошибка с адресом робота', async () => {
    shared = false;
    const r = await request(app.getHttpServer()).post('/api/admin/sheets-sync/sources').set(authHeader(token.access)).send({ url: `https://docs.google.com/spreadsheets/d/${SID}/edit#gid=0` }).expect(400);
    expect(r.body.message).toContain('robot@test.iam.gserviceaccount.com');
    shared = true;
  });

  it('подключение по ссылке находит листы', async () => {
    const r = await request(app.getHttpServer()).post('/api/admin/sheets-sync/sources').set(authHeader(token.access)).send({ url: `https://docs.google.com/spreadsheets/d/${SID}/edit#gid=0` }).expect(201);
    expect(r.body.spreadsheetId).toBe(SID);
    expect(r.body.sheetsFound).toEqual(['Снабжение', 'Склад']);
  });

  it('позиция склада из приложения подхватывается по имени, заявка из приложения не трогается', async () => {
    await db().collection('app_warehouse_items').insertOne({ uid: 'app-bolt', name: 'болт м8 ', photos: [{ url: '/uploads/b.webp' }], deletedAt: null });
    await db().collection('app_supply_requests').insertOne({ uid: 'app-req', name: 'Из приложения', deletedAt: null });

    const r = await run();
    expect(r.body.items[0].error).toBeNull();
    expect(r.body.items[0].lines).toEqual([
      'Снабжение: строк 10, новых 10, изменено 0, удалено 0',
      'Склад: строк 2, новых 1, изменено 0, связано с приложением 1, удалено 0',
    ]);
    const reqs = await live('app_supply_requests');
    expect(reqs).toHaveLength(11);
    const r1 = reqs.find((d) => d.num === 1)!;
    expect(r1).toMatchObject({ date: '2026-10-18', name: 'Заявка 1', qty: 1, source: 'google-sheets' });
    expect(r1.foto).toBeUndefined();
    expect(typeof r1.uid).toBe('string');
    const bolt = (await live('app_warehouse_items')).find((d) => d.uid === 'app-bolt')!;
    expect(bolt).toMatchObject({ name: 'Болт М8', currentQty: 50, photos: [{ url: '/uploads/b.webp' }] });
  });

  it('повтор — без изменений и без дублей', async () => {
    const r = await run();
    expect(r.body.items[0].lines[0]).toBe('Снабжение: строк 10, новых 0, изменено 0, удалено 0');
    expect(r.body.items[0].lines[1]).toBe('Склад: строк 2, новых 0, изменено 0, удалено 0');
    expect(await live('app_supply_requests')).toHaveLength(11);
  });

  it('правка ячейки, очистка ячейки и удаление строки', async () => {
    supply[1][3] = 99; // Кол-во заявки №1
    supply[2][4] = ''; // Статус заявки №2 очищен
    supply.splice(10, 1); // удалена заявка №10
    const r = await run();
    expect(r.body.items[0].lines[0]).toBe('Снабжение: строк 9, новых 0, изменено 2, удалено 1');
    const reqs = await live('app_supply_requests');
    expect(reqs.find((d) => d.num === 1)!.qty).toBe(99);
    expect(reqs.find((d) => d.num === 2)!.status).toBeUndefined();
    expect(reqs.find((d) => d.num === 10)).toBeUndefined();
    expect(reqs.find((d) => d.uid === 'app-req')).toBeDefined(); // запись приложения цела
  });

  it('лист очистили по ошибке — массовое удаление не выполняется', async () => {
    supply = [supply[0]];
    const r = await run();
    expect(r.body.items[0].lines[0]).toContain('⚠️ удаление 9 записей пропущено');
    expect(await live('app_supply_requests')).toHaveLength(10);
  });
});
