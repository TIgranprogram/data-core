import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

/** A3: журнал аудита — фильтры, значения для фильтров, валидация. */
describe('Audit logs (e2e, A3)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let jwt: string;
  let materialId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    jwt = (await loginAsAdmin(app)).access;
    await clearCollections(ctx.connection, ['auditlogs', 'materials']);
    const m = await http().post('/api/materials').set(authHeader(jwt)).send({ name: 'Журнал-тест', article: 'AUD-1', unit: 'шт' });
    expect(m.status).toBe(201);
    materialId = m.body.id;
    await http().patch(`/api/materials/${materialId}`).set(authHeader(jwt)).send({ name: 'Журнал-тест 2' }).expect(200);
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  it('без токена — 401', async () => {
    await http().get('/api/audit-logs').expect(401);
  });

  it('изменения материала видны в журнале, сначала новые; фильтр по записи и действию', async () => {
    const all = await http().get(`/api/audit-logs?entityType=Material&entityId=${materialId}`).set(authHeader(jwt)).expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items.map((i: { action: string }) => i.action)).toEqual(['update', 'create']);
    expect(all.body.items[0].userName).toBe('admin');
    expect(typeof all.body.items[0].createdAt).toBe('string');
    const upd = await http().get(`/api/audit-logs?entityType=Material&action=update`).set(authHeader(jwt)).expect(200);
    expect(upd.body.total).toBe(1);
  });

  it('период: будущее — пусто, сегодня — есть', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const t = await http().get(`/api/audit-logs?entityType=Material&from=${today}&to=${today}`).set(authHeader(jwt)).expect(200);
    expect(t.body.total).toBe(2);
    const f = await http().get('/api/audit-logs?from=2099-01-01').set(authHeader(jwt)).expect(200);
    expect(f.body.total).toBe(0);
  });

  it('facets: типы, действия и пользователи для фильтров', async () => {
    const res = await http().get('/api/audit-logs/facets').set(authHeader(jwt)).expect(200);
    expect(res.body.entityTypes).toContain('Material');
    expect(res.body.actions).toEqual(expect.arrayContaining(['create', 'update']));
    expect(res.body.users.map((u: { userName: string }) => u.userName)).toContain('admin');
  });

  it('неверные параметры — 400, а не 500', async () => {
    await http().get('/api/audit-logs?userId=abc').set(authHeader(jwt)).expect(400);
    await http().get('/api/audit-logs?from=вчера').set(authHeader(jwt)).expect(400);
    await http().get('/api/audit-logs?page=0').set(authHeader(jwt)).expect(400);
  });
});
