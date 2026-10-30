import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** СМ.9 — GET /api/me/versions: версии разделов для обновления без F5; ответ не кэшируется; без токена — 401. */
describe('GET /api/me/versions (СМ.9)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let userTok = '';
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    const username = `ver-user-${Date.now()}`;
    await http().post('/api/admin/users').set(authHeader(admin.access)).send({ username, password: 'role-pass-123', role: 'user' }).expect(201);
    userTok = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
  });

  afterAll(async () => { await ctx?.cleanup(); });

  it('роль user — 200, в v есть ключ stock, заголовок Cache-Control содержит no-store', async () => {
    const res = await http().get('/api/me/versions').set(authHeader(userTok)).expect(200);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.body).toHaveProperty('live');
    expect(res.body).toHaveProperty('epoch');
    expect(res.body.v).toHaveProperty('stock');
    expect(typeof res.body.v.stock).toBe('number');
  });

  it('без токена — 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/me/versions');
    expect(res.status).toBe(401);
  });
});
