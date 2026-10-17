/**
 * TZ-CATALOG-304: composition is the only runtime write path.
 * Legacy productModuleIds attach/detach endpoints are rejected; this suite
 * verifies equivalent composition behavior and the migration contract.
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('Products composition modules (TZ-CATALOG-304)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let adminToken: string;
  let productId: string;
  let module1: string;
  let module2: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { access } = await loginAsAdmin(app);
    adminToken = access;

    const product = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(adminToken))
      .send({ name: 'E2E Composition Product', kind: 'good', unit: 'шт', status: 'new', isActive: true })
      .expect(201);
    productId = product.body._id;

    const m1 = await request(app.getHttpServer())
      .post('/api/modules')
      .set(authHeader(adminToken))
      .send({ name: 'E2E Composition Mod 1', workTypes: [] })
      .expect(201);
    module1 = m1.body._id;

    const m2 = await request(app.getHttpServer())
      .post('/api/modules')
      .set(authHeader(adminToken))
      .send({ name: 'E2E Composition Mod 2', workTypes: [] })
      .expect(201);

    module2 = m2.body._id;
  });

  afterAll(async () => {
    if (productId) {
      await request(app.getHttpServer())
        .delete(`/api/products/${productId}`)
        .set(authHeader(adminToken))
        .expect(204);
    }
    for (const moduleId of [module1, module2]) {
      if (moduleId) {
        await request(app.getHttpServer())
          .delete(`/api/modules/${moduleId}`)
          .set(authHeader(adminToken))
          .expect(204);
      }
    }
    await ctx.cleanup();
  });

  it('legacy attach is rejected after composition cutover', async () => {
    await request(app.getHttpServer())
      .post(`/api/products/${productId}/modules`)
      .set(authHeader(adminToken))
      .send({ moduleId: module1 })
      .expect((response) => {
        expect([400, 410]).toContain(response.status);
      });
  });

  it('legacy detach is rejected after composition cutover', async () => {
    await request(app.getHttpServer())
      .delete(`/api/products/${productId}/modules/${module1}`)
      .set(authHeader(adminToken))
      .expect((response) => {
        expect([400, 410]).toContain(response.status);
      });
  });

  it('adds a module composition line', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/products/${productId}/composition`)
      .set(authHeader(adminToken))
      .send({ lineType: 'module', refId: module1, quantity: 1 })
      .expect(201);
    expect(response.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ lineType: 'module', refId: module1, quantity: 1 }),
    ]));
  });

  it('repeated composition line increments quantity without duplicate rows', async () => {
    await request(app.getHttpServer())
      .post(`/api/products/${productId}/composition`)
      .set(authHeader(adminToken))
      .send({ lineType: 'module', refId: module1, quantity: 1 })
      .expect(201);
    const after = await request(app.getHttpServer())
      .get(`/api/products/${productId}/composition`)
      .set(authHeader(adminToken))
      .expect(200);
    const rows = after.body.filter(
      (line: { lineType: string; refId: string }) => line.lineType === 'module' && line.refId === module1,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].quantity).toBe(2);
  });

  it('adds two distinct modules', async () => {
    await request(app.getHttpServer())
      .post(`/api/products/${productId}/composition`)
      .set(authHeader(adminToken))
      .send({ lineType: 'module', refId: module2, quantity: 1 })
      .expect(201);
    const after = await request(app.getHttpServer())
      .get(`/api/products/${productId}/composition`)
      .set(authHeader(adminToken))
      .expect(200);
    const ids = after.body
      .filter((line: { lineType: string }) => line.lineType === 'module')
      .map((line: { refId: string }) => line.refId);
    expect(ids).toEqual(expect.arrayContaining([module1, module2]));
  });

  it('non-existent module reference returns 404', async () => {
    await request(app.getHttpServer())
      .post(`/api/products/${productId}/composition`)
      .set(authHeader(adminToken))
      .send({ lineType: 'module', refId: '64b8b8b8b8b8b8b8b8b8b8b8', quantity: 1 })
      .expect(404);
  });

  it('deletes a composition line', async () => {
    const before = await request(app.getHttpServer())
      .get(`/api/products/${productId}/composition`)
      .set(authHeader(adminToken))
      .expect(200);
    const line = before.body.find(
      (row: { lineType: string; refId: string; _id?: string }) => row.lineType === 'module' && row.refId === module1,
    );
    expect(line?._id).toBeDefined();
    await request(app.getHttpServer())
      .delete(`/api/products/${productId}/composition/${line._id}`)
      .set(authHeader(adminToken))
      .expect(204);
  });

  it('invalid product id returns an error response', async () => {
    await request(app.getHttpServer())
      .post('/api/products/garbage/composition')
      .set(authHeader(adminToken))
      .send({ lineType: 'module', refId: module2, quantity: 1 })
      .expect((response) => {
        expect([400, 500]).toContain(response.status);
      });
  });
});
