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
  const invoices: unknown[][] = [['№', 'Поставщик', 'Наименование'], [1, 'ООО Крепёж', 'Счёт на болты']];
  let shared = true;

  const fakeGoogle: typeof fetch = async (input) => {
    const url = String(input);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('oauth2')) return json(200, { access_token: 'fake', expires_in: 3600 });
    if (!shared) return json(403, { error: { message: 'The caller does not have permission' } });
    if (url.includes('values:batchGet')) {
      const ranges = new URL(url).searchParams.getAll('ranges');
      return json(200, { valueRanges: ranges.map((r) => ({ values: r.includes('Склад') ? stock : r.includes('Реестр') ? invoices : supply })) });
    }
    return json(200, { properties: { title: 'Снабжение и склад (тест)' }, sheets: [{ properties: { title: 'Снабжение' } }, { properties: { title: 'Реестр счетов' } }, { properties: { title: 'Склад' } }, { properties: { title: 'Прочее' } }] });
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
    for (const c of ['app_supply_invoices', 'supplyrequests', 'materials', 'storageitems', 'organizations', 'warehouses', 'sheets_sync_sources']) await db().collection(c).deleteMany({});
    await db().collection('warehouses').insertOne({ name: 'Главный склад', type: 'main', isActive: true, isDefault: true, deletedAt: null });

    const head = ['№', 'Дата', 'Наименование', 'Кол-во', 'Статус', 'Поставщик', 'Тип счета', 'Фото'];
    supply = [head, ...Array.from({ length: 10 }, (_, i) => [i + 1, '18.10.2026', `Заявка ${i + 1}`, i + 1, '✅ Заказать', i % 2 ? 'ООО Крепёж' : 'ооо крепёж', 'Счет', '=IMAGE(x)'])];
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
    expect(r.body.sheetsFound).toEqual(['Снабжение', 'Реестр счетов', 'Склад']);
  });

  it('вторая таблица с копией листа «Снабжение» (IMPORTRANGE) — копия не берётся', async () => {
    const r = await request(app.getHttpServer()).post('/api/admin/sheets-sync/sources').set(authHeader(token.access)).send({ url: 'TEST_SHEET_2_copy_abcdefghijklmn' }).expect(201);
    expect(r.body.sheetsFound).toEqual([]);
    expect(r.body.sheetsSkipped).toEqual(['Снабжение', 'Реестр счетов', 'Склад']);
    await request(app.getHttpServer()).delete(`/api/admin/sheets-sync/sources/${r.body.id}`).set(authHeader(token.access)).expect(200);
  });

  it('первый прогон: заявки → supplyrequests, склад → materials + storageitems; позиция из CRM подхвачена по имени', async () => {
    await db().collection('materials').insertOne({ name: 'болт м8 ', article: 'B-8', unit: 'шт', photoIds: [], notes: 'из CRM', deletedAt: null });
    await db().collection('supplyrequests').insertOne({ title: 'Из приложения', qty: 1, status: 'requested', deletedAt: null });

    const r = await run();
    expect(r.body.items[0].error).toBeNull();
    expect(r.body.items[0].lines).toEqual([
      'Снабжение: строк 10, новых 10, изменено 0, удалено 0',
      'Реестр счетов: строк 1, новых 1, изменено 0, удалено 0',
      'Склад: строк 2, новых 1, изменено 0, связано с существующими 1',
    ]);
    const reqs = await live('supplyrequests');
    expect(reqs).toHaveLength(11);
    const r1 = reqs.find((d) => d.num === 1)!;
    expect(r1).toMatchObject({ title: 'Заявка 1', qty: 1, status: 'requested', paid: false, priority: 'normal', source: 'google-sheets', sheetExtra: { invoiceType: 'Счет' } });
    expect(r1.requestDate).toBeInstanceOf(Date);
    const orgs = await db().collection('organizations').find({}).toArray();
    expect(orgs).toHaveLength(1); // «ООО Крепёж» и «ооо крепёж» — один поставщик
    expect(String(r1.supplierId)).toBe(String(orgs[0]._id));

    const mats = await live('materials');
    expect(mats).toHaveLength(2);
    const bolt = mats.find((m) => m.article === 'B-8')!;
    expect(bolt).toMatchObject({ name: 'Болт М8', notes: 'из CRM' }); // поля CRM, которыми лист не управляет, не тронуты
    const nut = mats.find((m) => m.name === 'Гайка М8')!;
    expect(nut.article).toMatch(/^СКЛ-/);
    const stock = await db().collection('storageitems').find({}).toArray();
    expect(stock.find((x) => String(x.materialId) === String(bolt._id))).toMatchObject({ quantity: 50 });
    expect(stock.find((x) => String(x.materialId) === String(nut._id))).toMatchObject({ quantity: 30 });
  });

  it('повтор — без изменений и без дублей', async () => {
    const r = await run();
    expect(r.body.items[0].lines[0]).toBe('Снабжение: строк 10, новых 0, изменено 0, удалено 0');
    expect(r.body.items[0].lines[1]).toBe('Реестр счетов: строк 1, новых 0, изменено 0, удалено 0');
    expect(r.body.items[0].lines[2]).toBe('Склад: строк 2, новых 0, изменено 0');
    expect(await live('supplyrequests')).toHaveLength(11);
    expect(await live('materials')).toHaveLength(2);
  });

  it('правка ячейки, очистка ячейки, удаление строки; остаток со склада обновляется', async () => {
    supply[1][3] = 99; // Кол-во заявки №1
    supply[2][4] = '💰 Оплачено'; // статус заявки №2
    supply[3][5] = ''; // поставщик заявки №3 стёрт
    supply.splice(10, 1); // удалена заявка №10
    stock[6][3] = 45; // Болт: остаток 45
    stock.splice(7, 1); // Гайка убрана из таблицы — номенклатуру не удаляем
    const r = await run();
    expect(r.body.items[0].lines).toEqual([
      'Снабжение: строк 9, новых 0, изменено 3, удалено 1',
      'Реестр счетов: строк 1, новых 0, изменено 0, удалено 0',
      'Склад: строк 1, новых 0, изменено 1, нет в таблице 1 (не удаляются)',
    ]);
    const reqs = await live('supplyrequests');
    expect(reqs.find((d) => d.num === 1)!.qty).toBe(99);
    expect(reqs.find((d) => d.num === 2)).toMatchObject({ status: 'ordered', paid: true });
    expect(reqs.find((d) => d.num === 3)!.supplierId).toBeUndefined();
    expect(reqs.find((d) => d.num === 10)).toBeUndefined();
    expect(reqs.find((d) => d.title === 'Из приложения')).toBeDefined(); // заявка не из таблицы цела
    expect(await live('materials')).toHaveLength(2);
    const bolt = (await live('materials')).find((m) => m.article === 'B-8')!;
    expect(await db().collection('storageitems').findOne({ materialId: bolt._id })).toMatchObject({ quantity: 45 });
  });

  it('лист очистили по ошибке — массовое удаление не выполняется', async () => {
    supply = [supply[0]];
    const r = await run();
    expect(r.body.items[0].lines[0]).toContain('⚠️ удаление 9 записей пропущено');
    expect(await live('supplyrequests')).toHaveLength(10);
  });
});
