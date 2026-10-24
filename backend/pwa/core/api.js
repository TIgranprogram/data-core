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
  /** SK-8c: роль для прав — у своей роли («Кладовщик») это её «права как у» (baseRole), у встроенной — она сама. */
  get role() { const u = this.user; return u?.baseRole || u?.role; },
  /** Может ли менять данные (как на сервере: admin, manager). */
  // Иерархия ролей (backend common/roles-hierarchy.ts): директор ⊃ бухгалтер ⊃ менеджер ⊃ наблюдатель
  get canEdit() { return ['admin', 'director', 'accountant', 'manager'].includes(this.role) || this.user?.isOwner === true; },
  /** Суммы, доходы, платёжный календарь — только админ / директор / бухгалтер (сервер всё равно скрывает). */
  get canMoney() { return ['admin', 'director', 'accountant'].includes(this.role) || this.user?.isOwner === true; },
  get name() { const u = this.user; return u?.displayName || u?.username || ''; },
  /** SK-8b: виден ли раздел меню по галочкам роли (user.sections; нет списка — всё как раньше; «Сегодня» и админ — всегда).
   *  Сессия хранится в localStorage — без связи работает по последнему входу / /auth/me. */
  sees(id) {
    const u = this.user, s = u?.sections;
    return id === 'home' || !Array.isArray(s) || this.role === 'admin' || s.includes(id);
  },
};

/** Может ли менять записи раздела: свои права раздела (section.canEdit, напр. паспорта — директор/админ) или общее правило. */
export const canEditSection = (section) => (section?.canEdit ? !!section.canEdit() : session.canEdit);

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
export class AuthError extends ApiError {}

/** Слушатели: потеря сессии (показать вход), связь (полоса «нет связи»). */
export const events = { onAuthLost: () => {}, onNet: (_ok) => {} };
/** Хуки после успешной записи (не GET): кэши данных сбрасываются сами (core/stock-list.js). */
export const writeHooks = [];

const HUMAN = {
  0: 'Нет связи с сервером. Проверьте интернет и повторите.',
  403: 'Недостаточно прав для этого действия.',
  404: 'Запись не найдена — возможно, её уже удалили.',
  413: 'Файл слишком большой.',
  429: 'Слишком много запросов подряд. Подождите минуту.',
  500: 'Ошибка на сервере. Повторите позже; если не проходит — сообщите администратору.',
  // ЧН (2026-10-23): сервер недоступен или перезапускается (обновление) — ответ не от приложения, а от шлюза
  502: 'Сервер перезапускается или недоступен — подождите минуту и повторите. Введённое не потеряно.',
  503: 'Сервер перезапускается или недоступен — подождите минуту и повторите. Введённое не потеряно.',
  504: 'Сервер не ответил вовремя — подождите минуту и повторите. Введённое не потеряно.',
};

async function raw(path, opts = {}, token) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  const isForm = opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeout || (isForm ? 120000 : 20000));
  try {
    const { timeout: _t, ...rest } = opts;
    const res = await fetch(API + path, { ...rest, headers, body: isForm || opts.body === undefined ? opts.body : JSON.stringify(opts.body), signal: ctrl.signal });
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
  let fields = null;
  let errorId = '';
  try { const j = await res.json(); msg = Array.isArray(j.message) ? j.message.join('; ') : j.message || ''; fields = j.missing || j.fields || null; errorId = j.errorId || ''; } catch { /* не JSON */ }
  // Сервер отдаёт русские сообщения для 400/409; для прочих — общий понятный текст
  const russian = /[а-яё]/i.test(msg);
  // ЧН: сбой сервера — с кодом, по которому его найдут в журнале; ввод остаётся в форме
  const crash = errorId ? `Сбой на сервере (код ${errorId}). Введённое не потеряно — повторите позже; если повторяется, сообщите код администратору.` : '';
  const err = [400, 409, 422].includes(res.status) && russian ? new ApiError(msg, res.status) : new ApiError(crash || HUMAN[res.status] || (russian ? msg : HUMAN[500]), res.status);
  if (Array.isArray(fields)) err.fields = fields.map((f) => (typeof f === 'string' ? { key: f } : f)); // ОШ: подсветить поля в форме
  return err;
}

/** Скачать файл (PDF, ZIP) с сервера и сохранить: имя — из Content-Disposition (filename*). */
export async function apiFile(path, { query, fallback = 'file', timeout = 180000 } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  let res = await raw(path + qs, { timeout }, session.access);
  if (res.status === 401 && session.refresh) {
    try { await refreshAccess(); } catch (e) { events.onAuthLost(); throw e; }
    res = await raw(path + qs, { timeout }, session.access);
  }
  if (!res.ok) throw await errorOf(res);
  const cd = res.headers.get('content-disposition') || '';
  const m = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  const name = m ? decodeURIComponent(m[1]) : fallback;
  const blob = await res.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  return name;
}

/** Запрос к API. path — без /api. body — объект (JSON) или FormData. */
export async function api(path, { method = 'GET', body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  // одинаковые GET, пока первый ещё в пути (меню и «Сегодня» просят одни и те же счётчики), — один запрос к серверу;
  // разбор — у каждого свой, чтобы правка ответа одним местом не задела другое
  if (method !== 'GET') { const out = parse(await send(path + qs, method, body)); for (const f of writeHooks) f(path, method); return out; }
  const key = path + qs;
  let p = inflight.get(key);
  if (!p) { p = send(key, method).finally(() => inflight.delete(key)); inflight.set(key, p); }
  return parse(await p);
}
const inflight = new Map();
const parse = (text) => (text ? JSON.parse(text) : null);

/** JWT истекает в ближайшие 30 с (или нет токена). Не разобрался — false: решит ответ сервера. */
function expiresSoon(token) {
  if (!token) return true;
  try {
    const p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof p.exp === 'number' && p.exp * 1000 < Date.now() + 30000;
  } catch { return false; }
}

/** Запрос с продлением входа по 401; тело ответа — текстом (пустое — null). */
async function send(url, method, body) {
  // срок входа истёк или вот-вот — продлить до запроса, а не после пачки отказов 401 (при открытии их ~20)
  if (session.refresh && expiresSoon(session.access)) await refreshAccess().catch(() => {});
  let res = await raw(url, { method, body }, session.access);
  if (res.status === 401 && session.refresh) {
    try { await refreshAccess(); } catch (e) { events.onAuthLost(); throw e; }
    res = await raw(url, { method, body }, session.access);
  }
  if (res.status === 401) { events.onAuthLost(); throw new AuthError('Сессия истекла — войдите снова', 401); }
  if (!res.ok) throw await errorOf(res);
  // пустой ответ (204 или 200 без тела — например, удаление паспорта) — null, а не ошибка разбора JSON
  if (res.status === 204) return null;
  return res.text();
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
