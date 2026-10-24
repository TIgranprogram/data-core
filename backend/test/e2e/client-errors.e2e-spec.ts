import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { DesktopPairingKeyService } from '../../src/modules/desktop/desktop-pairing-key.service';

/**
 * ОШ2.1 — приём ошибок приложения: POST /api/client-errors (вошедший; kppd_ — 403; 20/мин — сверх 204 без записи),
 * GET /api/client-errors/top (admin). Приватность: в сохранённом нет query адресов и токенов.
 */
describe('Ошибки клиента (ОШ2.1)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const tok: Record<string, string> = {};
  const uid: Record<string, string> = {};
  const coll = () => ctx!.connection.collection('clienterrors');

  const user = async (key: string, role: string) => {
    const username = `ce-${key}-${Date.now()}`;
    const u = (await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role }).expect(201)).body;
    uid[key] = u.id ?? u.user?.id;
    tok[key] = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
  };

  // тело — ровно как шлёт pwa/core/errors.js (все поля контракта)
  const full = (over: Record<string, unknown> = {}) => ({
    message: 'Cannot read properties of undefined (reading \'id\')',
    name: 'TypeError',
    stack: 'TypeError: x\n    at render (https://h/db/app/sections/stock.js:10:5)',
    section: 'stock',
    action: 'открыть раздел',
    kind: 'unhandled',
    status: 500,
    url: '/stock/items',
    version: '2026-10-24',
    ua: 'Mozilla/5.0 e2e',
    ...over,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    await user('manager', 'manager');
    await user('flood', 'manager');
    await user('priv', 'manager');
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('admin и manager: 204 и запись (sig, userId, role, createdAt)', async () => {
    await http().post('/api/client-errors').set(as(admin.access)).send(full({ message: 'admin boom 1' })).expect(204);
    await http().post('/api/client-errors').set(as(tok.manager)).send(full({ message: 'manager boom 7' })).expect(204);
    const a = await coll().findOne({ message: 'admin boom 1' });
    const m = await coll().findOne({ message: 'manager boom 7' });
    expect(a).toBeTruthy();
    expect(m).toBeTruthy();
    expect(m!.role).toBe('manager');
    expect(String(m!.userId)).toBe(uid.manager);
    expect(m!.sig).toMatch(/^[0-9a-f]{16}$/);
    expect(m!.createdAt).toBeInstanceOf(Date);
    expect(m!.section).toBe('stock');
    expect(m!.kind).toBe('unhandled');
  });

  it('минимальное тело (message + kind) — 204', async () => {
    await http().post('/api/client-errors').set(as(tok.manager)).send({ message: 'мин', kind: 'background' }).expect(204);
  });

  it('лишнее поле (данные формы) не записывается (400 — в юните с pipe как в main.ts)', async () => {
    await http().post('/api/client-errors').set(as(tok.manager)).send({ ...full({ message: 'extra field' }), form: { password: 'p@ss' } });
    const d = await coll().findOne({ message: 'extra field' });
    if (d) expect(d).not.toHaveProperty('form');
  });

  it('без входа — 401; ключ kppd_ — 403 и нет записи', async () => {
    await http().post('/api/client-errors').send(full()).expect(401);
    const svc = app.get(DesktopPairingKeyService);
    const me = (await http().get('/api/auth/me').set(as(admin.access)).expect(200)).body;
    const u = me.user ?? me;
    const key = (await svc.issue({ id: u.id, username: u.username, role: u.role, permissions: [], organizationId: null } as never, { label: 'e2e-ce', apiBaseUrl: 'http://localhost' } as never)).apiKey as string;
    expect(key.startsWith('kppd_')).toBe(true);
    await http().post('/api/client-errors').set({ Authorization: `Bearer ${key}` }).send(full({ message: 'by key' })).expect(403);
    expect(await coll().countDocuments({ message: 'by key' })).toBe(0);
  });

  it('25 одинаковых за минуту — все 204 (не 429), записано не больше 20', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 25; i++) {
      codes.push((await http().post('/api/client-errors').set(as(tok.flood)).send(full({ message: 'flood same' }))).status);
    }
    expect(codes.every((c) => c === 204)).toBe(true);
    const n = await coll().countDocuments({ message: 'flood same' });
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(20);
  });

  it('top: admin — группировка по sig (count, users), manager — 403', async () => {
    const res = (await http().get('/api/client-errors/top?hours=24').set(as(admin.access)).expect(200)).body;
    expect(Array.isArray(res.items)).toBe(true);
    const flood = res.items.find((x: { message: string }) => x.message === 'flood same');
    expect(flood).toBeTruthy();
    expect(flood.count).toBe(20);
    expect(flood.users).toBe(1);
    expect(flood.sig).toMatch(/^[0-9a-f]{16}$/);
    expect(flood.sampleStack).toContain('stock.js:10:5');
    // по убыванию count
    const counts = res.items.map((x: { count: number }) => x.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    // разные id в тексте — одна группа
    await http().post('/api/client-errors').set(as(tok.manager)).send(full({ message: 'Позиция 111 не найдена' })).expect(204);
    await http().post('/api/client-errors').set(as(tok.manager)).send(full({ message: 'Позиция 222 не найдена' })).expect(204);
    const r2 = (await http().get('/api/client-errors/top').set(as(admin.access)).expect(200)).body;
    const g = r2.items.find((x: { message: string }) => /^Позиция \d+ не найдена$/.test(x.message));
    expect(g.count).toBe(2);
    await http().get('/api/client-errors/top').set(as(tok.manager)).expect(403);
  });

  it('приватность: в сохранённом нет «секрет», query, Bearer, kppd_, JWT, длинного hex', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    const hex = 'a3f9c2e17b4d8f0e6a5c3b2d1e0f9a8b7c6d5e4f';
    const secretMsg = `GET /api/stock/items?search=секрет failed; Authorization: Bearer abc.def.ghi; key kppd_xxxxxxxx; token ${jwt}; sum ${hex}`;
    await http().post('/api/client-errors').set(as(tok.priv)).send(full({
      message: secretMsg,
      url: '/api/stock/items?search=секрет',
      section: 'stock?search=секрет',
      action: 'поиск ?q=секрет',
      stack: `Error: x\n    at f (https://h/db/app/api.js?search=секрет:3:7)\n  ${jwt}`,
    })).expect(204);
    const docs = await coll().find({ userId: { $exists: true } }).toArray();
    const mine = docs.filter((d) => String(d.userId) === uid.priv);
    expect(mine).toHaveLength(1);
    const d = mine[0];
    const all = JSON.stringify(d);
    expect(all).not.toContain('секрет');
    expect(all).not.toContain('search=');
    expect(all).not.toContain('abc.def.ghi');
    expect(all).not.toContain('kppd_xxxxxxxx');
    expect(all).not.toContain('eyJhbGciOi');
    expect(all).not.toContain(hex);
    expect(d.url).toBe('/api/stock/items');
    expect(d.section).toBe('stock');
    expect(d.stack).toContain('api.js:3:7');
  });
});
