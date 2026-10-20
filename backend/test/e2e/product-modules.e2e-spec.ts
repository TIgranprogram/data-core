/**
 * TZ-83 Phase E.1: product-modules e2e.
 *
 * Smoke-проверка CRUD для /api/modules с populate
 * (workTypes.workTypeId + materials.materialId). Тест требует:
 *  - запущенный Mongo (docker compose up -d mongo)
 *  - seeded admin (AdminSeed на bootstrap)
 *
 * Запуск: `pnpm run test:e2e test/e2e/product-modules.e2e-spec.ts`
 * Skip в CI? NO — это smoke. Если падает, значит regression.
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('ProductModules (TZ-83 Phase E)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let adminToken: string;
  let moduleCategoryId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { access } = await loginAsAdmin(app);
    adminToken = access;

    // TZ-NX-REG-CATEGORY-WIRE-MODULES: create is validated against an
    // active module-type category. The seed only creates material/product
    // categories, so provision one here.
    const cat = await request(app.getHttpServer())
      .post('/api/categories')
      .set(authHeader(adminToken))
      .send({
        name: 'E2E Modules',
        slug: 'e2e-modules',
        type: 'module',
        skuPrefix: 'E2EMOD',
      })
      .expect(201);
    moduleCategoryId = cat.body._id;
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  /**
   * TZ-83 cleanup: NestJS POST defaults to HTTP 201 Created (если не
   * переопределен @HttpCode() декоратором). Никакого helper не нужно —
   * `.expect(201)` это canonical NestJS behavior.
   */
  it('CRUD round-trip preserves module fields while composition is authoritative', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/modules')
      .set(authHeader(adminToken))
      .send({
        name: 'Test Module E2E',
        article: 'TEST-MOD-001',
        categoryId: moduleCategoryId,
        dimensions: { width: 100, height: 50, depth: 30, unit: 'мм' },
        weight: 1.2,
        workTypes: [],
      })
      .expect(201);
    const moduleId = create.body._id;
    expect(create.body.name).toBe('Test Module E2E');

    const list = await request(app.getHttpServer())
      .get('/api/modules')
      .set(authHeader(adminToken))
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.find((m: { _id: string }) => m._id === moduleId)).toBeDefined();

    const got = await request(app.getHttpServer())
      .get(`/api/modules/${moduleId}`)
      .set(authHeader(adminToken))
      .expect(200);
    expect(got.body.name).toBe('Test Module E2E');
    expect(got.body.dimensions.unit).toBe('мм');

    await request(app.getHttpServer())
      .delete(`/api/modules/${moduleId}`)
      .set(authHeader(adminToken))
      .expect(204);
  });

  it('GET /modules?productId filters via Product composition module lines', async () => {
    // создать 2 модуля, привязать к продукту, проверить фильтр
    const productRes = await request(app.getHttpServer())
      .post('/api/products')
      .set(authHeader(adminToken))
      .send({ name: 'E2E Test Product', sku: 'SKU-E2E-PM-001', kind: 'good', unit: 'шт', status: 'new', isActive: true })
      .expect(201);
    const productId = productRes.body._id;

    const m1 = await request(app.getHttpServer())
      .post('/api/modules')
      .set(authHeader(adminToken))
      .send({ name: 'E2E Fil 1', article: 'E2E-FIL-001', categoryId: moduleCategoryId, workTypes: [] })
      .expect(201);
    const m2 = await request(app.getHttpServer())
      .post('/api/modules')
      .set(authHeader(adminToken))
      .send({ name: 'E2E Fil 2', article: 'E2E-FIL-002', categoryId: moduleCategoryId, workTypes: [] })
      .expect(201);

    const compRes = await request(app.getHttpServer())
      .post(`/api/products/${productId}/composition`)
      .set(authHeader(adminToken))
      .send({ lineType: 'module', refId: m1.body._id, quantity: 1 })
      .expect(201);
    // addComposition возвращает полный массив composition; находим _id линии m1.
    const lineId = (compRes.body as Array<{ refId: string; _id: string }>)
      .find((l) => l.refId === m1.body._id)!._id;

    const filtered = await request(app.getHttpServer())
      .get(`/api/modules?productId=${productId}`)
      .set(authHeader(adminToken))
      .expect(200);
    expect(filtered.body.length).toBe(1);
    expect(filtered.body[0]._id).toBe(m1.body._id);

    // cleanup: сначала снять composition-линию, иначе delete m1 → 409
    // (productRefs в remove() не фильтрует deletedAt → «catalog history»).
    await request(app.getHttpServer())
      .delete(`/api/products/${productId}/composition/${lineId}`)
      .set(authHeader(adminToken))
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/modules/${m1.body._id}`)
      .set(authHeader(adminToken))
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/modules/${m2.body._id}`)
      .set(authHeader(adminToken))
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/products/${productId}`)
      .set(authHeader(adminToken))
      .expect(204);
  });
});
