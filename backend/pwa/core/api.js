/** Связь с сервером: JWT + обновление сессии, понятные русские ошибки (CANON §2 «Тексты»). */
export const PREFIX = location.pathname.replace(/\/app(\/.*)?$/, ''); // '' локально или '/db' за nginx
const API = PREFIX + '/api';

const store = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* приватный режим */ } },
};

export const session = {
  get access() { return store.get('dca_access'); }, set access(v) { store.set('dca_access', v); },
  get refresh() { return store.get('dca_refresh'); }, set refresh(v) { store.set('dca_refresh', v); },
  get user() { try { return JSON.parse(store.get('dca_user') || 'null'); } catch { return null; } },
  set user(v) { store.set('dca_user', v ? JSON.stringify(v) : ''); },
  clear() { this.access = ''; this.refresh = ''; this.user = null; },
  /** Может ли менять данные (как на сервере: admin, manager). */
  // Иерархия ролей (backend common/roles-hierarchy.ts): директор ⊃ бухгалтер ⊃ менеджер ⊃ наблюдатель
  get canEdit() { return ['admin', 'director', 'accountant', 'manager'].includes(this.user?.role) || this.user?.isOwner === true; },
  /** Суммы, доходы, платёжный календарь — только админ / директор / бухгалтер (сервер всё равно скрывает). */
  get canMoney() { return ['admin', 'director', 'accountant'].includes(this.user?.role) || this.user?.isOwner === true; },
  get name() { const u = this.user; return u?.displayName || u?.username || ''; },
};

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
export class AuthError extends ApiError {}

/** Слушатели: потеря сессии (показать вход), связь (полоса «нет связи»). */
export const events = { onAuthLost: () => {}, onNet: (_ok) => {} };

const HUMAN = {
  0: 'Нет связи с сервером. Проверьте интернет и повторите.',
  403: 'Недостаточно прав для этого действия.',
  404: 'Запись не найдена — возможно, её уже удалили.',
  413: 'Файл слишком большой.',
  429: 'Слишком много запросов подряд. Подождите минуту.',
  500: 'Ошибка на сервере. Повторите позже; если не проходит — сообщите администратору.',
};

async function raw(path, opts = {}, token) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const isForm = opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), isForm ? 120000 : 20000);
  try {
    const res = await fetch(API + path, { ...opts, headers, body: isForm || opts.body === undefined ? opts.body : JSON.stringify(opts.body), signal: ctrl.signal });
    events.onNet(true);
    return res;
  } catch {
    events.onNet(false);
    throw new ApiError(HUMAN[0], 0);
  } finally {
    clearTimeout(timer);
  }
}

let refreshing = null;
async function refreshAccess() {
  if (!session.refresh) throw new AuthError('Войдите снова', 401);
  refreshing ??= (async () => {
    const res = await raw('/auth/refresh', { method: 'POST' }, session.refresh);
    if (!res.ok) throw new AuthError('Сессия истекла — войдите снова', 401);
    session.access = (await res.json()).access;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function errorOf(res) {
  let msg = '';
  try { const j = await res.json(); msg = Array.isArray(j.message) ? j.message.join('; ') : j.message || ''; } catch { /* не JSON */ }
  // Сервер отдаёт русские сообщения для 400/409; для прочих — общий понятный текст
  const russian = /[а-яё]/i.test(msg);
  if ([400, 409, 422].includes(res.status) && russian) return new ApiError(msg, res.status);
  return new ApiError(russian ? msg : HUMAN[res.status] || HUMAN[500], res.status);
}

/** Запрос к API. path — без /api. body — объект (JSON) или FormData. */
export async function api(path, { method = 'GET', body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  let res = await raw(path + qs, { method, body }, session.access);
  if (res.status === 401 && session.refresh) {
    try { await refreshAccess(); } catch (e) { events.onAuthLost(); throw e; }
    res = await raw(path + qs, { method, body }, session.access);
  }
  if (res.status === 401) { events.onAuthLost(); throw new AuthError('Сессия истекла — войдите снова', 401); }
  if (!res.ok) throw await errorOf(res);
  return res.status === 204 ? null : res.json();
}

export async function login(username, password) {
  const res = await raw('/auth/login', { method: 'POST', body: { username, password } });
  if (!res.ok) {
    if (res.status === 401) throw new ApiError('Неверный логин или пароль', 401);
    if (res.status === 429) throw new ApiError('Слишком много попыток входа. Подождите минуту.', 429);
    throw await errorOf(res);
  }
  const j = await res.json();
  session.access = j.access; session.refresh = j.refresh; session.user = j.user;
  return j.user;
}
