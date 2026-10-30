import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { ControlService } from '../../src/modules/control/control.service';
import { METRIC_KEYS } from '../../src/modules/control/control.catalog';

/** CC-10…13: /api/control — только admin; приём прогона и снимок дня идемпотентны. */
describe('Состояние сайта (CC-10…13)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let manager = '';
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);

  const run = (over: Record<string, unknown> = {}) => ({
    date: '2026-10-31T01:00:00.000Z', commit: 'e2ec0de', quick: true, durationMs: 4200, total: 2, green: 1, red: 1, failed: ['unit'],
    steps: [
      { step: 'tsc', code: 0, ms: 100, commit: 'e2ec0de', ok: true, signature: null, tail: 'ok' },
      { step: 'unit', code: 1, ms: 200, commit: 'e2ec0de', ok: false, signature: 'unit:abc12345', tail: 'FAIL x' },
    ],
    ...over,
  });

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    const username = `ctl-${Date.now()}`;
    await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role: 'manager' }).expect(201);
    manager = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('без входа — 401, менеджер — 403 на всех маршрутах', async () => {
    for (const [m, p] of [['get', '/api/control/catalog'], ['get', '/api/control/daily'], ['get', '/api/control/monthly'], ['post', '/api/control/runs']] as const) {
      await http()[m](p).expect(401);
      await http()[m](p).set(as(manager)).send(m === 'post' ? run() : undefined).expect(403);
    }
  });

  it('каталог: показатели с подписями и источником', async () => {
    const r = (await http().get('/api/control/catalog').set(as(admin.access)).expect(200)).body;
    expect(r.total).toBe(METRIC_KEYS.length);
    expect(r.items.find((i: { key: string }) => i.key === 'data.dup_partners').sourceNote).toContain('ещё нет источника');
    expect(r).toHaveProperty('page');
    expect(r).toHaveProperty('limit');
  });

  it('POST /runs: повтор того же прогона не плодит записи; провал хранится год', async () => {
    const a = (await http().post('/api/control/runs').set(as(admin.access)).send(run()).expect(201)).body;
    const b = (await http().post('/api/control/runs').set(as(admin.access)).send(run()).expect(201)).body;
    expect(a.created).toBe(true);
    expect(b).toEqual({ id: a.id, created: false });
    const col = ctx!.connection.collection('app_control_runs');
    expect(await col.countDocuments({})).toBe(1);
    const doc = await col.findOne({});
    const days = (doc!.keepUntil.getTime() - doc!.receivedAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(365);
    expect(doc!.steps[1].signature).toBe('unit:abc12345');
  });

  it('POST /runs: плохое тело — 400, хвост шага режется до 4 КБ', async () => {
    await http().post('/api/control/runs').set(as(admin.access)).send(run({ steps: [{ step: 'x', code: 'плохо', ms: 1, ok: true }] })).expect(400);
    await http().post('/api/control/runs').set(as(admin.access)).send(run({ date: 'вчера' })).expect(400);
    const big = run({ commit: 'bigtail', steps: [{ step: 'unit', code: 0, ms: 1, ok: true, tail: 'z'.repeat(9000) }], red: 0, failed: [] });
    await http().post('/api/control/runs').set(as(admin.access)).send(big).expect(201);
    const doc = await ctx!.connection.collection('app_control_runs').findOne({ commit: 'bigtail' });
    expect(doc!.steps[0].tail.length).toBe(4096);
  });

  it('снимок дня идемпотентен; daily/monthly отдают {items,total,page,limit}, null ≠ 0', async () => {
    const svc = app.get(ControlService);
    const now = new Date();
    expect((await svc.snapshotDay(now, { force: true })).created).toBe(true);
    expect((await svc.snapshotDay(now)).created).toBe(false);
    const r = (await http().get('/api/control/daily').set(as(admin.access)).expect(200)).body;
    expect(r).toMatchObject({ total: 1, page: 1 });
    expect(r.items).toHaveLength(1);
    const m = r.items[0].m as Record<string, number | null>;
    expect(Object.keys(m).sort()).toEqual([...METRIC_KEYS].sort());
    expect(m['data.dup_partners']).toBeNull();
    expect(typeof m['business.requests_open']).toBe('number');
    expect(m['code.steps_red']).toBe(0); // берётся последний принятый прогон («bigtail», без провалов)
    expect(m['code.e2e_ok']).toBeNull(); // шага e2e в нём не было: null, не 0
    const mo = (await http().get('/api/control/monthly').set(as(admin.access)).expect(200)).body;
    expect(mo.total).toBe(1);
    expect(mo.items[0].m['business.requests_open'].n).toBe(1);
    await http().get('/api/control/daily?from=вчера').set(as(admin.access)).expect(400);
    const none = (await http().get('/api/control/daily?from=2000-01-01&to=2000-01-31').set(as(admin.access)).expect(200)).body;
    expect(none).toMatchObject({ items: [], total: 0 });
  });
});
