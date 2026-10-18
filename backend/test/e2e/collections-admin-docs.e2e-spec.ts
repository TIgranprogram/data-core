import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

/** A2: GET /api/admin/collections/:name/docs — записи постранично, только чтение, секреты скрыты. */
describe('Collections admin docs (e2e, A2)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let jwt: string;
  const COLL = 'app_docstest_items';
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    jwt = (await loginAsAdmin(app)).access;
    const db = ctx.connection.db!;
    await db.collection(COLL).drop().catch(() => undefined);
    const docs = Array.from({ length: 25 }, (_, i) => ({ name: 'item-' + i, n: i, deletedAt: null as Date | null }));
    docs[0].deletedAt = new Date();
    await db.collection(COLL).insertMany(docs);
  });

  afterAll(async () => {
    await ctx?.connection.db?.collection(COLL).drop().catch(() => undefined);
    await ctx?.cleanup();
  });

  it('без токена — 401', async () => {
    await http().get(`/api/admin/collections/${COLL}/docs`).expect(401);
  });

  it('пользователи: хеш пароля замаскирован', async () => {
    const res = await http().get('/api/admin/collections/users/docs').set(authHeader(jwt)).expect(200);
    expect(res.body.total).toBeGreaterThan(0);
    const admin = res.body.items.find((u: { username: string }) => u.username === 'admin');
    expect(admin.passwordHash).toBe('***');
    expect(typeof admin._id).toBe('string');
  });

  it('страницы: limit, page, по умолчанию удалённые скрыты', async () => {
    const p1 = await http().get(`/api/admin/collections/${COLL}/docs?limit=10`).set(authHeader(jwt)).expect(200);
    expect(p1.body).toMatchObject({ total: 24, page: 1, limit: 10, deleted: 'exclude' });
    expect(p1.body.items).toHaveLength(10);
    const p3 = await http().get(`/api/admin/collections/${COLL}/docs?limit=10&page=3`).set(authHeader(jwt)).expect(200);
    expect(p3.body.items).toHaveLength(4);
  });

  it('deleted=only / include и поиск по тексту', async () => {
    const only = await http().get(`/api/admin/collections/${COLL}/docs?deleted=only`).set(authHeader(jwt)).expect(200);
    expect(only.body.total).toBe(1);
    expect(only.body.items[0].name).toBe('item-0');
    const all = await http().get(`/api/admin/collections/${COLL}/docs?deleted=include`).set(authHeader(jwt)).expect(200);
    expect(all.body.total).toBe(25);
    const q = await http().get(`/api/admin/collections/${COLL}/docs?q=item-1`).set(authHeader(jwt)).expect(200);
    expect(q.body.total).toBe(11); // item-1, item-10..item-19
  });

  it('ошибки: неизвестная коллекция 404, плохие параметры 400', async () => {
    await http().get('/api/admin/collections/no_such_coll/docs').set(authHeader(jwt)).expect(404);
    await http().get(`/api/admin/collections/${COLL}/docs?page=0`).set(authHeader(jwt)).expect(400);
    await http().get(`/api/admin/collections/${COLL}/docs?deleted=all`).set(authHeader(jwt)).expect(400);
  });
});
