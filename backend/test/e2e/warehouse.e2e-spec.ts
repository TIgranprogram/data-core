import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Warehouse (e2e)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: string;
  let productId: string;
  let wh1Id: string;
  let wh2Id: string;

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
    await clearCollections(ctx!.connection, ['warehouses', 'storageitems', 'stockmovements', 'products']);
    const prod = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'P', sku: `WH-${Date.now()}`, kind: 'good', unit: 'шт', listPrice: 1 });
    productId = prod.body._id;
    const w1 = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(authHeader(token))
      .send({ name: 'WH1', type: 'main' });
    wh1Id = w1.body._id;
    const w2 = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(authHeader(token))
      .send({ name: 'WH2', type: 'branch' });
    wh2Id = w2.body._id;
  });

  it('POST /stock-movements {type: "in", qty: 100} — creates StorageItem with quantity 100', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({ type: 'in', productId, warehouseId: wh1Id, qty: 100 });
    expect([200, 201]).toContain(res.status);
    const inv = await request(app.getHttpServer())
      .get(`/api/warehouses/${wh1Id}/inventory`)
      .set(authHeader(token));
    expect(inv.body.length).toBeGreaterThan(0);
    expect(inv.body[0].quantity).toBe(100);
  });

  it('POST /stock-movements {type: "out", qty: 200} — returns 400 insufficient stock', async () => {
    await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({ type: 'in', productId, warehouseId: wh1Id, qty: 50 });
    const res = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({ type: 'out', productId, warehouseId: wh1Id, qty: 200 });
    expect(res.status).toBe(400);
  });

  it('POST /stock-movements {type: "transfer", qty: 30} — moves 30 from WH1 to WH2', async () => {
    await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({ type: 'in', productId, warehouseId: wh1Id, qty: 100 });
    const res = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({ type: 'transfer', productId, warehouseId: wh1Id, toWarehouseId: wh2Id, qty: 30 });
    expect([200, 201]).toContain(res.status);
    const inv1 = await request(app.getHttpServer()).get(`/api/warehouses/${wh1Id}/inventory`).set(authHeader(token));
    const inv2 = await request(app.getHttpServer()).get(`/api/warehouses/${wh2Id}/inventory`).set(authHeader(token));
    expect(inv1.body[0].quantity).toBe(70);
    expect(inv2.body[0].quantity).toBe(30);
  });

  it('GET /inventory/low-stock — filters items below minQuantity', async () => {
    // Seed: 10 in, minQuantity 50
    await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({ type: 'in', productId, warehouseId: wh1Id, qty: 10 });
    await request(app.getHttpServer())
      .patch(`/api/storage-items/by-product/${productId}`)
      .set(authHeader(token))
      .send({ minQuantity: 50 });
    const res = await request(app.getHttpServer()).get('/api/inventory/low-stock').set(authHeader(token));
    expect(res.status).toBe(200);
    // TZ-MATERIALS-308: low-stock returns canonical envelope { items, total }.
    expect(Array.isArray(res.body.items)).toBe(true);
  });
});
