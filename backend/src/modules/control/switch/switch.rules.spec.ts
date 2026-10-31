import { blockedWhenReadOnly, copyAgeMin, isSwitchPath, parseSelf, routePath, secretMatches, staleReason, type SwitchJob } from './switch.rules';

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

  it('возраст копии в минутах', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    expect(copyAgeMin('2026-10-31T11:30:00Z', now)).toBe(30);
    expect(copyAgeMin(undefined, now)).toBeNull();
    expect(copyAgeMin('мусор', now)).toBeNull();
  });
});
