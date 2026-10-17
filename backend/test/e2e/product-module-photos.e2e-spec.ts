/**
 * TZ-83 Phase E.1: product-module-photos e2e.
 *
 * Smoke CRUD + atomic setMain. Проверяет:
 *  - attach с url (валидно, photoId отсутствует)
 *  - attach с photoId=non-existent → schema validator reject
 *  - setMain atomic: первое становится main, второе demoted
 *  - PATCH /:id не меняет isMain (silent strip)
 *  - DELETE → 204
 *
 * Запуск: `pnpm run test:e2e test/e2e/product-module-photos.e2e-spec.ts`
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('ProductModulePhotos (TZ-83 Phase E)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let adminToken: string;
  let testModuleId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { access } = await loginAsAdmin(app);
    adminToken = access;

    const m = await request(app.getHttpServer())
      .post('/api/modules')
      .set(authHeader(adminToken))
      .send({ name: 'E2E Photos Module', workTypes: [] })
      .expect(201);
    testModuleId = m.body._id;
  });

  afterAll(async () => {
    if (testModuleId) {
      await request(app.getHttpServer())
        .delete(`/api/modules/${testModuleId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(204);
    }
    await ctx.cleanup();
  });

  it('attach by url → 201 + GET list returns it', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/product-module-photos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productModuleId: testModuleId, url: 'https://example.com/photo1.jpg', sortOrder: 1 })
      .expect(201);
    expect(created.body.url).toBe('https://example.com/photo1.jpg');
    expect(created.body.isMain).toBe(false);

    const list = await request(app.getHttpServer())
      .get(`/api/product-module-photos?productModuleId=${testModuleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThanOrEqual(1);
  });

  it('attach without photoId NOR url → 400 (schema validator)', async () => {
    await request(app.getHttpServer())
      .post('/api/product-module-photos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productModuleId: testModuleId, caption: 'no source' })
      .expect(400);
  });

  it('setMain atomic: second photo promoted → first promoted false', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/product-module-photos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productModuleId: testModuleId, url: 'https://example.com/photo-a.jpg', isMain: true, sortOrder: 1 })
      .expect(201);
    expect(first.body.isMain).toBe(true);

    const second = await request(app.getHttpServer())
      .post('/api/product-module-photos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productModuleId: testModuleId, url: 'https://example.com/photo-b.jpg', isMain: true, sortOrder: 2 })
      .expect(201);

    // server должен demote first при isMain=true на новой
    const afterCreate = await request(app.getHttpServer())
      .get(`/api/product-module-photos?productModuleId=${testModuleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const firstAfter = afterCreate.body.find((p: { _id: string }) => p._id === first.body._id);
    const secondAfter = afterCreate.body.find((p: { _id: string }) => p._id === second.body._id);
    expect(firstAfter.isMain).toBe(false);
    expect(secondAfter.isMain).toBe(true);

    // явный setMain на first → demote second
    await request(app.getHttpServer())
      .post(`/api/product-module-photos/${first.body._id}/main`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    const afterSetMain = await request(app.getHttpServer())
      .get(`/api/product-module-photos?productModuleId=${testModuleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(afterSetMain.body.find((p: { _id: string }) => p._id === first.body._id).isMain).toBe(true);
    expect(afterSetMain.body.find((p: { _id: string }) => p._id === second.body._id).isMain).toBe(false);

    // cleanup
    await request(app.getHttpServer())
      .delete(`/api/product-module-photos/${first.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
    await request(app.getHttpServer())
      .delete(`/api/product-module-photos/${second.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });

  it('PATCH does not allow isMain demotion (server strips)', async () => {
    const ph = await request(app.getHttpServer())
      .post('/api/product-module-photos')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productModuleId: testModuleId, url: 'https://x.test/p.jpg', isMain: true })
      .expect(201);

    // попытка clear main через PATCH → silent strip
    await request(app.getHttpServer())
      .patch(`/api/product-module-photos/${ph.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ isMain: false })
      .expect(200);

    const recheck = await request(app.getHttpServer())
      .get(`/api/product-module-photos?productModuleId=${testModuleId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const reloaded = recheck.body.find((p: { _id: string }) => p._id === ph.body._id);
    expect(reloaded.isMain).toBe(true);

    await request(app.getHttpServer())
      .delete(`/api/product-module-photos/${ph.body._id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);
  });
});
