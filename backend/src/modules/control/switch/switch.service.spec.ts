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
    delete process.env.HA_SELF; delete process.env.HA_SWITCH_DIR;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('без HA_SELF всё выключено: запись проходит, маршруты 404, база не трогается', async () => {
    delete process.env.HA_SELF;
    const { sw, db } = make();
    await sw.onModuleInit();
    expect(sw.enabled).toBe(false);
    expect(call(sw, 'POST', '/api/orders').next).toHaveBeenCalled();
    const c = call(sw, 'GET', '/api/control/switch');
    expect(c.r.code).toBe(404);
    expect(c.next).not.toHaveBeenCalled();
    await expect(sw.status()).rejects.toThrow('Not Found');
    await expect(sw.start()).rejects.toThrow('Not Found');
    expect(db.colls.size).toBe(0);
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

  it('отчёт: без секрета и через прокси — 403; по секрету меняет шаг, режим и роль', async () => {
    const { sw, doc } = make();
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
  });

  it('ошибка до переключения возвращает обычный режим и сохраняет текст', async () => {
    const { sw, doc } = make();
    const { job } = await sw.start();
    await sw.report({ id: job.id, step: 'readonly', mode: 'readonly' }, 'S3CRET', false);
    await sw.report({ id: job.id, step: 'dump', state: 'failed', error: 'нет места' }, 'S3CRET', false);
    expect(doc()).toMatchObject({ mode: 'normal', role: 'main', job: { state: 'failed', error: 'нет места' } });
    expect(sw.isReadOnly()).toBe(false);
    await sw.start(); // после провала можно запускать снова
  });

  it('вернувшийся старый главный: id=self меняет роль, пока нет работы', async () => {
    const { sw, doc } = make();
    await sw.report({ id: 'self', role: 'standby', mode: 'readonly' }, 'S3CRET', false);
    expect(doc()).toMatchObject({ role: 'standby', mode: 'readonly' });
    expect(sw.isReadOnly()).toBe(true);
    doc().role = 'main'; doc().mode = 'normal';
    await sw.refresh();
    await sw.start();
    await expect(sw.report({ id: 'self', role: 'standby' }, 'S3CRET', false)).rejects.toThrow('Идёт переключение');
  });

  it('предупреждение моста попадает в job.error без провала', async () => {
    const { sw, doc } = make();
    const { job } = await sw.start();
    await sw.report({ id: job.id, step: 'preflight', state: 'running', error: 'CRM kppdf запущена' }, 'S3CRET', false);
    expect(doc().job).toMatchObject({ state: 'running', error: 'CRM kppdf запущена' });
  });

  it('сведения о втором сервере принимаются без работы', async () => {
    const { sw } = make();
    await sw.report({ id: 'peer', peer: { version: 'v1.390', copyAt: new Date(Date.now() - 3 * 60_000).toISOString(), healthy: true } }, 'S3CRET', false);
    const st = await sw.status();
    expect(st.peer).toMatchObject({ name: 'office', version: 'v1.390', healthy: true, copyAgeMin: 3 });
    expect(st).toMatchObject({ self: 'home', role: 'main', canStart: true, canEmergency: false });
  });

  it('идущая работа при живом мосте не бросается по возрасту; без моста — снимает «только чтение»', async () => {
    const { sw, doc } = make();
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
});
