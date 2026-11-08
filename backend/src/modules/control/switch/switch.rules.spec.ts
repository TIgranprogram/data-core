import { autoRefreshDue, blockedWhenReadOnly, canRefreshNow, copyAgeMin, isSwitchPath, parseSelf, readinessBlockers, routePath, secretMatches, staleReason, versionLabel, versionsConflict, type SwitchJob } from './switch.rules';

const job = (over: Partial<SwitchJob> = {}): SwitchJob => ({ id: 'a', direction: 'home->office', step: 'dump', state: 'running', startedAt: new Date(0).toISOString(), ...over });

describe('переключение: правила', () => {
  it('HA_SELF: только home|office, иначе выключено', () => {
    expect(parseSelf('home')).toBe('home');
    expect(parseSelf('office')).toBe('office');
    for (const v of [undefined, '', 'HOME', 'x']) expect(parseSelf(v)).toBeNull();
  });

  it('путь: без /api, строки запроса и хвостового слэша', () => {
    expect(routePath('/api/auth/login?x=1')).toBe('/auth/login');
    expect(routePath('/auth/login')).toBe('/auth/login');
    expect(routePath('/api/control/switch/')).toBe('/control/switch');
    expect(isSwitchPath('/control/switch/report')).toBe(true);
    expect(isSwitchPath('/control/switchx')).toBe(false);
  });

  it('только чтение: GET проходит, запись нет, исключения проходят', () => {
    expect(blockedWhenReadOnly('GET', '/orders')).toBe(false);
    expect(blockedWhenReadOnly('OPTIONS', '/orders')).toBe(false);
    expect(blockedWhenReadOnly('POST', '/salesorders')).toBe(true);
    expect(blockedWhenReadOnly('PATCH', '/salesorders/1')).toBe(true);
    expect(blockedWhenReadOnly('DELETE', '/x')).toBe(true);
    expect(blockedWhenReadOnly('POST', '/auth/login')).toBe(false);
    expect(blockedWhenReadOnly('POST', '/auth/refresh')).toBe(false);
    expect(blockedWhenReadOnly('POST', '/client-errors')).toBe(false);
    expect(blockedWhenReadOnly('POST', '/control/switch/start')).toBe(false);
    expect(blockedWhenReadOnly('POST', '/auth/logout')).toBe(true);
    expect(blockedWhenReadOnly('POST', '/client-errors-fake')).toBe(true);
  });

  it('секрет: точное сравнение, пустой не подходит', () => {
    expect(secretMatches('abc', 'abc')).toBe(true);
    expect(secretMatches('abd', 'abc')).toBe(false);
    expect(secretMatches('ab', 'abc')).toBe(false);
    expect(secretMatches(undefined, 'abc')).toBe(false);
    expect(secretMatches('', '')).toBe(false);
  });

  it('брошенная работа: ждёт моста 10 мин или мост молчит; по возрасту не бросается', () => {
    const t0 = Date.parse(job().startedAt);
    expect(staleReason(job({ state: 'queued' }), t0 + 5 * 60_000)).toBeNull();
    expect(staleReason(job({ state: 'queued' }), t0 + 11 * 60_000)).toContain('Мост');
    expect(staleReason(job(), t0 + 60 * 60_000)).toBeNull();
    expect(staleReason(job(), t0 + 600 * 60_000, true)).toBeNull(); // долго, но мост жив
    expect(staleReason(job(), t0 + 5 * 60_000, false)).toContain('перестал отвечать');
    expect(staleReason(job({ state: 'done' }), t0 + 999 * 60_000)).toBeNull();
    expect(staleReason(null, t0)).toBeNull();
  });

  it('canRefresh: главный, обычный режим, нет работы, мост жив', () => {
    expect(canRefreshNow('main', 'normal', false, true)).toBe(true);
    expect(canRefreshNow('standby', 'normal', false, true)).toBe(false);
    expect(canRefreshNow('main', 'readonly', false, true)).toBe(false);
    expect(canRefreshNow('main', 'normal', true, true)).toBe(false);
    expect(canRefreshNow('main', 'normal', false, false)).toBe(false);
  });

  it('возраст копии в минутах', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    expect(copyAgeMin('2026-10-31T11:30:00Z', now)).toBe(30);
    expect(copyAgeMin(undefined, now)).toBeNull();
    expect(copyAgeMin('мусор', now)).toBeNull();
  });
});

describe('C042: версии кода и автообновление копии (A3, A5)', () => {
  it('подпись версии: из version.json — «v1.N», без номера — хеш, мусор — null', () => {
    expect(versionLabel({ v: 'abc1234', n: 612 })).toBe('v1.612');
    expect(versionLabel({ v: 'abc1234' })).toBe('abc1234');
    expect(versionLabel({})).toBeNull();
    expect(versionLabel(null)).toBeNull();
    expect(versionLabel('v1.1')).toBeNull();
  });

  it('версии разные — переключать нельзя; неизвестная версия сравнению не мешает', () => {
    expect(versionsConflict('v1.612', 'v1.611')).toBe(true);
    expect(versionsConflict('v1.612', 'v1.612')).toBe(false);
    expect(versionsConflict('v1.612', null)).toBe(false);
    expect(versionsConflict(null, null)).toBe(false);
    const ok = { self: 'home' as const, peerUrlSet: true, peerHealthy: true, copyAgeMin: 10, bridgeAlive: true };
    expect(readinessBlockers({ ...ok, selfVersion: 'v1.612', peerVersion: 'v1.611' }).join(' ')).toMatch(/Версии кода/);
    expect(readinessBlockers({ ...ok, selfVersion: 'v1.612', peerVersion: 'v1.612' })).toEqual([]);
  });

  it('автообновление: только главный, обычный режим, без работы, мост жив, копия старая', () => {
    const base = { role: 'main' as const, mode: 'normal' as const, busy: false, bridgeAlive: true, peerHealthy: true, copyAgeMin: 20, lastAutoAt: 0, now: Date.parse('2026-11-08T10:00:00Z'), minutes: 15 };
    expect(autoRefreshDue(base).due).toBe(true);
    expect(autoRefreshDue({ ...base, copyAgeMin: 5 }).due).toBe(false);
    expect(autoRefreshDue({ ...base, copyAgeMin: null }).due).toBe(true); // копия неизвестна — обновляем
    expect(autoRefreshDue({ ...base, role: 'standby' }).due).toBe(false);
    expect(autoRefreshDue({ ...base, mode: 'readonly' }).due).toBe(false);
    expect(autoRefreshDue({ ...base, busy: true }).due).toBe(false);
    expect(autoRefreshDue({ ...base, bridgeAlive: false }).due).toBe(false);
    expect(autoRefreshDue({ ...base, peerHealthy: null }).due).toBe(false);
    expect(autoRefreshDue({ ...base, minutes: 0 }).due).toBe(false);
    expect(autoRefreshDue({ ...base, lastAutoAt: base.now - 5 * 60_000 }).due).toBe(false); // только что ставили
    expect(autoRefreshDue({ ...base, lastAutoAt: base.now - 16 * 60_000 }).due).toBe(true);
  });
});

describe('readinessBlockers', () => {
  const ok = { self: 'home' as const, peerUrlSet: true, peerHealthy: true, copyAgeMin: 60, bridgeAlive: true };
  it('всё готово — пусто', () => expect(readinessBlockers(ok)).toEqual([]));
  it('старая копия, молчащий сосед, нет моста — три причины', () => {
    expect(readinessBlockers({ ...ok, peerHealthy: false, copyAgeMin: 3000, bridgeAlive: false })).toHaveLength(3);
  });
  it('нет адреса соседа — про адрес, а не «не отвечает»', () => {
    const r = readinessBlockers({ ...ok, peerUrlSet: false, peerHealthy: null });
    expect(r.join(' ')).toMatch(/адрес/);
    expect(r.join(' ')).not.toMatch(/не отвечает/);
  });
});
