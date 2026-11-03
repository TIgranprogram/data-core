/**
 * Кнопка «Переключить сейчас» (HA-TWO-SERVERS, SW-2…SW-5): чистые правила без базы и без Nest.
 * Весь механизм включается только переменной HA_SELF=home|office; без неё сервер ведёт себя как раньше.
 */
import { timingSafeEqual } from 'crypto';

export type SwitchSelf = 'home' | 'office';
export type SwitchMode = 'normal' | 'readonly';
export type SwitchRole = 'main' | 'standby';
export type JobState = 'queued' | 'running' | 'done' | 'failed';

export interface SwitchJob {
  id: string;
  /** home->office | office->home | emergency | refresh */
  direction: string;
  step: string;
  state: JobState;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface SwitchDoc {
  mode: SwitchMode;
  role: SwitchRole;
  job: SwitchJob | null;
  peerVersion?: string;
  peerCopyAt?: string;
  peerHealthy?: boolean;
  peerCheckedAt?: string;
}

/** Кэш режима живёт 2 с: запрос на запись не ходит в базу. */
export const CACHE_MS = 2000;
/** Запрос не подхвачен мостом — считаем, что моста нет. */
export const QUEUED_MAX_MS = 10 * 60_000;
/** Подсказка клиенту, через сколько повторить запись. */
export const RETRY_AFTER_SEC = 30;
export const READ_ONLY_MESSAGE = 'Идёт переключение сервера. Подождите минуту.';
export const EMERGENCY_PHRASE = 'Я ПОНИМАЮ';
export const STATE_ID = 'switch';
export const COL_STATE = 'app_control_state';

/** home | office из переменной окружения; всё остальное — механизм выключен. */
export function parseSelf(v: string | undefined): SwitchSelf | null {
  return v === 'home' || v === 'office' ? v : null;
}

export const peerOf = (s: SwitchSelf): SwitchSelf => (s === 'home' ? 'office' : 'home');
/** Дом по умолчанию главный, офис (Sportin) — запасной, пока в базе нет своего решения. */
export const defaultRole = (s: SwitchSelf): SwitchRole => (s === 'home' ? 'main' : 'standby');

/** Путь без `/api`, строки запроса и хвостового `/`. Нужен и при разном монтировании middleware. */
export function routePath(url: string): string {
  let p = url.split('?')[0].split('#')[0];
  if (p.startsWith('/api/') || p === '/api') p = p.slice(4) || '/';
  return p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXEMPT = ['/auth/login', '/auth/refresh', '/client-errors'];
const isUnder = (p: string, base: string) => p === base || p.startsWith(base + '/');

/** Путь самого механизма (его отключённый вид — 404). */
export const isSwitchPath = (path: string) => isUnder(path, '/control/switch');

/** Запрос запрещён в режиме «только чтение»: любой не-GET, кроме входа, обновления токена, ошибок клиента и /control/switch/*. */
export function blockedWhenReadOnly(method: string, path: string): boolean {
  if (SAFE.has(method.toUpperCase())) return false;
  if (isSwitchPath(path)) return false;
  return !EXEMPT.some((e) => isUnder(path, e));
}

/** Сравнение секрета моста без утечки по времени. */
export function secretMatches(given: string | undefined, expected: string): boolean {
  if (!given || !expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const isoAge = (iso: string | undefined, now: number) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? null : now - t;
};

/** Возраст копии на втором сервере, минут; null — неизвестен. */
export function copyAgeMin(copyAt: string | undefined, now: number): number | null {
  const age = isoAge(copyAt, now);
  return age === null ? null : Math.max(0, Math.round(age / 60_000));
}

/** Работа считается идущей, пока не завершена и не брошена. */
export const jobBusy = (job: SwitchJob | null | undefined): boolean => !!job && (job.state === 'queued' || job.state === 'running');

/**
 * Кнопка «Обновить» запасной: этот сервер главный, режим обычный, работы нет, мост жив.
 * Список blockers сюда не входит — он про готовность переключения, не про эту кнопку.
 */
export function canRefreshNow(role: SwitchRole, mode: SwitchMode, busy: boolean, bridgeAlive: boolean): boolean {
  return role === 'main' && mode === 'normal' && !busy && bridgeAlive;
}

/**
 * Брошена ли работа: запрос ждёт моста дольше 10 минут, либо работа идёт, а мост молчит (файл alive старше 3 минут).
 * По возрасту идущая работа НЕ бросается: мост сам ограничивает «только чтение» десятью минутами.
 * Возвращает текст причины или null.
 */
export function staleReason(job: SwitchJob | null | undefined, now: number, bridgeAlive = true): string | null {
  if (!job || !jobBusy(job)) return null;
  const age = isoAge(job.startedAt, now);
  if (age === null) return 'Нет времени начала';
  if (job.state === 'queued' && age > QUEUED_MAX_MS) return 'Мост переключения не откликнулся за 10 минут. Проверьте cron на сервере.';
  if (job.state === 'running' && !bridgeAlive) return 'Мост переключения перестал отвечать. Сервер вернулся в обычный режим.';
  return null;
}

/** Обзор без включённого переключения: GET /control/switch и /control/switch/ping отвечают и тогда. */
export const isOverviewPath = (method: string, path: string) =>
  method.toUpperCase() === 'GET' && (path === '/control/switch' || path === '/control/switch/ping');

/** Копия на втором сервере старше суток с запасом — переключать на неё рано. */
export const COPY_MAX_AGE_MIN = 26 * 60;

export interface ReadinessInput {
  self: SwitchSelf | null;
  peerUrlSet: boolean;
  peerHealthy: boolean | null;
  copyAgeMin: number | null;
  bridgeAlive: boolean;
}

/** Что мешает включить переключение — словами менеджера; пустой список — всё готово. */
export function readinessBlockers(i: ReadinessInput): string[] {
  const out: string[] = [];
  if (!i.self) out.push('Этому серверу не задано, какой он: домашний или офисный.');
  if (!i.peerUrlSet) out.push('Не задан адрес второго сервера: его состояние не проверить.');
  else if (i.peerHealthy === false) out.push('Второй сервер не отвечает.');
  if (i.copyAgeMin === null) out.push('Неизвестно, когда второй сервер получил копию данных.');
  else if (i.copyAgeMin > COPY_MAX_AGE_MIN) out.push('Копия данных на втором сервере старше суток.');
  if (!i.bridgeAlive) out.push('Служебный мост переключения на этом сервере не запущен.');
  return out;
}
