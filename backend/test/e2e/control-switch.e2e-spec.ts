import request from 'supertest';
import os from 'os';
import { createServer, type Server } from 'http';
import type { AddressInfo } from 'net';
import path from 'path';
import { promises as fs } from 'fs';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { COL_STATE, STATE_ID } from '../../src/modules/control/switch/switch.rules';
import { SwitchService } from '../../src/modules/control/switch/switch.service';

/** SW-2…SW-5: «Переключить сейчас» — права, 404 без HA_SELF, режим «только чтение», двойной старт, отчёт моста. Только тестовая БД. */
describe('Переключение сервера (SW-2…SW-5)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let manager = '';
  let dir = '';
  let sw: SwitchService;
  let peerHttp: Server;
  let peerHealthy = true;
  let peerVersion = 'v1.390';
  let peerName: 'home' | 'office' = 'office';
  const state = () => ctx!.connection.db!.collection<{ _id: string }>(COL_STATE);
  const file = (name: string) => path.join(dir, name);
  const MS = 60_000;
  const config = {
    timezone: 'Europe/Moscow',
    data: { enabled: true, mode: 'interval', intervalMinutes: 5, time: '03:00', days: [1, 2, 3, 4, 5, 6, 7] },
    code: { enabled: false, time: '03:00', days: [] as number[] },
  };
  const advertise = () => {
    const at = new Date().toISOString();
    return report({
      id: 'peer', peer: { healthy: true, version: 'v1.390', copyAt: at },
      domain: { owner: 'home', homeHealthy: true, officeHealthy: true, checkedAt: at },
    }).expect(200);
  };
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const S = '/api/control/switch';
  const report = (body: Record<string, unknown>, secret = 'E2ESECRET') => http().post(`${S}/report`).set('X-Switch-Secret', secret).send(body);

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-e2e-'));
    await fs.writeFile(path.join(dir, 'alive'), '');
    await fs.writeFile(path.join(dir, 'secret'), 'E2ESECRET\n');
    process.env.HA_SWITCH_DIR = dir;
    process.env.HA_AUTO_REFRESH_MIN = '15';
    process.env.HA_PEER_URL = '';
    const versionFile = file('version.json');
    await fs.writeFile(versionFile, JSON.stringify({ n: 390 }));
    process.env.PWA_VERSION_FILE = versionFile;
    peerHttp = createServer((req, res) => {
      if (req.url === '/api/health/ready') {
        res.writeHead(peerHealthy ? 200 : 503).end();
      } else if (req.url === '/api/control/switch/ping') {
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          self: peerName, role: 'standby', version: peerVersion, copyAt: new Date().toISOString(),
        }));
      } else res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => peerHttp.listen(0, '127.0.0.1', resolve));
    process.env.HA_SELF = ''; // пустая строка, а не delete: .env из окружения теста не перезапишет; сначала приложение с выключенным механизмом
    ctx = await createTestApp({ strictValidation: true });
    app = ctx.app;
    sw = app.get(SwitchService);
    admin = await loginAsAdmin(app);
    const username = `sw-${Date.now()}`;
    await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role: 'manager' }).expect(201);
    manager = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
  });
  afterAll(async () => {
    delete process.env.HA_SELF; delete process.env.HA_SWITCH_DIR;
    delete process.env.HA_PEER_URL; delete process.env.PWA_VERSION_FILE; delete process.env.HA_AUTO_REFRESH_MIN;
    if (peerHttp) await new Promise<void>((resolve) => peerHttp.close(() => resolve()));
    await ctx?.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  }, 120_000);

  it('без HA_SELF: все маршруты 404, запись работает', async () => {
    expect((await http().get(S).set(as(admin.access)).expect(200)).body.enabled).toBe(false); // обзор доступен и без HA_SELF
    await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(404);
    await http().post(`${S}/report`).send({ id: 'peer' }).expect(404);
    await http().post('/api/client-errors').set(as(admin.access)).send({ message: 'проверка', kind: 'action' }).expect(204);
  });

  describe('с HA_SELF=home', () => {
    beforeAll(async () => {
      process.env.HA_SELF = 'home';
      process.env.HA_PEER_URL = 'http://127.0.0.1:' + (peerHttp.address() as AddressInfo).port;
      await sw.refresh();
    });

    it('права: без входа 401, менеджер 403; отчёт без секрета 403', async () => {
      await http().get(S).expect(401);
      await http().get(S).set(as(manager)).expect(403);
      await http().post(`${S}/start`).set(as(manager)).send({ confirm: true }).expect(403);
      await http().post(`${S}/refresh`).set(as(manager)).send({ confirm: true }).expect(403);
      await report({ id: 'peer' }, 'wrong').expect(403);
      await http().post(`${S}/report`).set('X-Switch-Secret', 'E2ESECRET').set('X-Forwarded-For', '1.2.3.4').send({ id: 'peer' }).expect(403);
    });

    it('состояние: дом главный, обычный режим, мост жив', async () => {
      const r = (await http().get(S).set(as(admin.access)).expect(200)).body;
      expect(r).toMatchObject({ enabled: true, self: 'home', role: 'main', mode: 'normal', job: null, bridge: { alive: true }, canStart: false, canRefresh: true, canEmergency: false, switchReadiness: { state: 'unknown' } });
      expect(r.peer.name).toBe('office');
      expect(r.domain).toEqual({ owner: null, homeHealthy: null, officeHealthy: null, checkedAt: null });
      await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(409);
    });

    it('старт требует confirm; аварийный подъём на главном — 409', async () => {
      await http().post(`${S}/start`).set(as(admin.access)).send({}).expect(400);
      await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: false }).expect(400);
      await http().post(`${S}/emergency`).set(as(admin.access)).send({ confirm: 'да' }).expect(400);
      await http().post(`${S}/emergency`).set(as(admin.access)).send({ confirm: 'Я ПОНИМАЮ' }).expect(409);
    });

    it('плановый старт повторно проверяет свежесть моста и реальный health/версию соседа', async () => {
      await advertise();
      expect((await http().get(S).set(as(admin.access)).expect(200)).body).toMatchObject({ canStart: true, switchReadiness: { state: 'ready' } });
      peerHealthy = false;
      try {
        expect((await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(409)).body.details.state).toBe('blocked');
      } finally { peerHealthy = true; }
      peerVersion = 'v1.391';
      try {
        expect((await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(409)).body.message.join(' ')).toMatch(/Версии кода/);
      } finally { peerVersion = 'v1.390'; }

      peerName = 'home';
      try {
        const fresh = await new SwitchService(ctx!.connection).status();
        expect(fresh).toMatchObject({ canStart: false, switchReadiness: { state: 'blocked', reasons: expect.arrayContaining([expect.stringContaining('ответил этот сервер')]) } });
        expect((await http().post(S + '/start').set(as(admin.access)).send({ confirm: true }).expect(409)).body.details.reasons.join(' ')).toMatch(/ответил этот сервер/);
      } finally { peerName = 'office'; }
      const oldAt = new Date(Date.now() - 8 * MS).toISOString();
      await state().updateOne({ _id: STATE_ID }, { $set: { peerCheckedAt: oldAt } });
      expect((await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(409)).body.details.state).toBe('unknown');
      await advertise();
    });

    it('старт → заявка в файле, повтор 409; мост включает чтение, запись 503, вход работает; провал возвращает запись', async () => {
      const a = (await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(201)).body;
      expect(a.job).toMatchObject({ direction: 'home->office', state: 'queued' });
      expect(await fs.readFile(path.join(dir, 'request'), 'utf8')).toContain(`id=${a.job.id}`);
      await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(409);

      await report({ id: a.job.id, step: 'readonly', state: 'running', mode: 'readonly' }).expect(200);
      await fs.rm(file('request'));
      const blocked = await http().post('/api/client-errors-x').set(as(admin.access)).send({}).expect(503);
      expect(blocked.body).toMatchObject({ code: 'READ_ONLY', message: 'Идёт переключение сервера. Подождите минуту.' });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      await http().get('/api/auth/me').set(as(admin.access)).expect(200);
      await http().post('/api/auth/login').send({ username: 'нет', password: 'нет-нет-нет' }).expect(401);
      await http().post('/api/client-errors').set(as(admin.access)).send({ message: 'проверка', kind: 'action' }).expect(204);
      expect((await http().get(S).set(as(admin.access)).expect(200)).body).toMatchObject({ mode: 'readonly', job: { step: 'readonly', state: 'running' } });

      await report({ id: a.job.id, step: 'dump', state: 'failed', error: 'нет места на диске' }).expect(200);
      const after = (await http().get(S).set(as(admin.access)).expect(200)).body;
      expect(after).toMatchObject({ mode: 'normal', role: 'main', job: { state: 'failed', error: 'нет места на диске' } });
      await http().post('/api/client-errors').set(as(admin.access)).send({ message: 'снова пишет', kind: 'action' }).expect(204);
    });

    it('успех: главным становится второй сервер, этот — запасной и «только чтение»; аварийный подъём возможен', async () => {
      const a = (await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(201)).body;
      await report({ id: a.job.id, step: 'readonly', mode: 'readonly' }).expect(200);
      await fs.rm(file('request'));
      await report({ id: a.job.id, step: 'finish', state: 'done', role: 'standby', mode: 'readonly', peer: { version: 'v1.390', healthy: true } }).expect(200);
      const r = (await http().get(S).set(as(admin.access)).expect(200)).body;
      expect(r).toMatchObject({ role: 'standby', mode: 'readonly', job: { state: 'done' }, canStart: false, canEmergency: true });
      expect(r.peer.version).toBe('v1.390');
      await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(409);

      const e = (await http().post(`${S}/emergency`).set(as(admin.access)).send({ confirm: 'Я ПОНИМАЮ' }).expect(201)).body;
      expect(e.job.direction).toBe('emergency');
      await fs.rm(file('request'));
      await report({ id: e.job.id, step: 'finish', state: 'done', role: 'main', mode: 'normal' }).expect(200);
      expect((await http().get(S).set(as(admin.access)).expect(200)).body).toMatchObject({ role: 'main', mode: 'normal', canRefresh: true });
      const rf = (await http().post(`${S}/refresh`).set(as(admin.access)).send({ confirm: true }).expect(201)).body;
      expect(rf.job).toMatchObject({ direction: 'refresh', refreshScope: 'both' });
      expect(await fs.readFile(path.join(dir, 'request'), 'utf8')).toContain('kind=refresh');
      await http().post(`${S}/refresh`).set(as(admin.access)).send({}).expect(400);
      await http().post(`${S}/refresh`).set(as(admin.access)).send({ confirm: true }).expect(409);
      await fs.rm(file('request'));
      await report({ id: rf.job.id, state: 'done' }).expect(200);
    });

    it('расписание: admin, строгие DTO, CAS двух операторов и чтение сохранённого из Mongo', async () => {
      const get = (token: string) => http().get(S + '/schedule').set(as(token));
      const put = (body: unknown, token = admin.access) => http().put(S + '/schedule').set(as(token)).send(body as object);
      await get(manager).expect(403);
      await put({ ...config, expectedRevision: 0 }, manager).expect(403);
      expect((await get(admin.access).expect(200)).body).toMatchObject({
        revision: 0, timezone: 'Europe/Moscow', data: { enabled: true, intervalMinutes: 15 }, code: { enabled: false }, canEdit: true,
      });
      for (const bad of [
        config,
        { ...config, expectedRevision: 0, paused: true },
        { ...config, expectedRevision: 0, timezone: 'UTC' },
        { ...config, expectedRevision: 0, data: { ...config.data, raw: true } },
        { ...config, expectedRevision: 0, data: { ...config.data, intervalMinutes: 4 } },
        { ...config, expectedRevision: 0, data: { ...config.data, intervalMinutes: 5.5 } },
        { ...config, expectedRevision: 0, data: { ...config.data, time: '24:00' } },
        { ...config, expectedRevision: 0, data: { ...config.data, days: [1, 1] } },
        { ...config, expectedRevision: 0, data: { ...config.data, days: [] } },
        { ...config, expectedRevision: 0, data: { ...config.data, days: [0, 7] } },
        { ...config, expectedRevision: 0, code: { enabled: true, time: '03:00', days: [] } },
      ]) await put(bad).expect(400);
      await http().patch(S + '/schedule').set(as(admin.access)).send({ enabled: false }).expect(404);

      const concurrent = await Promise.all([put({ ...config, expectedRevision: 0 }), put({ ...config, expectedRevision: 0 })]);
      expect(concurrent.map((result) => result.status).sort()).toEqual([200, 409]);
      expect(concurrent.find((result) => result.status === 409)?.body.code).toBe('SCHEDULE_REVISION_CONFLICT');
      expect((await get(admin.access).expect(200)).body).toMatchObject({ revision: 1, data: config.data, code: config.code });
      await state().updateOne({ _id: STATE_ID }, { $set: { mode: 'readonly' } });
      await put({ ...config, expectedRevision: 1 }).expect(409);
      await state().updateOne({ _id: STATE_ID }, { $set: { mode: 'normal', role: 'standby' } });
      await put({ ...config, expectedRevision: 1 }).expect(409);
      expect((await get(admin.access).expect(200)).body.canEdit).toBe(false);
      await state().updateOne({ _id: STATE_ID }, { $set: { role: 'main' } });
    });

    it('два scheduler на Mongo захватывают один слот, restart переотправляет тот же job и сохраняет итог', async () => {
      await advertise();
      const previous = (await sw.getSchedule()).runs.code.lastSuccessAt;
      expect(previous).toBeTruthy(); // предшествующий ручной both
      await state().updateOne({ _id: STATE_ID }, { $set: { 'scheduleConfig.savedAt': new Date(Date.now() - 11 * MS).toISOString() } });
      const competing = new SwitchService(ctx!.connection);
      const race = await Promise.all([sw.autoRefresh(), competing.autoRefresh()]);
      expect(race.map((result) => result.queued).sort()).toEqual([false, true]);
      const job = (await sw.refresh())!.job!;
      expect(job).toMatchObject({ state: 'queued', refreshScope: 'data' });
      expect(job.scheduleKeys?.data).toMatch(/^1:interval:/);
      expect(await fs.readFile(file('request'), 'utf8')).toMatch(/kind=refresh\n.*\ncode=0\nexpiresAt=/s);
      await http().put(S + '/schedule').set(as(admin.access)).send({ ...config, expectedRevision: 1 }).expect(409);

      // Сбой после CAS, перед публикацией: новый процесс не затирает чужие request и current.
      await fs.writeFile(file('request'), 'id=abcdef001122\n');
      await fs.writeFile(file('current'), 'id=abcdef334455\n');
      await state().updateOne({ _id: STATE_ID }, { $set: { bridgeDelivery: { jobId: job.id } } });
      await competing.refresh();
      expect(await fs.readFile(file('request'), 'utf8')).toBe('id=abcdef001122\n');
      await fs.rm(file('request'));
      await competing.refresh();
      await expect(fs.stat(file('request'))).rejects.toHaveProperty('code', 'ENOENT');
      expect(await fs.readFile(file('current'), 'utf8')).toBe('id=abcdef334455\n');
      await fs.rm(file('current'));
      await competing.refresh();
      expect(await fs.readFile(file('request'), 'utf8')).toContain('id=' + job.id);
      await fs.rm(file('request'));
      await report({ id: job.id, step: 'restore', state: 'running' }).expect(200);
      await report({ id: job.id, step: 'finish', state: 'done', error: 'CRM запущена' }).expect(200);
      const runs = (await http().get(S + '/schedule').set(as(admin.access)).expect(200)).body.runs;
      expect(runs.data).toMatchObject({ lastState: 'done', lastError: null, lastWarning: 'CRM запущена' });
      expect(runs.data.lastAttemptAt).toBeTruthy();
      expect(runs.data.lastSuccessAt).toBeTruthy();
      expect(runs.code.lastSuccessAt).toBe(previous);
      expect(runs.data.lastSource).toBe('schedule');
      expect((await competing.autoRefresh()).queued).toBe(false);
      await report({ id: job.id, state: 'failed', step: 'restore' }).expect(409);
    });

    it('доменные данные защищены, ошибка VPS скрывает прошлое подтверждение; пауза не запрещает ручной scope', async () => {
      const observed = { owner: 'home', homeHealthy: true, officeHealthy: true, checkedAt: new Date().toISOString() };
      await report({ id: 'peer', domain: observed }, 'wrong').expect(403);
      await report({ id: 'peer', domain: { ...observed, owner: 'third' } }).expect(400);
      await report({ id: 'peer', domain: { ...observed, checkedAt: '2026-02-30T00:00:00Z' } }).expect(400);
      await report({ id: 'peer', domain: { ...observed, extra: true } }).expect(400);
      await report({ id: 'peer', domain: { ...observed, owner: 'office' } }).expect(200);
      expect((await sw.autoRefresh()).reason).toMatch(/Домен направлен/);
      await report({ id: 'peer', domain: { ...observed, owner: null, homeHealthy: null, officeHealthy: null } }).expect(200);
      const summary = (await http().get(S).set(as(admin.access)).expect(200)).body;
      expect(summary).toMatchObject({
        canStart: false, canRefresh: false, switchReadiness: { state: 'unknown' },
        domain: { owner: null, homeHealthy: null, officeHealthy: null },
      });
      await http().post(S + '/refresh').set(as(admin.access)).send({ confirm: true, scope: 'data' }).expect(409);
      await advertise();
      await http().put(S + '/schedule').set(as(admin.access)).send({
        ...config, expectedRevision: 1, data: { ...config.data, enabled: false, days: [] },
      }).expect(200);
      expect((await sw.autoRefresh()).queued).toBe(false);
      await http().post(S + '/refresh').set(as(admin.access)).send({ confirm: true, scope: 'code' }).expect(400);
      const prior = await sw.refresh();
      const cursor = prior?.scheduleRuntime?.data?.slot;
      expect(cursor).toBeTruthy();

      const hand = (await http().post(S + '/refresh').set(as(admin.access)).send({ confirm: true, scope: 'data' }).expect(201)).body;
      expect(hand.job.refreshScope).toBe('data');
      expect(await fs.readFile(file('request'), 'utf8')).toContain('code=0');
      await fs.rm(file('request'));
      await report({ id: hand.job.id, state: 'done' }).expect(200);
      const dataOnly = (await sw.getSchedule()).runs;
      expect(dataOnly.data).toMatchObject({ lastState: 'done', lastSource: 'manual' });
      expect(dataOnly.code.lastSuccessAt).toBe(prior?.scheduleRuntime?.code?.lastSuccessAt);
      const both = (await http().post(S + '/refresh').set(as(admin.access)).send({ confirm: true }).expect(201)).body;
      await fs.rm(file('request'));
      await report({ id: both.job.id, state: 'done', warning: 'Работы завершены с замечанием' }).expect(200);
      const bothRuns = (await sw.getSchedule()).runs;
      expect(bothRuns.data.lastSuccessAt).toBe(bothRuns.code.lastSuccessAt);
      expect(bothRuns.code).toMatchObject({ lastSource: 'manual', lastState: 'done', lastWarning: 'Работы завершены с замечанием', lastError: null });
      expect((await sw.refresh())?.scheduleRuntime?.data?.slot).toBe(cursor);

    });
  });
});
