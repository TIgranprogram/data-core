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
  const invoices: unknown[][] = [['№', 'Поставщик', 'Наименование'], [1, 'ООО Крепёж', 'Счёт на болты']]; // «Реестр счетов» — больше не загружается
  const orders: unknown[][] = [
    ['№ заказа', 'Дата отгрузки', 'Дата оплаты', 'Заказчик', 'Наша компания', 'Форма оплаты', 'Наименование', 'Кол-во', 'Ед.изм.', 'Вид', 'Цвет', 'Цена за ед.', 'Доход вручную', 'Сумма', 'Дата в отчёт', 'Примечание'],
    ['34', '10.10.2026', '', 'ООО "СТРОЙСЕРВИС"', 'ССЮ', 'б/р', 'Флагшток стальной h 8м', '3', 'шт', '', '', '1 000,50', '', '=формула', '10.10.2026', ''],
    ['34', '10.10.2026', '15.10.2026', 'ООО "СТРОЙСЕРВИС"', 'ССЮ', 'б/р', 'Качеля одинарная', 1, 'шт', '', '', 9000, 7500, '', '', 'скидка'],
  ];
  let shared = true;

  const fakeGoogle: typeof fetch = async (input) => {
    const url = String(input);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('oauth2')) return json(200, { access_token: 'fake', expires_in: 3600 });
    if (!shared) return json(403, { error: { message: 'The caller does not have permission' } });
    if (url.includes('values:batchGet')) {
      const ranges = new URL(url).searchParams.getAll('ranges');
      return json(200, { valueRanges: ranges.map((r) => ({ values: r.includes('Склад') ? stock : r.includes('Реестр') ? invoices : r.includes('Заказы') ? orders : supply })) });
    }
    return json(200, { properties: { title: 'Снабжение и склад (тест)' }, sheets: [{ properties: { title: 'Снабжение' } }, { properties: { title: 'Реестр счетов' } }, { properties: { title: 'Заказы' } }, { properties: { title: 'Склад' } }, { properties: { title: 'Прочее' } }] });
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
    for (const c of ['app_supply_invoices', 'incomes', 'supplyrequests', 'materials', 'storageitems', 'organizations', 'warehouses', 'sheets_sync_sources']) await db().collection(c).deleteMany({});
    await db().collection('warehouses').insertOne({ name: 'Главный склад', type: 'main', isActive: true, isDefault: true, deletedAt: null });
    await db().collection('organizations').insertOne({ name: 'ССЮ', shortName: 'ССЮ', inn: 'TEST-SSU', isOurCompany: true, type: [], deletedAt: null });

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
    expect(r.body.sheetsFound).toEqual(['Снабжение', 'Заказы', 'Склад']); // «Реестр счетов» — копия «Снабжения», не загружается
  });

  it('вторая таблица с копией листа «Снабжение» (IMPORTRANGE) — копия не берётся', async () => {
    const r = await request(app.getHttpServer()).post('/api/admin/sheets-sync/sources').set(authHeader(token.access)).send({ url: 'TEST_SHEET_2_copy_abcdefghijklmn' }).expect(201);
    expect(r.body.sheetsFound).toEqual([]);
    expect(r.body.sheetsSkipped).toEqual(['Снабжение', 'Заказы', 'Склад']);
    await request(app.getHttpServer()).delete(`/api/admin/sheets-sync/sources/${r.body.id}`).set(authHeader(token.access)).expect(200);
  });

  it('первый прогон: заявки → supplyrequests, склад → materials + storageitems; позиция из CRM подхвачена по имени', async () => {
    await db().collection('materials').insertOne({ name: 'болт м8 ', article: 'B-8', unit: 'шт', photoIds: [], notes: 'из CRM', deletedAt: null });
    await db().collection('supplyrequests').insertOne({ title: 'Из приложения', qty: 1, status: 'requested', deletedAt: null });

    const r = await run();
    expect(r.body.items[0].error).toBeNull();
    expect(r.body.items[0].lines).toEqual([
      'Снабжение: строк 10, новых 10, изменено 0, удалено 0',
      'Заказы: строк 2, новых 2, изменено 0, удалено 0',
      'Склад: строк 2, новых 1, изменено 0, связано с существующими 1',
    ]);
    const reqs = await live('supplyrequests');
    expect(reqs).toHaveLength(11);
    const r1 = reqs.find((d) => d.num === 1)!;
    expect(r1).toMatchObject({ title: 'Заявка 1', qty: 1, status: 'requested', paid: false, priority: 'normal', source: 'google-sheets', sheetExtra: { invoiceType: 'Счет' } });
    expect(r1.requestDate).toBeInstanceOf(Date);
    const orgs = await db().collection('organizations').find({}).toArray();
    const sup = orgs.filter((o) => !o.isOurCompany);
    expect(sup).toHaveLength(1); // «ООО Крепёж» и «ооо крепёж» — один поставщик
    expect(String(r1.supplierId)).toBe(String(sup[0]._id));

    // Лист «Заказы» → доходы: сумма = кол-во × цена, «доход вручную» важнее; дата в отчёт = оплата ?? отгрузка
    const inc = await live('incomes');
    expect(inc).toHaveLength(2);
    const ssu = orgs.find((o) => o.isOurCompany)!;
    expect(inc.find((d) => d.title === 'Флагшток стальной h 8м')).toMatchObject({ orderNo: '34', qty: 3, unitPrice: 1000.5, amount: 3001.5, companyId: ssu._id, paymentForm: 'б/р', source: 'google-sheets' });
    const swing = inc.find((d) => d.title === 'Качеля одинарная')!;
    expect(swing).toMatchObject({ amount: 7500, notes: 'скидка' });
    expect((swing.reportDate as Date).toISOString().slice(0, 10)).toBe('2026-10-15');
    expect(await db().collection('app_supply_invoices').countDocuments({})).toBe(0); // реестр не загружается

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
    expect(r.body.items[0].lines[1]).toBe('Заказы: строк 2, новых 0, изменено 0, удалено 0');
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
      'Заказы: строк 2, новых 0, изменено 0, удалено 0',
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

  it('хозяин — приложение: изменённое/удалённое в приложении таблица не трогает; строка, вернувшаяся в лист, — возвращается', async () => {
    const auth = authHeader(token.access);
    const reqs = await live('supplyrequests');
    const n1 = reqs.find((d) => d.num === 1)!, n2 = reqs.find((d) => d.num === 2)!;
    await request(app.getHttpServer()).patch(`/api/supply/requests/${n1._id}`).set(auth).send({ qty: 7 }).expect(200);
    await request(app.getHttpServer()).delete(`/api/supply/requests/${n2._id}`).set(auth).expect(200);
    const bolt = (await live('materials')).find((m) => m.article === 'B-8')!;
    await request(app.getHttpServer()).post(`/api/stock/items/${bolt._id}/move`).set(auth).send({ type: 'in', qty: 5 }).expect(201); // 45 → 50

    supply[1][3] = 1000; // в таблице правят заявку №1 — в базе остаётся правка приложения
    supply[2][3] = 2000; // и удалённую в приложении №2 — она не воскресает
    supply.push([10, '18.10.2026', 'Заявка 10', 10, '✅ Заказать', 'ООО Крепёж', 'Счет', '']); // №10 вернули в лист
    stock[6][3] = 1; // остаток Болта в таблице — не перезаписывает движения приложения
    const r = await run();
    expect(r.body.items[0].lines[0]).toBe('Снабжение: строк 10, новых 0, изменено 1, не тронуто (изменено/удалено в приложении) 2, удалено 0');
    expect(r.body.items[0].lines[2]).toContain('не тронуто (изменено/удалено в приложении) 1');
    const after = await db().collection('supplyrequests').find({}).toArray();
    expect(after.find((d) => d.num === 1)).toMatchObject({ qty: 7, deletedAt: null });
    expect(after.find((d) => d.num === 2)!.deletedAt).toBeInstanceOf(Date);
    expect(after.find((d) => d.num === 10)).toMatchObject({ deletedAt: null, qty: 10 });
    expect(await db().collection('storageitems').findOne({ materialId: bolt._id })).toMatchObject({ quantity: 50 });
  });

  it('лист очистили по ошибке — массовое удаление не выполняется', async () => {
    supply = [supply[0]];
    const r = await run();
    expect(r.body.items[0].lines[0]).toContain('⚠️ удаление 8 записей пропущено');
    expect(await live('supplyrequests')).toHaveLength(10);
  });
});
