import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Integration (e2e)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: string;
  let counterpartyId: string;
  let productId: string;
  let orgId: string;
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
      'counterparties', 'organizations', 'products', 'warehouses', 'storageitems',
      'quotations', 'contracts', 'orders', 'shipments', 'stockmovements', 'reservations', 'invoices',
    ]);
    const cp = await request(app.getHttpServer())
      .post('/api/counterparties')
      .set(authHeader(token))
      .send({ name: 'Integration CP', roles: ['customer'], inn: '7830002293' });
    counterpartyId = cp.body._id;
    const org = await request(app.getHttpServer())
      .post('/api/organizations')
      .set(authHeader(token))
      .send({ name: 'Integration Org', inn: '1234567894' });
    orgId = org.body._id;
    const p = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Integration Product', sku: `INT-${Date.now()}`, kind: 'good', unit: 'шт', listPrice: 100 });
    productId = p.body._id;
    const wh = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(authHeader(token))
      .send({ name: 'Main', type: 'main' });
    warehouseId = wh.body._id;
    await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({ type: 'in', productId, warehouseId, qty: 100 });
  });

  it('full sales flow: CP → KП → Договор → Заказ → Отгрузка', async () => {
    // 1. Create Quotation
    const q = await request(app.getHttpServer())
      .post('/api/quotations')
      .set(authHeader(token))
      .send({ organizationId: orgId, counterpartyId, items: [{ productId, quantity: 2, unitPrice: 100 }] });
    expect([200, 201]).toContain(q.status);

    // 2. Convert to Contract
    const c = await request(app.getHttpServer())
      .post(`/api/quotations/${q.body._id}/convert-to-contract`)
      .set(authHeader(token))
      .send({});
    expect([200, 201]).toContain(c.status);

    // 3. Sign contract
    const sign = await request(app.getHttpServer())
      .post(`/api/contracts/${c.body.contractId}/sign`)
      .set(authHeader(token))
      .send({ signedAt: new Date().toISOString() });
    expect([200, 201]).toContain(sign.status);

    // 4. Activate → Order
    const act = await request(app.getHttpServer())
      .post(`/api/contracts/${c.body.contractId}/activate`)
      .set(authHeader(token));
    expect([200, 201]).toContain(act.status);
    const orderId = act.body.orderId;

    // 5. Reserve stock
    const res = await request(app.getHttpServer())
      .post(`/api/orders/${orderId}/reserve-stock`)
      .set(authHeader(token))
      .send({ warehouseId });
    expect([200, 201]).toContain(res.status);

    // 6. Ship
    const ship = await request(app.getHttpServer())
      .post(`/api/orders/${orderId}/ship`)
      .set(authHeader(token))
      .send({ warehouseId, recipient: 'Customer', address: 'Test 1' });
    expect([200, 201]).toContain(ship.status);
    expect(ship.body.shipmentId).toBeDefined();
  }, 60000);
});
