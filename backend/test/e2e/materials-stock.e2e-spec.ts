import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

/**
 * TZ-MATERIALS-308 — доменная связка материал → склад (Layer 4).
 *
 * Backend layer: StorageItem.materialId (nullable, XOR с productId),
 * POST /materials/:materialId/storage-items, stock-movements с materialId,
 * inventory-dashboard учитывает material-позиции.
 */
describe('Materials → Stock (TZ-MATERIALS-308)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: string;
  let materialId: string;
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
      'warehouses',
      'storageitems',
      'stockmovements',
      'materials',
      'products',
    ]);

    const mat = await request(app.getHttpServer())
      .post('/api/materials')
      .set(authHeader(token))
      .send({ name: 'Стекло 4мм', unit: 'м2', article: 'STK-004' });
    materialId = mat.body._id;

    const wh = await request(app.getHttpServer())
      .post('/api/warehouses')
      .set(authHeader(token))
      .send({ name: 'WH-MAIN', type: 'main' });
    warehouseId = wh.body._id;
  });

  it('XOR: storage item c productId И materialId → 400', async () => {
    const prod = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Prod', sku: `P-${Date.now()}`, kind: 'good', unit: 'шт', listPrice: 1 });
    const productId = prod.body._id;

    const res = await request(app.getHttpServer())
      .post(`/api/materials/${materialId}/storage-items`)
      .set(authHeader(token))
      .send({ warehouseId, productId, quantity: 10 });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ровно на продукт или материал');
  });

  it('XOR: PATCH storage item со сменой на productId при существующем materialId → 400', async () => {
    const created = await request(app.getHttpServer())
      .post(`/api/materials/${materialId}/storage-items`)
      .set(authHeader(token))
      .send({ warehouseId, quantity: 10 });
    const itemId = created.body._id;

    const prod = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Prod', sku: `P-${Date.now()}`, kind: 'good', unit: 'шт', listPrice: 1 });

    const res = await request(app.getHttpServer())
      .patch(`/api/storage-items/${itemId}`)
      .set(authHeader(token))
      .send({ productId: prod.body._id });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ровно на продукт или материал');
  });

  it('POST /materials/:id/storage-items создаёт позицию с materialId', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/materials/${materialId}/storage-items`)
      .set(authHeader(token))
      .send({ warehouseId, quantity: 25, minQuantity: 5 });
    expect([200, 201]).toContain(res.status);
    expect(String(res.body.materialId)).toBe(materialId);
    expect(res.body.quantity).toBe(25);
  });

  it('GET /storage-items?materialId= возвращает позицию с populated материалом', async () => {
    await request(app.getHttpServer())
      .post(`/api/materials/${materialId}/storage-items`)
      .set(authHeader(token))
      .send({ warehouseId, quantity: 7 });

    const res = await request(app.getHttpServer())
      .get(`/api/storage-items?materialId=${materialId}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    // TZ-MATERIALS-308: canonical envelope { items, total }.
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.total).toBe(1);
    const item = res.body.items[0];
    // populated document (materialId — ObjectId → populated object)
    expect(item.materialId).toBeDefined();
    expect(String(item.materialId._id)).toBe(materialId);
    expect(item.materialId.name).toBe('Стекло 4мм');
  });

  it('stock-movement in/out для материала меняет quantity позиции', async () => {
    // in: 40
    const inRes = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({ type: 'in', materialId, warehouseId, qty: 40 });
    expect([200, 201]).toContain(inRes.status);

    const list = await request(app.getHttpServer())
      .get(`/api/storage-items?materialId=${materialId}`)
      .set(authHeader(token));
    expect(list.body.items[0].quantity).toBe(40);

    // out: 15
    const outRes = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({ type: 'out', materialId, warehouseId, qty: 15 });
    expect([200, 201]).toContain(outRes.status);

    const after = await request(app.getHttpServer())
      .get(`/api/storage-items?materialId=${materialId}`)
      .set(authHeader(token));
    expect(after.body.items[0].quantity).toBe(25);
  });

  it('stock-movement: движение с productId И materialId → 400', async () => {
    const prod = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Prod', sku: `P-${Date.now()}`, kind: 'good', unit: 'шт', listPrice: 1 });

    const res = await request(app.getHttpServer())
      .post('/api/stock-movements')
      .set(authHeader(token))
      .send({
        type: 'in',
        productId: prod.body._id,
        materialId,
        warehouseId,
        qty: 10,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ровно на продукт или материал');
  });

  it('material create НЕ создаёт складскую позицию автоматически (boundary)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/storage-items?materialId=${materialId}`)
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(0);
  });

  it('inventory-dashboard метрики включают material-позиции', async () => {
    await request(app.getHttpServer())
      .post(`/api/materials/${materialId}/storage-items`)
      .set(authHeader(token))
      .send({ warehouseId, quantity: 30, minQuantity: 10 });

    const res = await request(app.getHttpServer())
      .get('/api/inventory')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.totalActiveItems).toBeGreaterThanOrEqual(1);
  });

  it('low-stock учитывает material-позиции', async () => {
    await request(app.getHttpServer())
      .post(`/api/materials/${materialId}/storage-items`)
      .set(authHeader(token))
      .send({ warehouseId, quantity: 3, minQuantity: 10 });

    const res = await request(app.getHttpServer())
      .get('/api/inventory/low-stock')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    // TZ-MATERIALS-308: low-stock returns canonical envelope { items, total }.
    expect(Array.isArray(res.body.items)).toBe(true);
    const matched = res.body.items.some((item: unknown) => {
      const raw = item as { materialId?: { _id?: unknown } | string };
      const id = typeof raw.materialId === 'object'
        ? String((raw.materialId as { _id?: unknown })?._id ?? '')
        : String(raw.materialId ?? '');
      return id.endsWith(materialId);
    });
    expect(matched).toBe(true);
  });
});
