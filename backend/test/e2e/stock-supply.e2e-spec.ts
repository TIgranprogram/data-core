import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * /api/stock и /api/supply — склад и снабжение на ОБЩИХ коллекциях CRM kppdf
 * (materials, storageitems, stockmovements, reservations, supplyrequests, organizations).
 * Проверяем, что данные ложатся именно туда и в той форме, которую читает CRM.
 */
describe('Stock & supply on shared CRM collections', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);
  let boltId = '';

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
    for (const c of ['materials', 'storageitems', 'stockmovements', 'reservations', 'supplyrequests', 'organizations', 'warehouses']) await db().collection(c).deleteMany({});
    await db().collection('warehouses').insertOne({ name: 'Главный склад', type: 'main', isActive: true, isDefault: false, deletedAt: null, createdAt: new Date() });
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('без входа — 401', async () => {
    await http().get('/api/stock/items').expect(401);
  });

  it('новая позиция: материал с автоартикулом + строка остатка на складе по умолчанию', async () => {
    const r = await http().post('/api/stock/items').set(auth()).send({ name: 'Болт М8×30', unit: 'шт', categoryName: 'Метизы', minQuantity: 10 }).expect(201);
    boltId = r.body.id;
    expect(r.body).toMatchObject({ name: 'Болт М8×30', unit: 'шт', categoryName: 'Метизы', quantity: 0, minQuantity: 10 });
    expect(r.body.article).toMatch(/^СКЛ-\d{4}-\d{3}$/);
    const wh = await db().collection('warehouses').findOne({ name: 'Главный склад' });
    expect(wh!.isDefault).toBe(true);
    const cat = await db().collection('categories').findOne({ name: 'Метизы' });
    expect(cat).toMatchObject({ type: 'material' });
    expect(r.body.sku).toMatch(new RegExp(`^${cat!.skuPrefix}-`));
    // То же наименование другим регистром — та же позиция
    const again = await http().post('/api/stock/items').set(auth()).send({ name: '  болт м8×30 ' }).expect(201);
    expect(again.body.id).toBe(boltId);
  });

  it('приход / бронь / списание / снятие брони / корректировка — как в CRM', async () => {
    const mv = (body: object) => http().post(`/api/stock/items/${boltId}/move`).set(auth()).send(body);
    expect((await mv({ type: 'in', qty: 50, note: 'Поставка', clientUid: 'u-in-1' }).expect(201)).body).toMatchObject({ quantity: 50, reservedQty: 0, free: 50 });
    // повтор той же операции (офлайн-очередь) — без изменений
    expect((await mv({ type: 'in', qty: 50, clientUid: 'u-in-1' }).expect(201)).body.quantity).toBe(50);
    expect((await mv({ type: 'reserve', qty: 20, note: 'Заказ 15' }).expect(201)).body).toMatchObject({ quantity: 50, reservedQty: 20, free: 30 });
    expect((await mv({ type: 'out', qty: 5 }).expect(201)).body).toMatchObject({ quantity: 45, reservedQty: 15 });
    expect((await mv({ type: 'unreserve', qty: 5 }).expect(201)).body.reservedQty).toBe(10);
    expect((await mv({ type: 'adjust', qty: -3, note: 'пересчёт' }).expect(201)).body.quantity).toBe(42);
    await mv({ type: 'out', qty: 1000 }).expect(400);
    await mv({ type: 'reserve', qty: 1000 }).expect(400);

    const si = await db().collection('storageitems').findOne({});
    expect(si).toMatchObject({ quantity: 42, reservedQty: 10 });
    const types = (await db().collection('stockmovements').find({}).toArray()).map((m) => m.type).sort();
    expect(types).toEqual(['adjust', 'in', 'out']);
    const hist = await http().get(`/api/stock/items/${boltId}/history`).set(auth()).expect(200);
    expect(hist.body.items.length).toBe(5);
  });

  it('заявка: поставщик и наша компания становятся организациями (без дублей), статус — подписью', async () => {
    const a = await http().post('/api/supply/requests').set(auth()).send({ title: 'Гайка М8', qty: 100, unit: 'шт', supplierName: 'ООО «Крепёж»', companyName: 'СИЮ', statusLabel: '💰 Оплачено', priorityLabel: 'Срочно', clientUid: 'req-1' }).expect(201);
    expect(a.body).toMatchObject({ title: 'Гайка М8', status: 'ordered', paid: true, priority: 'urgent', statusLabel: '💰 Оплачено', supplierName: 'ООО «Крепёж»', companyName: 'СИЮ', num: 1 });
    // повтор с тем же clientUid — та же заявка
    const dup = await http().post('/api/supply/requests').set(auth()).send({ title: 'Гайка М8', clientUid: 'req-1' }).expect(201);
    expect(dup.body.id).toBe(a.body.id);
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Шайба', supplierName: 'ооо «крепёж»' }).expect(201);
    const orgs = await db().collection('organizations').find({}).toArray();
    expect(orgs).toHaveLength(2);
    expect(orgs.find((o) => o.name === 'ООО «Крепёж»')).toMatchObject({ type: ['supplier'], isOurCompany: false });
    expect(orgs.find((o) => o.name === 'СИЮ')).toMatchObject({ isOurCompany: true });
    expect(await db().collection('supplyrequests').countDocuments({})).toBe(2);
  });

  it('оприходование: позиция заводится по наименованию, приход на склад, статус «Получено»', async () => {
    const list = await http().get('/api/supply/requests').set(auth()).expect(200);
    const req = list.body.items.find((r: { title: string }) => r.title === 'Гайка М8');
    const r = await http().post(`/api/supply/requests/${req.id}/receive`).set(auth()).send({ qty: 100 }).expect(200);
    expect(r.body).toMatchObject({ status: 'received', receivedQty: 100, statusLabel: '☑️ Получено', materialName: 'Гайка М8' });
    const items = await http().get('/api/stock/items?search=гайка').set(auth()).expect(200);
    expect(items.body.items[0]).toMatchObject({ name: 'Гайка М8', quantity: 100 });
    await http().post(`/api/supply/requests/${req.id}/receive`).set(auth()).send({ qty: 100 }).expect(409);
    const mv = await db().collection('stockmovements').findOne({ documentRef: `SupplyRequest:${req.id}` });
    expect(mv).toMatchObject({ type: 'in', qty: 100 });
  });

  it('подсказки формы: поставщики, наши компании, категории', async () => {
    const r = await http().get('/api/supply/lookups').set(auth()).expect(200);
    expect(r.body.suppliers).toContain('ООО «Крепёж»');
    expect(r.body.companies).toContain('СИЮ');
    expect(r.body.categories.map((c: { name: string }) => c.name)).toContain('Метизы');
  });
});
