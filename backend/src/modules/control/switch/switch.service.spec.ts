import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { FakeDb } from '../questions/fake-db.testkit';
import { SwitchMiddleware } from './switch.middleware';
import { SwitchService } from './switch.service';

/** Мини-соединение: только то, что берёт сервис. */
const make = () => {
  const db = new FakeDb();
  const sw = new SwitchService({ db: { collection: (n: string) => db.collection(n) } } as never);
  return { db, sw, doc: () => db.collection('app_control_state').rows[0] };
};

const res = () => {
  const r = { code: 0, body: undefined as unknown, headers: {} as Record<string, string>,
    status(c: number) { r.code = c; return r; }, json(b: unknown) { r.body = b; return r; }, setHeader(k: string, v: string) { r.headers[k] = v; } };
  return r;
};
const call = (sw: SwitchService, method: string, url: string) => {
  const r = res(); const next = jest.fn();
  new SwitchMiddleware(sw).use({ method, originalUrl: url, url } as never, r as never, next);
  return { r, next };
};

const ready = async (sw: SwitchService) => {
  process.env.HA_PEER_URL = 'http://peer.test';
  const at = new Date().toISOString();
  jest.spyOn(sw, 'appVersion').mockResolvedValue('v1.390');
  jest.spyOn(sw, 'probePeer').mockResolvedValue({ healthy: true, self: 'office', role: 'standby', version: 'v1.390', copyAt: at });
  await sw.report({
    id: 'peer', peer: { version: 'v1.390', copyAt: at, healthy: true },
    domain: { owner: 'home', homeHealthy: true, officeHealthy: true, checkedAt: at },
  }, 'S3CRET', false);
};

describe('SwitchService и режим «только чтение»', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-'));
    process.env.HA_SWITCH_DIR = dir;
    process.env.HA_SELF = 'home';
    await fs.writeFile(path.join(dir, 'alive'), '');
    await fs.writeFile(path.join(dir, 'secret'), 'S3CRET\n');
  });
  afterEach(async () => {
    delete process.env.HA_SELF; delete process.env.HA_SWITCH_DIR; delete process.env.HA_PEER_URL; delete process.env.HA_AUTO_REFRESH_MIN;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('без HA_SELF всё выключено: запись проходит, маршруты 404, база не трогается', async () => {
    delete process.env.HA_SELF;
    const { sw, db } = make();
    await sw.onModuleInit();
    expect(sw.enabled).toBe(false);
    expect(call(sw, 'POST', '/api/orders').next).toHaveBeenCalled();
    expect(call(sw, 'GET', '/api/control/switch').next).toHaveBeenCalled(); // обзор отвечает
    expect(call(sw, 'GET', '/api/control/switch/ping').next).toHaveBeenCalled();
    const c = call(sw, 'POST', '/api/control/switch/start');
    expect(c.r.code).toBe(404);
    expect(c.next).not.toHaveBeenCalled();
    await expect(sw.start()).rejects.toThrow('Not Found');
    expect(db.colls.size).toBe(0);
  });

  it('без HA_SELF обзор: оба сервера, понятные причины, без кнопки и без базы', async () => {
    delete process.env.HA_SELF; delete process.env.HA_PEER_URL;
    const { sw, db } = make();
    const s = await sw.status() as { enabled: boolean; canStart: boolean; canRefresh: boolean; blockers: string[]; peer: { configured: boolean } };
    expect(s.enabled).toBe(false);
    expect(s.canStart).toBe(false);
    expect(s.canRefresh).toBe(false);
    expect(s.peer.configured).toBe(false);
    expect(s.blockers.join(' ')).toMatch(/адрес второго сервера/);
    expect(s.blockers.join(' ')).not.toMatch(/[A-Z_]{4,}/); // без служебных кодов
    expect(db.colls.size).toBe(0);
  });

  it('обзор спрашивает соседа по HA_PEER_URL; копия на этом сервере — из файла last-refresh', async () => {
    delete process.env.HA_SELF;
    process.env.HA_PEER_URL = 'http://peer.test/';
    await fs.writeFile(path.join(dir, 'last-refresh'), new Date(Date.now() - 30 * 60_000).toISOString());
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ self: null, role: null, version: 'v1.400', copyAt: null }) } as never);
    try {
      const { sw } = make();
      const s = await sw.status() as { peer: { healthy: boolean; version: string; copyAgeMin: number }; selfIsCopy: boolean; blockers: string[] };
      expect(spy.mock.calls[0][0]).toBe('http://peer.test/api/control/switch/ping');
      expect(s.peer.healthy).toBe(true);
      expect(s.peer.version).toBe('v1.400');
      expect(s.selfIsCopy).toBe(true);
      expect(s.peer.copyAgeMin).toBe(30);
      const speed = (s as unknown as { speed: { home: { probeMs: number | null }; office: { requests: number | null } } }).speed;
      expect(typeof speed.home.probeMs).toBe('number');
      expect(speed.office.requests).not.toBeNull();
      expect(s.blockers.join(' ')).not.toMatch(/не отвечает|копию/);
      spy.mockRejectedValue(new Error('timeout'));
      const s2 = await sw.status() as { peer: { healthy: boolean }; blockers: string[] };
      expect(s2.peer.healthy).toBe(false);
      expect(s2.blockers).toContain('Второй сервер не отвечает.');
    } finally { spy.mockRestore(); delete process.env.HA_PEER_URL; }
  });

  it('readonly: запись 503 READ_ONLY, чтение и исключения проходят', async () => {
    const { sw, doc } = make();
    await sw.refresh();
    expect(doc().role).toBe('main'); // дом по умолчанию главный
    doc().mode = 'readonly';
    await sw.refresh();
    const blocked = call(sw, 'POST', '/api/salesorders');
    expect(blocked.r.code).toBe(503);
    expect(blocked.r.body).toMatchObject({ code: 'READ_ONLY', message: 'Идёт переключение сервера. Подождите минуту.', retryAfter: 30 });
    expect(blocked.r.headers['Retry-After']).toBe('30');
    expect(blocked.next).not.toHaveBeenCalled();
    for (const [m, u] of [['GET', '/api/salesorders'], ['POST', '/api/auth/login'], ['POST', '/api/auth/refresh'], ['POST', '/api/client-errors'], ['POST', '/api/control/switch/start']]) {
      expect(call(sw, m, u).next).toHaveBeenCalled();
    }
  });

  it('кэш: запрос не ходит в базу, режим меняется после refresh', async () => {
    const { sw, doc } = make();
    await sw.refresh();
    const row = doc();
    row.mode = 'readonly'; // в базе уже readonly, в памяти ещё нет
    const spy = jest.spyOn(FakeDb.prototype, 'collection');
    expect(call(sw, 'POST', '/api/x').next).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
    await sw.refresh();
    expect(call(sw, 'POST', '/api/x').r.code).toBe(503);
    spy.mockRestore();
  });

  it('двойной старт: второй получает 409, заявка записана один раз', async () => {
    const { sw, doc } = make();
    await ready(sw);
    const a = await sw.start();
    expect(a.job.direction).toBe('home->office');
    expect(await fs.readFile(path.join(dir, 'request'), 'utf8')).toContain(`id=${a.job.id}`);
    await expect(sw.start()).rejects.toThrow('уже идёт');
    expect(doc().job.id).toBe(a.job.id);
  });

  it('старт на запасном сервере — 409; без моста — 503', async () => {
    const { sw, doc } = make();
    await sw.refresh();
    doc().role = 'standby';
    await expect(sw.start()).rejects.toThrow('не главный');
    await fs.rm(path.join(dir, 'alive'));
    doc().role = 'main';
    await expect(sw.start()).rejects.toThrow('Мост');
  });

  it('аварийный подъём только на запасном', async () => {
    const { sw, doc } = make();
    await sw.refresh();
    await expect(sw.emergency()).rejects.toThrow('уже главный');
    doc().role = 'standby';
    const r = await sw.emergency();
    expect(r.job.direction).toBe('emergency');
    expect(await fs.readFile(path.join(dir, 'request'), 'utf8')).toContain('kind=emergency');
  });

  it('обновление запасного: kind=refresh с главного; canRefresh гаснет при работе, не главном, чтении и без моста', async () => {
    const { sw, doc } = make();
    const st = await sw.status() as { canRefresh: boolean; canStart: boolean };
    expect(st.canRefresh).toBe(true);
    expect(st.canStart).toBe(false);
    const r = await sw.refreshPeer();
    expect(r.job.direction).toBe('refresh');
    expect(await fs.readFile(path.join(dir, 'request'), 'utf8')).toContain('kind=refresh');
    await expect(sw.refreshPeer()).rejects.toThrow('уже идёт');
    await expect(sw.start()).rejects.toThrow('уже идёт');
    expect((await sw.status() as { canRefresh: boolean }).canRefresh).toBe(false);
    await sw.report({ id: r.job.id, state: 'failed', error: 'стоп' }, 'S3CRET', false);
    doc().role = 'standby';
    expect((await sw.status() as { canRefresh: boolean }).canRefresh).toBe(false);
    await expect(sw.refreshPeer()).rejects.toThrow('не главный');
    doc().role = 'main'; doc().mode = 'readonly';
    const ro = await sw.status() as { canRefresh: boolean; canStart: boolean };
    expect(ro.canRefresh).toBe(false);
    expect(ro.canStart).toBe(false);
    doc().mode = 'normal';
    await fs.rm(path.join(dir, 'alive'));
    expect((await sw.status() as { canRefresh: boolean }).canRefresh).toBe(false);
    await expect(sw.refreshPeer()).rejects.toThrow('Мост');
  });

  it('отчёт: без секрета и через прокси — 403; по секрету меняет шаг, режим и роль', async () => {
    const { sw, doc } = make();
    await ready(sw);
    const { job } = await sw.start();
    await expect(sw.report({ id: job.id, step: 'x' }, undefined, false)).rejects.toThrow('только от моста');
    await expect(sw.report({ id: job.id, step: 'x' }, 'S3CRET', true)).rejects.toThrow('только от моста');
    await expect(sw.report({ id: job.id, step: 'x' }, 'wrong', false)).rejects.toThrow('только от моста');
    await sw.report({ id: job.id, step: 'readonly', state: 'running', mode: 'readonly' }, 'S3CRET', false);
    expect(doc().mode).toBe('readonly');
    expect(sw.isReadOnly()).toBe(true);
    await expect(sw.report({ id: 'чужой', step: 'x' }, 'S3CRET', false)).rejects.toThrow('другой работе');
    await sw.report({ id: job.id, step: 'finish', state: 'done', role: 'standby', mode: 'readonly' }, 'S3CRET', false);
    expect(doc()).toMatchObject({ role: 'standby', mode: 'readonly', job: { state: 'done', step: 'finish' } });
    await expect(sw.report({ id: job.id, state: 'running' }, 'S3CRET', false)).rejects.toThrow('завершена');
    // C135: поздний «сбой» повторного запуска не переписывает «готово»
    await expect(sw.report({ id: job.id, step: 'preflight', state: 'failed', error: 'x' }, 'S3CRET', false)).rejects.toThrow('завершена');
    expect(doc().job).toMatchObject({ state: 'done', step: 'finish' });
  });

  it('ошибка до переключения возвращает обычный режим и сохраняет текст', async () => {
    const { sw, doc } = make();
    await ready(sw);
    const { job } = await sw.start();
    await sw.report({ id: job.id, step: 'readonly', mode: 'readonly' }, 'S3CRET', false);
    await sw.report({ id: job.id, step: 'dump', state: 'failed', error: 'нет места' }, 'S3CRET', false);
    expect(doc()).toMatchObject({ mode: 'normal', role: 'main', job: { state: 'failed', error: 'нет места' } });
    expect(sw.isReadOnly()).toBe(false);
    await fs.rm(path.join(dir, 'request'));
    await sw.start(); // после провала можно запускать снова
  });

  it('вернувшийся старый главный: id=self меняет роль, пока нет работы', async () => {
    const { sw, doc } = make();
    await sw.report({ id: 'self', role: 'standby', mode: 'readonly' }, 'S3CRET', false);
    expect(doc()).toMatchObject({ role: 'standby', mode: 'readonly' });
    expect(sw.isReadOnly()).toBe(true);
    doc().role = 'main'; doc().mode = 'normal';
    await ready(sw);
    await sw.start();
    await expect(sw.report({ id: 'self', role: 'standby' }, 'S3CRET', false)).rejects.toThrow('Идёт переключение');
  });

  it('предупреждение моста попадает в job.error без провала', async () => {
    const { sw, doc } = make();
    await ready(sw);
    const { job } = await sw.start();
    await sw.report({ id: job.id, step: 'preflight', state: 'running', error: 'CRM kppdf запущена' }, 'S3CRET', false);
    expect(doc().job).toMatchObject({ state: 'running', error: 'CRM kppdf запущена' });
  });

  it('сведения о втором сервере принимаются без работы', async () => {
    const { sw } = make();
    await sw.report({ id: 'peer', peer: { version: 'v1.390', copyAt: new Date(Date.now() - 3 * 60_000).toISOString(), healthy: true } }, 'S3CRET', false);
    const st = await sw.status();
    expect(st.peer).toMatchObject({ name: 'office', version: 'v1.390', healthy: true, copyAgeMin: 3 });
    expect(st).toMatchObject({ self: 'home', role: 'main', canStart: false, canRefresh: true, canEmergency: false, switchReadiness: { state: 'unknown' } });
  });

  it('идущая работа при живом мосте не бросается по возрасту; без моста — снимает «только чтение»', async () => {
    const { sw, doc } = make();
    await ready(sw);
    const { job } = await sw.start();
    await sw.report({ id: job.id, step: 'readonly', mode: 'readonly' }, 'S3CRET', false);
    doc().job.startedAt = new Date(Date.now() - 600 * 60_000).toISOString();
    await sw.refresh();
    expect(doc()).toMatchObject({ mode: 'readonly', job: { state: 'running' } }); // мост жив — ждём
    await fs.rm(path.join(dir, 'alive'));
    await sw.refresh();
    expect(doc()).toMatchObject({ mode: 'normal', job: { state: 'failed' } });
    expect(sw.isReadOnly()).toBe(false);
  });

  it('при потере heartbeat во время VPS сохраняет readonly до подтверждения от моста', async () => {
    const { sw, doc } = make();
    await ready(sw);
    const { job } = await sw.start();
    await sw.report({ id: job.id, step: 'vps', state: 'running', mode: 'readonly' }, 'S3CRET', false);
    await fs.rm(path.join(dir, 'alive'));
    await sw.refresh();
    expect(doc()).toMatchObject({ mode: 'readonly', job: { state: 'running', step: 'vps' } });
    expect(sw.isReadOnly()).toBe(true);
    const summary = await sw.status();
    expect(summary).toMatchObject({
      canStart: false, canRefresh: false,
      job: { warning: expect.stringContaining('ещё не подтверждён') },
      switchReadiness: { reasons: expect.arrayContaining([expect.stringContaining('Дождитесь восстановления')]) },
    });
    await expect(sw.refreshPeer()).rejects.toThrow('уже идёт');
    await sw.report({ id: job.id, step: 'finish', state: 'done', role: 'standby', mode: 'readonly' }, 'S3CRET', false);
    expect(doc()).toMatchObject({ role: 'standby', mode: 'readonly', job: { state: 'done' } });
  });

  it('legacy env сохраняет автоматическое обновление только данных, паузу и последнее время после рестарта', async () => {
    const { sw, db } = make();
    const restarted = new SwitchService({ db: { collection: (name: string) => db.collection(name) } } as never);
    const at = new Date(Date.now() - 20 * 60_000).toISOString();
    await sw.report({ id: 'peer', peer: { healthy: true, copyAt: at } }, 'S3CRET', false);
    process.env.HA_AUTO_REFRESH_MIN = '0';
    expect(await sw.getSchedule()).toMatchObject({ revision: 0, data: { enabled: false }, code: { enabled: false } });
    expect((await sw.autoRefresh()).queued).toBe(false);
    process.env.HA_AUTO_REFRESH_MIN = '10';
    expect((await sw.autoRefresh()).queued).toBe(true);
    const file = path.join(dir, 'request');
    expect(await fs.readFile(file, 'utf8')).toContain('code=0');
    const job = (await sw.refresh())!.job!;
    await fs.rm(file);
    await sw.report({ id: job.id, state: 'done' }, 'S3CRET', false);
    expect((await restarted.autoRefresh()).queued).toBe(false);
    expect(await restarted.getSchedule()).toMatchObject({ runs: { data: { lastState: 'done', lastSuccessAt: expect.any(String) } } });
  });

  it('после ошибки публикации остаётся failed; разрешён один повтор, сбой restore завершает слот', async () => {
    const { sw, doc } = make();
    await sw.refresh();
    const minute = 60_000;
    const midnight = Date.parse('2026-11-16T00:00:00Z');
    const now = midnight + minute;
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    const failLink = jest.spyOn(fs, 'link').mockRejectedValueOnce(Object.assign(new Error('нет прав'), { code: 'EACCES' }));
    try {
      doc().scheduleConfig = {
        revision: 1, timezone: 'Europe/Moscow', savedAt: new Date(midnight - minute).toISOString(),
        data: { enabled: false, mode: 'interval', intervalMinutes: 15, days: [], time: '03:00' },
        code: { enabled: true, days: [1], time: '03:00' },
      };
      const checked = new Date(now).toISOString();
      doc().domain = { owner: 'home', homeHealthy: true, officeHealthy: true, checkedAt: checked };
      doc().peerCheckedAt = checked;
      doc().peerHealthy = true;
      const alive = path.join(dir, 'alive');
      const heartbeat = async (at: number) => fs.utimes(alive, new Date(at), new Date(at));
      await heartbeat(now);
      expect((await sw.autoRefresh()).queued).toBe(false);
      const failed = doc().job;
      expect(failed).toMatchObject({ state: 'failed', error: expect.stringContaining('папку заявок') });
      expect(doc().scheduleRuntime.code).toMatchObject({ lastState: 'failed', nextRetryAt: new Date(now + 3 * minute).toISOString() });
      clock.mockReturnValue(now + 2 * minute);
      expect((await sw.autoRefresh()).queued).toBe(false);
      clock.mockReturnValue(now + 3 * minute);
      await heartbeat(now + 3 * minute);
      expect((await sw.autoRefresh()).queued).toBe(true);
      const job = doc().job;
      expect(job.id).not.toBe(failed.id);
      expect(job.scheduleKeys).toEqual(failed.scheduleKeys);
      expect(await fs.readFile(path.join(dir, 'request'), 'utf8')).not.toContain('code=0');
      expect((await sw.autoRefresh()).queued).toBe(false); // другая операция не начинается, пока этот job занят
      await fs.rm(path.join(dir, 'request'));
      await sw.report({ id: job.id, step: 'restore', state: 'running' }, 'S3CRET', false);
      clock.mockReturnValue(now + 7 * minute); // heartbeat этого моста устарел
      await sw.refresh();
      expect(doc().scheduleRuntime.code).toMatchObject({ attempts: 2, lastState: 'failed', nextRetryAt: null, lastError: expect.stringContaining('перестал отвечать') });
    } finally {
      failLink.mockRestore();
      clock.mockRestore();
    }
  });
});
