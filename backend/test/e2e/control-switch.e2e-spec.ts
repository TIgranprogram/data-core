import request from 'supertest';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';
import { SwitchService } from '../../src/modules/control/switch/switch.service';

/** SW-2…SW-5: «Переключить сейчас» — права, 404 без HA_SELF, режим «только чтение», двойной старт, отчёт моста. Только тестовая БД. */
describe('Переключение сервера (SW-2…SW-5)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let manager = '';
  let dir = '';
  let sw: SwitchService;
  const http = () => request(app.getHttpServer());
  const as = (t: string) => authHeader(t);
  const S = '/api/control/switch';
  const report = (body: Record<string, unknown>, secret = 'E2ESECRET') => http().post(`${S}/report`).set('X-Switch-Secret', secret).send(body);

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-e2e-'));
    await fs.writeFile(path.join(dir, 'alive'), '');
    await fs.writeFile(path.join(dir, 'secret'), 'E2ESECRET\n');
    process.env.HA_SWITCH_DIR = dir;
    delete process.env.HA_SELF; // сначала приложение с выключенным механизмом
    ctx = await createTestApp();
    app = ctx.app;
    sw = app.get(SwitchService);
    admin = await loginAsAdmin(app);
    const username = `sw-${Date.now()}`;
    await http().post('/api/admin/users').set(as(admin.access)).send({ username, password: 'role-pass-123', role: 'manager' }).expect(201);
    manager = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
  });
  afterAll(async () => {
    delete process.env.HA_SELF; delete process.env.HA_SWITCH_DIR;
    await ctx?.cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  }, 120_000);

  it('без HA_SELF: все маршруты 404, запись работает', async () => {
    await http().get(S).set(as(admin.access)).expect(404);
    await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(404);
    await http().post(`${S}/report`).send({ id: 'peer' }).expect(404);
    await http().post('/api/client-errors').set(as(admin.access)).send({ message: 'проверка', kind: 'action' }).expect(204);
  });

  describe('с HA_SELF=home', () => {
    beforeAll(async () => { process.env.HA_SELF = 'home'; await sw.refresh(); });

    it('права: без входа 401, менеджер 403; отчёт без секрета 403', async () => {
      await http().get(S).expect(401);
      await http().get(S).set(as(manager)).expect(403);
      await http().post(`${S}/start`).set(as(manager)).send({ confirm: true }).expect(403);
      await report({ id: 'peer' }, 'wrong').expect(403);
      await http().post(`${S}/report`).set('X-Switch-Secret', 'E2ESECRET').set('X-Forwarded-For', '1.2.3.4').send({ id: 'peer' }).expect(403);
    });

    it('состояние: дом главный, обычный режим, мост жив', async () => {
      const r = (await http().get(S).set(as(admin.access)).expect(200)).body;
      expect(r).toMatchObject({ enabled: true, self: 'home', role: 'main', mode: 'normal', job: null, bridge: { alive: true }, canStart: true, canEmergency: false });
      expect(r.peer.name).toBe('office');
    });

    it('старт требует confirm; аварийный подъём на главном — 409', async () => {
      await http().post(`${S}/start`).set(as(admin.access)).send({}).expect(400);
      await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: false }).expect(400);
      await http().post(`${S}/emergency`).set(as(admin.access)).send({ confirm: 'да' }).expect(400);
      await http().post(`${S}/emergency`).set(as(admin.access)).send({ confirm: 'Я ПОНИМАЮ' }).expect(409);
    });

    it('старт → заявка в файле, повтор 409; мост включает чтение, запись 503, вход работает; провал возвращает запись', async () => {
      const a = (await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(201)).body;
      expect(a.job).toMatchObject({ direction: 'home->office', state: 'queued' });
      expect(await fs.readFile(path.join(dir, 'request'), 'utf8')).toContain(`id=${a.job.id}`);
      await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(409);

      await report({ id: a.job.id, step: 'readonly', state: 'running', mode: 'readonly' }).expect(200);
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
      await report({ id: a.job.id, step: 'finish', state: 'done', role: 'standby', mode: 'readonly', peer: { version: 'v1.390', healthy: true } }).expect(200);
      const r = (await http().get(S).set(as(admin.access)).expect(200)).body;
      expect(r).toMatchObject({ role: 'standby', mode: 'readonly', job: { state: 'done' }, canStart: false, canEmergency: true });
      expect(r.peer.version).toBe('v1.390');
      await http().post(`${S}/start`).set(as(admin.access)).send({ confirm: true }).expect(409);

      const e = (await http().post(`${S}/emergency`).set(as(admin.access)).send({ confirm: 'Я ПОНИМАЮ' }).expect(201)).body;
      expect(e.job.direction).toBe('emergency');
      await report({ id: e.job.id, step: 'finish', state: 'done', role: 'main', mode: 'normal' }).expect(200);
      expect((await http().get(S).set(as(admin.access)).expect(200)).body).toMatchObject({ role: 'main', mode: 'normal' });
    });
  });
});
