import request from 'supertest';
import { Types } from 'mongoose';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * ORDER-LINES: позиции «Новое изделие» / «Услуга», заявки productrequests (confirm/reject), запрет «В производство»,
 * unassignedCount; draft-all паспортов по заказу; GET /production-orders?overdue=1.
 */
describe('ORDER-LINES: позиции заказа, заявки на изделие, draft-all, overdue', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(admin.access);
  const order = async (orderNo: string, extra: Record<string, unknown> = {}) =>
    (await http().post('/api/salesorders').set(auth()).send({ orderNo, customer: 'Школа', stage: 'new', ...extra }).expect(201)).body.id as string;
  const newLine = (orderId: string, title: string, extra: Record<string, unknown> = {}) =>
    http().post('/api/incomes').set(auth()).send({ orderId, title, qty: 2, unit: 'шт', lineType: 'new_product', unitPrice: 1000, ...extra });
  const card = async (id: string) => (await http().get(`/api/salesorders/${id}`).set(auth()).expect(200)).body;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'products', 'productrequests', 'worktypes', 'productaliases', 'productpassports']) await db().collection(c).deleteMany({});
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('новое изделие: без цены — 400; с ценой — заявка open, позиция привязана, нет в «Продукции»', async () => {
    const o = await order('OL-1');
    await newLine(o, 'Качели ZQ', { unitPrice: undefined }).expect(400);
    await newLine(o, 'Качели ZQ', { unitPrice: 0 }).expect(400);
    const l = (await newLine(o, 'Качели ZQ').expect(201)).body;
    expect(l.lineType).toBe('new_product');
    expect(l.productRequestId).toBeTruthy();
    const req = (await http().get(`/api/product-requests/${l.productRequestId}`).set(auth()).expect(200)).body;
    expect(req).toMatchObject({ title: 'Качели ZQ', status: 'open' });
    expect(req.lines).toHaveLength(1);
    expect((await http().get('/api/product-requests/count').set(auth()).expect(200)).body.open).toBe(1);
    expect(await db().collection('products').countDocuments({})).toBe(0);
  });

  it('услуга «Доставка»: без цены/вида работ/не из Доставки-Монтажа — 400; с ценой — не в очередях сопоставления', async () => {
    const o = await order('OL-2');
    const wt = (await http().post('/api/work-types').set(auth()).send({ name: 'Доставка', hourlyRate: 0 }).expect(201)).body.id;
    const other = (await http().post('/api/work-types').set(auth()).send({ name: 'Сварка', hourlyRate: 0 }).expect(201)).body.id;
    const svc = (extra: Record<string, unknown>) => http().post('/api/incomes').set(auth()).send({ orderId: o, title: 'Доставка до объекта', qty: 1, unit: 'усл', lineType: 'service', ...extra });
    await svc({ workTypeId: wt }).expect(400); // нет цены
    await svc({ unitPrice: 500 }).expect(400); // нет вида работ
    await svc({ workTypeId: other, unitPrice: 500 }).expect(400); // не Доставка/Монтаж
    const l = (await svc({ workTypeId: wt, unitPrice: 500 }).expect(201)).body;
    const q = (await http().get('/api/matching/unmatched').query({ limit: 100 }).set(auth()).expect(200)).body;
    expect(JSON.stringify(q.items)).not.toContain(l.id);
    expect((await card(o)).lines.find((x: { id: string }) => x.id === l.id).unassigned).toBe(false);
  });

  it('confirm: создаёт изделие, перепривязывает позиции двух заказов; unassignedCount; «В производство» отказывает до подтверждения', async () => {
    const o1 = await order('OL-3'); const o2 = await order('OL-4');
    const a = (await newLine(o1, 'Карусель ZC').expect(201)).body;
    const b = (await newLine(o2, 'карусель  ZC').expect(201)).body;
    expect(b.productRequestId).toBe(a.productRequestId); // одна заявка на название
    const c1 = await card(o1);
    expect(c1.unassignedCount).toBe(1);
    const bad = await http().post('/api/production-orders/assign').set(auth()).send({ contractIds: [o1] }).expect(400);
    expect(bad.body.message).toMatch(/без подтверждённого изделия/);

    const done = (await http().post(`/api/product-requests/${a.productRequestId}/confirm`).set(auth()).send({ sku: 'OL-CAR', type: 'Благоустройство' }).expect(200)).body;
    expect(done.status).toBe('confirmed');
    const pid = done.productId;
    expect(pid).toBeTruthy();
    for (const id of [a.id, b.id]) {
      const inc = await db().collection('incomes').findOne({ _id: new Types.ObjectId(id) });
      expect(String(inc!.productId)).toBe(pid);
      expect(inc!.matchStatus).toBe('confirmed');
    }
    expect((await card(o1)).unassignedCount).toBe(0);
    await http().post(`/api/product-requests/${a.productRequestId}/confirm`).set(auth()).send({ sku: 'OL-CAR2', type: 'Благоустройство' }).expect(409);
    await http().post('/api/production-orders/assign').set(auth()).send({ contractIds: [o1] }).expect(200);
  });

  it('reject {productId}: перепривязка к существующему изделию, новое не создаётся; услуга не мешает «В производство»', async () => {
    const o = await order('OL-5');
    const prod = (await http().post('/api/showcase').set(auth()).send({ sku: 'OL-P1', name: 'Горка', type: 'Благоустройство' }).expect(201)).body.id;
    const l = (await newLine(o, 'Горка новая ZG').expect(201)).body;
    const wt = (await http().post('/api/work-types').set(auth()).send({ name: 'Монтаж', hourlyRate: 0 }).expect(201)).body.id;
    await http().post('/api/incomes').set(auth()).send({ orderId: o, title: 'Монтаж', qty: 1, unit: 'усл', lineType: 'service', workTypeId: wt, unitPrice: 300 }).expect(201);
    const before = await db().collection('products').countDocuments({});
    const r = (await http().post(`/api/product-requests/${l.productRequestId}/reject`).set(auth()).send({ productId: prod }).expect(200)).body;
    expect(r.status).toBe('rejected');
    expect(await db().collection('products').countDocuments({})).toBe(before);
    const inc = (await card(o)).lines.find((x: { id: string }) => x.id === l.id);
    expect(String(inc.productId)).toBe(prod);
    await http().post(`/api/product-requests/${l.productRequestId}/reject`).set(auth()).send({ productId: prod }).expect(409);
    await http().post('/api/production-orders/assign').set(auth()).send({ contractIds: [o] }).expect(200);
  });

  it('старые позиции без lineType работают как раньше', async () => {
    const o = await order('OL-6');
    const l = (await http().post('/api/incomes').set(auth()).send({ orderId: o, title: 'Скамья старая', qty: 1, unit: 'шт' }).expect(201)).body;
    expect(l.lineType ?? null).toBeNull();
    await http().patch(`/api/incomes/${l.id}`).set(auth()).send({ qty: 3 }).expect(200);
  });

  it('draft-all: черновики только на позиции с изделием без паспорта, название из позиции; повтор — created 0', async () => {
    const o = await order('OL-7');
    const prod = (await http().post('/api/showcase').set(auth()).send({ sku: 'OL-P2', name: 'Имя изделия', type: 'Благоустройство' }).expect(201)).body.id;
    const withP = (await http().post('/api/incomes').set(auth()).send({ orderId: o, title: 'Название из заказа', qty: 1, unit: 'шт', productId: prod }).expect(201)).body.id;
    await newLine(o, 'Ещё новое ZN').expect(201);
    const r1 = (await http().post(`/api/salesorders/${o}/passports/draft-all`).set(auth()).expect(200)).body;
    expect(r1.created).toBe(1);
    expect(r1.items[0].incomeId).toBe(withP);
    const pass = await db().collection('productpassports').findOne({ incomeId: new Types.ObjectId(withP) });
    expect(pass!.name).toBe('Название из заказа');
    const r2 = (await http().post(`/api/salesorders/${o}/passports/draft-all`).set(auth()).expect(200)).body;
    expect(r2).toMatchObject({ created: 0, skipped: 1 });
  });

  it('production-orders?overdue=1: только просроченные', async () => {
    await order('OL-LATE', { productionNo: '90-26', shipDate: '2020-01-01' });
    await order('OL-FUT', { productionNo: '91-26', shipDate: '2099-01-01' });
    await order('OL-SHIP', { productionNo: '92-26', shipDate: '2020-01-01', stage: 'shipped' });
    await order('OL-NODL', { productionNo: '93-26' });
    const nos = async (q: Record<string, unknown>) =>
      (await http().get('/api/production-orders').query({ limit: 100, ...q }).set(auth()).expect(200)).body.items.map((x: { productionNo: string }) => x.productionNo);
    expect(await nos({})).toEqual(expect.arrayContaining(['90-26', '91-26', '92-26', '93-26']));
    const od = await nos({ overdue: '1' });
    expect(od).toContain('90-26');
    for (const n of ['91-26', '92-26', '93-26']) expect(od).not.toContain(n);
  });
});
