import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** C040: GET /materials/:id/summary — остаток, поставщики, заявки, выдачи, помесячно; цены — только ролям с деньгами. */
describe('GET /materials/:id/summary', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let userToken = '';
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const mat = new Types.ObjectId(), sup = new Types.ObjectId(), wh = new Types.ObjectId(), order = new Types.ObjectId();

  beforeAll(async () => {
    ctx = await createTestApp(); app = ctx.app; admin = await loginAsAdmin(app);
    const username = `sum-user-${Date.now()}`;
    await http().post('/api/admin/users').set(authHeader(admin.access)).send({ username, password: 'role-pass-123', role: 'user' }).expect(201);
    userToken = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
    const now = new Date();
    await db().collection('materials').insertOne({ _id: mat, name: 'Труба C040', article: 'C40-1', unit: 'шт', deletedAt: null });
    await db().collection('organizations').insertOne({ _id: sup, name: 'Поставщик C040', deletedAt: null });
    await db().collection('warehouses').insertOne({ _id: wh, name: 'Склад C040', deletedAt: null });
    await db().collection('storageitems').insertOne({ materialId: mat, warehouseId: wh, quantity: 7, reservedQty: 2, zoneName: 'А-1', deletedAt: null });
    await db().collection('salesorders').insertOne({ _id: order, orderNo: 'З-40', customer: 'Заказчик C040', deletedAt: null });
    await db().collection('supplyrequests').insertOne({ materialId: mat, supplierId: sup, num: 'Н-40', qty: 10, status: 'received', priceHint: 150, receivedAt: now, createdAt: now, deletedAt: null });
    await db().collection('stockmovements').insertOne({ materialId: mat, type: 'out', qty: 3, date: now, salesOrderId: order, cancelledAt: null, deletedAt: null });
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('admin: остаток, поставщики, заявки, выдачи и помесячно не пустые; цена за единицу = сумма 150 / qty 10 = 15', async () => {
    const b = (await http().get(`/api/materials/${mat}/summary`).set(authHeader(admin.access)).expect(200)).body;
    expect(b.stock.total).toBe(7);
    expect(b.stock.places.length).toBeGreaterThan(0);
    expect(b.suppliers.length).toBeGreaterThan(0);
    expect(b.suppliers[0].lastPrice).toBe(15);
    expect(b.requests.total).toBe(1);
    expect(b.requests.items.length).toBe(1);
    expect(b.issued.totalQty).toBe(3);
    expect(b.issued.items[0].customerName).toBe('Заказчик C040');
    expect(b.monthly.length).toBeGreaterThan(0);
    expect(b.customers.length).toBeGreaterThan(0);
  });

  it('роль без денег: структура та же, цены null', async () => {
    const b = (await http().get(`/api/materials/${mat}/summary`).set(authHeader(userToken)).expect(200)).body;
    expect(b.suppliers.length).toBeGreaterThan(0);
    for (const s of b.suppliers) { expect(s.lastPrice).toBeNull(); expect(s.minPrice).toBeNull(); expect(s.maxPrice).toBeNull(); }
  });

  it('несуществующая позиция — 404', async () => {
    await http().get(`/api/materials/${new Types.ObjectId()}/summary`).set(authHeader(admin.access)).expect(404);
  });
});
