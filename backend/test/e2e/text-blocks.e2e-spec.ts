/**
 * TZ-86 Phase F.1.1 — TextBlock e2e.
 *
 * Coverage (TZ-DOC-323 — the legacy `category` enum is GONE):
 *  - POST /api/text-blocks — creates with auto-slug from Russian name (transliteration)
 *  - POST /api/text-blocks — duplicate slug returns 409 Conflict
 *  - POST /api/text-blocks — explicit duplicate slug returns 409
 *  - GET /api/text-blocks — list returns array
 *  - GET /api/text-blocks?categoryId=<system default> — filters by categoryId (TZ-DOC-323 replacement
 *    for the removed `?category=legal` filter; covers positive + negative filter)
 *  - GET /api/text-blocks/:id — single doc
 *  - GET /api/text-blocks/:id — invalid id returns 404
 *  - PATCH /api/text-blocks/:id — updates name + content
 *  - DELETE /api/text-blocks/:id — soft-deletes (subsequent GET returns 404)
 *
 * Run: `pnpm test:e2e test/e2e/text-blocks.e2e-spec.ts`
 * Requires: MongoDB RS up (`docker compose up -d mongo`), admin seeded via AdminSeed.
 */
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/test-auth';

describe('TextBlocks (e2e)', () => {
  let ctx: TestContext;
  let app: INestApplication;
  let auth: { Authorization: string };
  const created: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    const { access } = await loginAsAdmin(app);
    auth = authHeader(access);
  });

  afterAll(async () => {
    // Best-effort cleanup; the test DB is dropped by ctx.cleanup() anyway.
    for (const id of created) {
      await request(app.getHttpServer())
        .delete(`/api/text-blocks/${id}`)
        .set(auth)
        .catch(() => undefined);
    }
    await ctx.cleanup();
  });

  it('POST /text-blocks — creates with auto-slug from Russian name (transliteration)', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/text-blocks')
      .set(auth)
      .send({
        name: 'Стандартные условия',
        content: 'Тестовый текст',
      });
    expect([200, 201]).toContain(res.status);
    expect(res.body.name).toBe('Стандартные условия');
    // Service slugify: "Стандартные условия" → lowercased → "стандартные условия"
    //   → transliterate (ы→y, е→e, и→i, я→ya) → "standartnye usloviya"
    //   → spaces to dashes → "standartnye-usloviya"
    expect(res.body.slug).toBe('standartnye-usloviya');
    expect(res.body.content).toBe('Тестовый текст');
    expect(res.body.isActive).toBe(true);
    // TZ-DOC-323: the legacy `category` enum field is gone; the response
    // should not carry it. Whatever persist-time behaviour the global
    // `forbidNonWhitelisted` allows, this guarantees the field is absent
    // from the canonical schema projection.
    expect(Object.prototype.hasOwnProperty.call(res.body, 'category')).toBe(false);
    created.push(res.body._id);
  });

  it('POST /text-blocks — duplicate slug returns 409', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/text-blocks')
      .set(auth)
      .send({
        name: 'Дубликат имени',
        content: 'Первый',
      });
    expect([200, 201]).toContain(first.status);
    created.push(first.body._id);

    const dup = await request(app.getHttpServer())
      .post('/api/text-blocks')
      .set(auth)
      .send({
        name: 'Дубликат имени', // same name → same auto-slug
        content: 'Второй',
      });
    expect(dup.status).toBe(409);
  });

  it('POST /text-blocks — explicit duplicate slug returns 409', async () => {
    const first = await request(app.getHttpServer())
      .post('/api/text-blocks')
      .set(auth)
      .send({
        name: 'Custom name 1',
        slug: 'fixed-slug',
        content: 'a',
      });
    expect([200, 201]).toContain(first.status);
    created.push(first.body._id);

    const dup = await request(app.getHttpServer())
      .post('/api/text-blocks')
      .set(auth)
      .send({
        name: 'Custom name 2',
        slug: 'fixed-slug', // explicit duplicate
        content: 'b',
      });
    expect(dup.status).toBe(409);
  });

  it('GET /text-blocks — list returns array', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/text-blocks')
      .set(auth);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  // TZ-DOC-323: replaced `GET ?category=legal` (legacy enum) with
  // `GET ?categoryId=<system default id>` (TZ-DOC-315 canonical FK).
  // Positive case — every block in this suite was resolved through the
  // system-default seed so all rows appear; negative case — a
  // non-existent ObjectId returns an empty array.
  it('GET /text-blocks?categoryId=<system default> filters by categoryId (TZ-DOC-323 replacement)', async () => {
    const seeds = await ctx.connection
      .collection('text_block_categories')
      .find({ isSystem: true, isActive: true, isDefault: true })
      .toArray();
    expect(seeds.length).toBeGreaterThanOrEqual(1);
    const systemDefaultId = String(seeds[0]._id);

    const filtered = await request(app.getHttpServer())
      .get(`/api/text-blocks?categoryId=${systemDefaultId}`)
      .set(auth);
    expect(filtered.status).toBe(200);
    expect(Array.isArray(filtered.body)).toBe(true);
    // Every block created earlier in this suite resolves through the
    // system-default seed (TZ-DOC-321 boot assertion), so the filter
    // must return at least one row.
    expect(filtered.body.length).toBeGreaterThanOrEqual(1);
    for (const t of filtered.body) {
      expect(String(t.categoryId)).toBe(systemDefaultId);
    }

    const nonExistentId = '64a7b8c9d0e1f2a3b4c5d6e6';
    const none = await request(app.getHttpServer())
      .get(`/api/text-blocks?categoryId=${nonExistentId}`)
      .set(auth);
    expect(none.status).toBe(200);
    expect(none.body.length).toBe(0);
  });

  it('GET /text-blocks/:id — single doc', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/text-blocks')
      .set(auth)
      .send({
        name: 'Single doc test',
        content: 'x',
      });
    expect([200, 201]).toContain(create.status);
    created.push(create.body._id);

    const res = await request(app.getHttpServer())
      .get(`/api/text-blocks/${create.body._id}`)
      .set(auth);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Single doc test');
  });

  it('GET /text-blocks/:id — invalid id returns 404', async () => {
    // 24-char valid format but non-existent id
    const res = await request(app.getHttpServer())
      .get('/api/text-blocks/64a7b8c9d0e1f2a3b4c5d6e7')
      .set(auth);
    expect(res.status).toBe(404);
  });

  it('PATCH /text-blocks/:id — updates name + content', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/text-blocks')
      .set(auth)
      .send({ name: 'Before', content: 'a' });
    expect([200, 201]).toContain(create.status);
    created.push(create.body._id);

    const res = await request(app.getHttpServer())
      .patch(`/api/text-blocks/${create.body._id}`)
      .set(auth)
      .send({ name: 'After', content: 'b' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('After');
    expect(res.body.content).toBe('b');
  });

  it('DELETE /text-blocks/:id — soft-deletes (subsequent GET returns 404)', async () => {
    const create = await request(app.getHttpServer())
      .post('/api/text-blocks')
      .set(auth)
      .send({ name: 'ToDelete', content: 'x' });
    expect([200, 201]).toContain(create.status);
    // Do NOT push to `created` — already deleted below.

    const del = await request(app.getHttpServer())
      .delete(`/api/text-blocks/${create.body._id}`)
      .set(auth);
    expect([200, 204]).toContain(del.status);

    const get = await request(app.getHttpServer())
      .get(`/api/text-blocks/${create.body._id}`)
      .set(auth);
    expect(get.status).toBe(404);
  });
});
