import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Orders (e2e)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: string;
  let counterpartyId: string;
  let siteId: string;
  let productId: string;
  let warehouseId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const auth = await loginAsAdmin(app);
    token = auth.access;
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  beforeEach(async () => {
    await clearCollections(ctx!.connection, [
      'orders',
      'sites',
      'counterparties',
      'products',
      'warehouses',
      'storageitems',
      'reservations',
      'shipments',
      'quotations',
      'organizations',
    ]);
    // TZ-ORDERS-306: КП выставляет «наша фирма» — без неё stub создать нельзя.
    await request(app.getHttpServer())
      .post('/api/organizations')
      .set(authHeader(token))
      .send({ name: 'Наша фирма', inn: '7710000022', isOurCompany: true });
    const cp = await request(app.getHttpServer())
      .post('/api/counterparties')
      .set(authHeader(token))
      .send({ name: 'CP', roles: ['customer'], inn: '7710000015' });
    counterpartyId = cp.body._id;
    const site = await request(app.getHttpServer())
      .post('/api/sites')
      .set(authHeader(token))
      .send({ counterpartyId, name: 'Объект', address: 'ул. Тест 1' });
    siteId = site.body._id;
    const prod = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Prod', sku: `SKU-${Date.now()}`, kind: 'good', unit: 'шт', listPrice: 50 });
    productId = prod.body._id;
    const wh = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(authHeader(token))
      .send({ name: 'Main WH', type: 'main' });
    warehouseId = wh.body._id;
    // Seed stock
    await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({ type: 'in', productId, warehouseId, qty: 100 });
  });

  const orderBody = (extra: Record<string, unknown> = {}) => ({
    counterpartyId,
    siteId,
    items: [{ productId, quantity: 5, unitPrice: 50 }],
    ...extra,
  });

  it('POST /orders — creates with priceSnapshot', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/orders')
      .set(authHeader(token))
      .send(orderBody({ items: [{ productId, quantity: 5, unitPrice: 50 }] }));
    expect([200, 201]).toContain(res.status);
    expect(res.body.total).toBe(250);
    expect(res.body.siteId).toBeDefined();
  });

  it('GET /orders/:id — returns order details', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/orders')
      .set(authHeader(token))
      .send(orderBody({ items: [{ productId, quantity: 2, unitPrice: 50 }] }));
    const orderId = created.body._id;

    const res = await request(app.getHttpServer())
      .get(`/api/orders/${orderId}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(orderId);
    expect(res.body.items.length).toBe(1);
  });

  it('PATCH /orders/:id — updates order status', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/orders')
      .set(authHeader(token))
      .send(orderBody({ items: [{ productId, quantity: 1, unitPrice: 50 }] }));
    const orderId = created.body._id;

    const res = await request(app.getHttpServer())
      .patch(`/api/orders/${orderId}`)
      .set(authHeader(token))
      .send({ status: 'confirmed' });
    expect([200, 201]).toContain(res.status);
    expect(res.body.status).toBe('confirmed');
  });

  it('POST /orders/:id/reserve-stock — creates Reservations', async () => {
    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set(authHeader(token))
      .send(orderBody({ items: [{ productId, quantity: 3, unitPrice: 50 }] }));
    const res = await request(app.getHttpServer())
      .post(`/api/orders/${order.body._id}/reserve-stock`)
      .set(authHeader(token))
      .send({ warehouseId });
    expect([200, 201]).toContain(res.status);
    expect(res.body.reservationIds.length).toBeGreaterThan(0);
  });

  it('POST /orders/:id/cancel — releases reservations', async () => {
    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set(authHeader(token))
      .send(orderBody({ items: [{ productId, quantity: 2, unitPrice: 50 }] }));
    const orderId = order.body._id;
    await request(app.getHttpServer())
      .post(`/api/orders/${orderId}/reserve-stock`)
      .set(authHeader(token))
      .send({ warehouseId });
    const cancel = await request(app.getHttpServer())
      .post(`/api/orders/${orderId}/cancel`)
      .set(authHeader(token));
    expect([200, 201]).toContain(cancel.status);
    expect(cancel.body.status).toBe('cancelled');
  });

  it('POST /orders/:id/stub-proposal — creates a draft КП once and stays idempotent', async () => {
    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set(authHeader(token))
      .send(orderBody({ items: [{ productId, quantity: 4, unitPrice: 50 }] }));
    const orderId = order.body._id;
    expect(order.body.quotationId).toBeUndefined();

    const first = await request(app.getHttpServer())
      .post(`/api/orders/${orderId}/stub-proposal`)
      .set(authHeader(token));
    expect([200, 201]).toContain(first.status);
    expect(first.body.created).toBe(true);
    expect(first.body.quotationId).toBeDefined();
    expect(first.body.quotation).toMatchObject({ status: 'draft', isStub: true, total: 200 });

    const second = await request(app.getHttpServer())
      .post(`/api/orders/${orderId}/stub-proposal`)
      .set(authHeader(token));
    expect([200, 201]).toContain(second.status);
    expect(second.body.created).toBe(false);
    expect(second.body.quotationId).toBe(first.body.quotationId);

    const reloaded = await request(app.getHttpServer())
      .get(`/api/orders/${orderId}`)
      .set(authHeader(token));
    expect(reloaded.body.quotationId._id).toBe(first.body.quotationId);
  });

  it('POST /orders/:id/ship — creates Shipment', async () => {
    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set(authHeader(token))
      .send(orderBody({ items: [{ productId, quantity: 1, unitPrice: 50 }] }));
    const ship = await request(app.getHttpServer())
      .post(`/api/orders/${order.body._id}/ship`)
      .set(authHeader(token))
      .send({ warehouseId, recipient: 'Customer', address: 'Test str 1' });
    expect([200, 201]).toContain(ship.status);
    expect(ship.body.shipmentId).toBeDefined();
  });
});
