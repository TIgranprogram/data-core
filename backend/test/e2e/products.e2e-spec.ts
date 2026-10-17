import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Products (e2e)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: string;

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
    await clearCollections(ctx!.connection, ['products', 'categories', 'boms']);
  });

  it('POST /products — admin creates product with auto sku', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Bolt M8', kind: 'good', unit: 'шт', listPrice: 5 });
    expect([200, 201]).toContain(res.status);
    expect(res.body._id).toBeDefined();
  });

  it('GET /products?search=bolt — filter works', async () => {
    await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Bolt M8', kind: 'good', unit: 'шт' });
    await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Nut M8', kind: 'good', unit: 'шт' });
    const res = await request(app.getHttpServer())
      .get('/api/products?search=bolt')
      .set(authHeader(token));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  it('PATCH /products/:id — updates a product', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Original Product', kind: 'good', unit: 'шт', listPrice: 10 });
    const id = created.body._id;

    const res = await request(app.getHttpServer())
      .patch(`/api/products/${id}`)
      .set(authHeader(token))
      .send({ name: 'Updated Product', listPrice: 25 });
    expect([200, 201]).toContain(res.status);
    expect(res.body.name).toBe('Updated Product');
    expect(res.body.listPrice).toBe(25);
  });

  it('POST /boms — creates Bom with components', async () => {
    const p = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Assembly', kind: 'good', unit: 'шт' });
    const m = await request(app.getHttpServer())
      .post('/api/materials')
      .set(authHeader(token))
      .send({ name: 'Steel', unit: 'кг' });
    const res = await request(app.getHttpServer())
      .post('/api/boms')
      .set(authHeader(token))
      .send({
        productId: p.body._id,
        version: '1.0',
        components: [{ productComponentId: m.body._id, quantity: 1.5 }],
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.components.length).toBe(1);
  });
});
