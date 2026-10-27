import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/**
 * Корзина заказов (TRASH): DELETE /salesorders/:id — admin без пароля, manager только с токеном POST /auth/confirm.
 * «Документы по заказам» (DOCS-ORDERS): GET /passports/by-order и PATCH /passports/:id { readiness }.
 */
describe('Корзина заказов и паспорта по заказам', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let manager = '';
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const mkOrder = async (orderNo: string) => (await http().post('/api/salesorders').set(as(admin.access)).send({ orderNo, customer: 'ООО Парк' }).expect(201)).body.id as string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    for (const c of ['salesorders', 'incomes', 'productpassports']) await db().collection(c).deleteMany({});
    const username = `trash-manager-${Date.now()}`;
    await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role: 'manager' }).expect(201);
    manager = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('DELETE заказа: manager без токена → 403 CONFIRM_REQUIRED, заказ на месте', async () => {
    const id = await mkOrder('T-1');
    const r = await http().delete(`/api/salesorders/${id}`).set(as(manager)).expect(403);
    expect(JSON.stringify(r.body)).toContain('CONFIRM_REQUIRED');
    await http().get(`/api/salesorders/${id}`).set(as(admin.access)).expect(200);
  });

  it('DELETE заказа: неверный пароль → 403; верный пароль даёт токен, с ним DELETE 200 и заказ в корзине', async () => {
    const id = await mkOrder('T-2');
    await http().post('/api/auth/confirm').set(as(manager)).send({ password: 'wrong-pass-123' }).expect(403);
    const { token } = (await http().post('/api/auth/confirm').set(as(manager)).send({ password: 'role-pass-123' }).expect(200)).body;
    expect(typeof token).toBe('string');
    await http().delete(`/api/salesorders/${id}`).set(as(manager)).set('X-Confirm-Token', token).expect(200);
    await http().get(`/api/salesorders/${id}`).set(as(admin.access)).expect(404);
    const trash = (await http().get('/api/salesorders').query({ deleted: '1' }).set(as(admin.access)).expect(200)).body;
    expect(trash.items.map((x: { id: string }) => x.id)).toContain(id);
  });

  it('DELETE заказа: admin без токена → 200', async () => {
    const id = await mkOrder('T-3');
    await http().delete(`/api/salesorders/${id}`).set(as(admin.access)).expect(200);
  });

  it('позиции сформированного заказа: manager не меняет title/qty и не добавляет/удаляет (403), productId — можно; admin — всё', async () => {
    const orderId = await mkOrder('T-5');
    const line = (await http().post('/api/incomes').set(as(manager)).send({ orderId, title: 'Скамья', qty: 2 }).expect(201)).body.id as string; // этап new — свободно
    await http().patch(`/api/incomes/${line}`).set(as(manager)).send({ qty: 3 }).expect(200);
    await http().patch(`/api/salesorders/${orderId}`).set(as(admin.access)).send({ stage: 'production' }).expect(200);
    const denied = await http().patch(`/api/incomes/${line}`).set(as(manager)).send({ title: 'Другое' }).expect(403);
    expect(JSON.stringify(denied.body)).toContain('Заказ уже в работе');
    await http().patch(`/api/incomes/${line}`).set(as(manager)).send({ qty: 9 }).expect(403);
    await http().post('/api/incomes').set(as(manager)).send({ orderId, title: 'Новая' }).expect(403);
    await http().delete(`/api/incomes/${line}`).set(as(manager)).expect(403);
    await http().patch(`/api/incomes/${line}`).set(as(manager)).send({ color: 'красный', notes: 'ок' }).expect(200);
    await http().patch(`/api/incomes/${line}`).set(as(admin.access)).send({ title: 'Скамья парковая' }).expect(200);
  });

  it('by-order: группа заказа со счётчиками, «Без заказа» — последней; PATCH readiness у выпущенного', async () => {
    const orderId = await mkOrder('T-4');
    const base = { date: new Date('2026-11-02'), images: [], deletedAt: null, source: 'app', productCodeDuplicate: false };
    const ins = await db().collection('productpassports').insertMany([
      { ...base, name: 'Без заказа А', status: 'draft', passportNumber: 'draft-x1' },
      { ...base, name: 'Скамья', status: 'issued', passportNumber: '900', passportNo: 900, warrantyCode: '202611-900', salesOrderId: new Types.ObjectId(orderId), orderNo: 'T-4', customerName: 'ООО Парк' },
      { ...base, name: 'Урна', status: 'draft', passportNumber: 'draft-x2', salesOrderId: new Types.ObjectId(orderId), orderNo: 'T-4', customerName: 'ООО Парк' },
    ]);
    const issuedId = String(ins.insertedIds[1]);
    const r = (await http().get('/api/passports/by-order').set(as(admin.access)).expect(200)).body;
    expect(r).toMatchObject({ total: 2, page: 1 });
    const g = r.items[0];
    expect(g).toMatchObject({ orderId, orderNo: 'T-4', total: 2, ready: 1, notReady: 1, rework: 0 });
    expect(g.items[0]).toMatchObject({ category: null, categoryLabel: 'Без категории' });
    expect(g.categories).toEqual([expect.objectContaining({ category: null, categoryLabel: 'Без категории', total: 2 })]);
    expect(r.items[r.items.length - 1]).toMatchObject({ orderId: null, orderNo: null, total: 1 });
    const only = (await http().get('/api/passports/by-order').query({ readiness: 'ready' }).set(as(admin.access)).expect(200)).body;
    expect(only.items.every((x: { items: Array<{ readiness: string }> }) => x.items.every((i) => i.readiness === 'ready'))).toBe(true);

    const p = (await http().patch(`/api/passports/${issuedId}`).set(as(admin.access)).send({ readiness: 'rework', reworkNote: 'нет фото' }).expect(200)).body;
    expect(p).toMatchObject({ status: 'issued', passportNumber: '900', readiness: 'rework' });
    const after = (await http().get('/api/passports/by-order').set(as(admin.access)).expect(200)).body.items[0];
    expect(after).toMatchObject({ ready: 0, rework: 1 });
    await http().patch(`/api/passports/${issuedId}`).set(as(admin.access)).send({ readiness: 'bogus' }).expect(400);
  });
});
