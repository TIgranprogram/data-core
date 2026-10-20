import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, TestContext, clearCollections } from '../setup/test-db';
import { loginAsAdmin, authHeader } from '../setup/admin.fixture';

/**
 * P2: scope машинных ключей kppd_ (read / write / full).
 * Старые ключи без scope работают как раньше (full = права выдавшего).
 */
describe('Key scopes (e2e, P2)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let jwt: string;
  let readKey: string;
  let writeKey: string;
  let legacyKey: string;

  const http = () => request(app.getHttpServer());
  const issue = async (body: Record<string, unknown>) =>
    http()
      .post('/api/desktop/pairing-keys')
      .set(authHeader(jwt))
      .send({ apiBaseUrl: 'http://localhost:3001', ...body });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    jwt = (await loginAsAdmin(app)).access;
    await clearCollections(ctx.connection, ['desktop_pairing_keys', 'materials']);

    const r = await issue({ label: 'e2e-read', scope: { access: 'read', apps: ['inventory'] } });
    expect(r.status).toBe(201);
    expect(r.body.scope).toEqual({ access: 'read', apps: ['inventory'] });
    readKey = r.body.apiKey;

    const w = await issue({ label: 'e2e-write', scope: { access: 'write' } });
    expect(w.status).toBe(201);
    writeKey = w.body.apiKey;

    const l = await issue({ label: 'e2e-legacy' });
    expect(l.status).toBe(201);
    expect(l.body.scope).toEqual({ access: 'full' });
    legacyKey = l.body.apiKey;
  });

  afterAll(async () => {
    await ctx?.cleanup();
  });

  describe('выдача', () => {
    it('список ключей отдаёт scope', async () => {
      const res = await http().get('/api/desktop/pairing-keys').set(authHeader(jwt));
      expect(res.status).toBe(200);
      const byLabel = Object.fromEntries(
        (res.body as Array<{ label: string; scope: unknown }>).map((k) => [k.label, k.scope]),
      );
      expect(byLabel['e2e-read']).toEqual({ access: 'read', apps: ['inventory'] });
      expect(byLabel['e2e-write']).toEqual({ access: 'write' });
      expect(byLabel['e2e-legacy']).toEqual({ access: 'full' });
    });

    it('неверный scope → 400', async () => {
      expect((await issue({ scope: { access: 'root' } })).status).toBe(400);
      expect((await issue({ scope: { access: 'read', apps: ['Bad-Name'] } })).status).toBe(400);
    });
  });

  describe('read-ключ', () => {
    it('читает → 200', async () => {
      const res = await http().get('/api/materials').set(authHeader(readKey));
      expect(res.status).toBe(200);
    });

    it('пишет → 403', async () => {
      const res = await http()
        .post('/api/materials')
        .set(authHeader(readKey))
        .send({ name: 'RO', article: 'KS-RO-1', unit: 'шт' });
      expect(res.status).toBe(403);
      expect(String(res.body.message)).toMatch(/только для чтения/);
    });

    it('админ-чтение → 403 (и через X-Access-Token)', async () => {
      const res = await http().get('/api/admin/users').set('X-Access-Token', readKey);
      expect(res.status).toBe(403);
    });
  });

  describe('write-ключ', () => {
    it('пишет → 201', async () => {
      const res = await http()
        .post('/api/materials')
        .set(authHeader(writeKey))
        .send({ name: 'RW', article: 'KS-RW-1', unit: 'шт' });
      expect([200, 201]).toContain(res.status);
    });

    it('/api/admin/* → 403', async () => {
      const res = await http().get('/api/admin/users').set(authHeader(writeKey));
      expect(res.status).toBe(403);
      expect(String(res.body.message)).toMatch(/администрированию/);
    });

    it('не может выдавать ключи и менять роли/пользователей', async () => {
      const k = await http()
        .post('/api/desktop/pairing-keys')
        .set(authHeader(writeKey))
        .send({ apiBaseUrl: 'http://localhost:3001' });
      expect(k.status).toBe(403);
      expect((await http().get('/api/desktop/pairing-keys').set(authHeader(writeKey))).status).toBe(
        403,
      );
      expect((await http().get('/api/roles').set(authHeader(writeKey))).status).toBe(403);
      const u = await http()
        .post('/api/users')
        .set(authHeader(writeKey))
        .send({ username: 'x', password: 'xxxxxxxxxx' });
      expect(u.status).toBe(403);
    });
  });

  describe('старый ключ без scope', () => {
    it('работает как раньше: пишет и ходит в админку', async () => {
      const m = await http()
        .post('/api/materials')
        .set(authHeader(legacyKey))
        .send({ name: 'LG', article: 'KS-LG-1', unit: 'шт' });
      expect([200, 201]).toContain(m.status);
      const a = await http().get('/api/admin/users').set(authHeader(legacyKey));
      expect(a.status).toBe(200);
    });
  });

  describe('JWT-сессия не затронута', () => {
    it('админ по JWT ходит в /api/admin', async () => {
      const res = await http().get('/api/admin/users').set(authHeader(jwt));
      expect(res.status).toBe(200);
    });
  });
});
