import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Production flow (e2e)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: string;
  let productId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const auth = await loginAsAdmin(app);
    token = auth.access;
    // One product reused across regression assertions.
    const res = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(token))
      .send({ name: 'Production product', sku: `E2E-PROD-${Date.now()}`, kind: 'good', unit: 'шт', listPrice: 100 });
    expect([200, 201]).toContain(res.status);
    productId = res.body._id;
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('creates a production order and gets cost-comparison', async () => {
    const po = await request(app.getHttpServer())
      .post('/api/production-orders')
      .set(authHeader(token))
      .send({ productId, quantity: 5 });
    expect([200, 201]).toContain(po.status);
    expect(po.body._id).toBeDefined();
    expect(po.body.productId).toBe(productId);

    const cc = await request(app.getHttpServer())
      .get(`/api/production-orders/${po.body._id}/cost-comparison`)
      .set(authHeader(token));
    expect([200, 201]).toContain(cc.status);
    expect(cc.body.actual).toBeDefined();
    expect(cc.body.variance).toBeDefined();
  }, 30000);

  it('accepts a valid 24-hex productId (TZ-BACKEND-E2E-HARNESS regression)', async () => {
    // Regression: @IsObjectId() + @ToObjectId() previously rejected every
    // productId (transform ran before validation) → 400. Now valid 24-hex id
    // must be accepted by the DTO and reach the service.
    const po = await request(app.getHttpServer())
      .post('/api/production-orders')
      .set(authHeader(token))
      .send({ productId, quantity: 2 });
    expect([200, 201]).toContain(po.status);
    expect(po.body._id).toBeDefined();
  });

  it('rejects an invalid productId with 400 (no CastError/500)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/production-orders')
      .set(authHeader(token))
      .send({ productId: 'not-an-object-id', quantity: 1 });
    expect(res.status).toBe(400);
    expect(res.body.statusCode).toBe(400);
  });

  it('returns 404 for a well-formed but unknown productId (no CastError/500)', async () => {
    // Valid 24-hex format, but no such product — service returns a business 404.
    const unknownId = '507f1f77bcf86cd799439011';
    const res = await request(app.getHttpServer())
      .post('/api/production-orders')
      .set(authHeader(token))
      .send({ productId: unknownId, quantity: 1 });
    expect(res.status).toBe(404);
    expect(res.body.statusCode).toBe(404);
  });

  it('missing productId is rejected with 400', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/production-orders')
      .set(authHeader(token))
      .send({ quantity: 1 });
    expect(res.status).toBe(400);
  });
});
