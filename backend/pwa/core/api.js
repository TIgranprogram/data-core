/** Связь с сервером: JWT + обновление сессии, понятные русские ошибки (CANON §2 «Тексты»). */
export const PREFIX = location.pathname.replace(/\/app(\/.*)?$/, ''); // '' локально или '/db' за nginx
const API = PREFIX + '/api';

// «Запомнить меня»: вход в localStorage (90 дней скользящий); без галочки — в sessionStorage (до закрытия браузера)
const sessionOnly = () => { try { return !!sessionStorage.getItem('dca_refresh') && !localStorage.getItem('dca_refresh'); } catch { return false; } };
const store = {
  get(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) {
    try {
      const st = sessionOnly() ? sessionStorage : localStorage;
      if (v) st.setItem(k, v); else { sessionStorage.removeItem(k); localStorage.removeItem(k); }
    } catch { /* приватный режим */ }
  },
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
  get canMoney() { return ['admin', 'director', 'accountant', 'manager'].includes(this.role) || this.user?.isOwner === true; },
  get canPayroll() { return ['admin', 'director', 'accountant'].includes(this.role) || this.user?.isOwner === true; },
  get name() { const u = this.user; return u?.displayName || u?.username || ''; },
  /** SK-8b: виден ли раздел меню по галочкам роли (user.sections; нет списка — всё как раньше; «Сегодня» и админ — всегда).
   *  Сессия хранится в localStorage — без связи работает по последнему входу / /auth/me. */
  sees(id) {
    if (id === 'staff') return this.role === 'admin' || this.role === 'director' || this.user?.isOwner === true; // «Управление → Сотрудники»: только руководство
    const u = this.user, s = u?.sections;
    // «Документация» (docs) видна и ролям со старой галочкой «паспорта» — миграция ролей не нужна
    return id === 'home' || !Array.isArray(s) || this.role === 'admin' || s.includes(id) || (id === 'docs' && s.includes('passports'));
  },
  /** Раздел «Документация» (паспорта, шаблоны, архив) открыт этой роли. */
  seesDocs() { return this.sees('docs'); },
};

/** Может ли менять записи раздела: свои права раздела (section.canEdit, напр. паспорта — директор/админ) или общее правило. */
export const canEditSection = (section) => (section?.canEdit ? !!section.canEdit() : session.canEdit);

export class ApiError extends Error {
  constructor(message, status = 0) { super(message); this.status = status; }
}
export class AuthError extends ApiError {}

/** Слушатели: потеря сессии (показать вход), связь (полоса «нет связи»), сбой запроса (ОШ2: core/errors.js → /client-errors). */
export const events = { onAuthLost: () => {}, onNet: (_ok) => {}, onFail: (_err, _ctx) => {} };
/** Сбой (сеть, 5xx, ответ не разобрался) — сообщить сборщику; ответы 4xx — не сбой. Ошибку бросить дальше как есть. */
function failed(e, url, method) {
  if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) { try { events.onFail(e, { url, method }); } catch { /* сборщик не мешает */ } }
  throw e;
}
/** Хуки после успешной записи (не GET): кэши данных сбрасываются сами (core/stock-list.js). */
export const writeHooks = [];

const HUMAN = {
  0: 'Нет связи с сервером. Проверьте интернет и повторите.',
  403: 'Недостаточно прав для этого действия.',
  404: 'Запись не найдена — возможно, её уже удалили.',
  413: 'Файл слишком большой.',
  429: 'Слишком много запросов подряд. Подождите минуту.',
  500: 'Сбой на сервере — мы уже знаем, попробуйте ещё раз. Введённое не потеряно.',
  // ЧН (2026-10-23): сервер недоступен или перезапускается (обновление) — ответ не от приложения, а от шлюза
  502: 'Сервер перезапускается или недоступен — подождите минуту и повторите. Введённое не потеряно.',
  503: 'Сервер перезапускается или недоступен — подождите минуту и повторите. Введённое не потеряно.',
  504: 'Сервер не ответил вовремя — подождите минуту и повторите. Введённое не потеряно.',
};

/** Токен подтверждения паролем (ui/confirm-password.js): уходит заголовком X-Confirm-Token в удаление/восстановление, пока действует withConfirm. */
let confirmToken = null;
export function setConfirmToken(t) { confirmToken = t || null; }

async function raw(path, opts = {}, token) {
  const headers = { ...(opts.headers || {}) };
  if (token) headers.Authorization = 'Bearer ' + token;
  if (confirmToken && (opts.method === 'DELETE' || /\/restore$/.test(path))) headers['X-Confirm-Token'] = confirmToken;
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
    const e = new ApiError(HUMAN[0], 0);
    if (ctrl.signal.aborted) e.timeout = true; // долгий ответ — повтор не поможет (А5)
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

let refreshing = null;
async function refreshAccess() {
  if (!session.refresh) throw new AuthError('Войдите снова', 401);
  refreshing ??= (async () => {
    const res = await raw('/auth/refresh', { method: 'POST' }, session.refresh);
    // выход — только если сервер отверг токен (401/403); сбой сети, 5xx, перезапуск — не повод выкидывать из системы
    if (res.status === 401 || res.status === 403) throw new AuthError('Сессия завершена — войдите снова', 401);
    if (!res.ok) throw await errorOf(res);
    const j = await res.json();
    session.access = j.access;
    if (j.refresh) session.refresh = j.refresh; // скользящий срок: новый refresh на полный срок
  })().finally(() => { refreshing = null; });
  return refreshing;
}

async function errorOf(res) {
  let msg = '';
  let fields = null;
  let errorId = '';
  let data = null;
  try { const j = await res.json(); data = j; msg = Array.isArray(j.message) ? j.message.join('; ') : j.message || ''; fields = j.missing || j.fields || null; errorId = j.errorId || ''; } catch { /* не JSON */ }
  // Сервер отдаёт русские сообщения для 400/409; для прочих — общий понятный текст
  const russian = /[а-яё]/i.test(msg);
  // ЧН: сбой сервера — с кодом, по которому его найдут в журнале; ввод остаётся в форме
  // ОШ2.4: сервер записал сбой в журнал под этим кодом — человеку «мы знаем», а не «сообщите»
  const crash = errorId ? `Сбой на сервере (код ${errorId}) — мы уже знаем, попробуйте ещё раз. Введённое не потеряно.` : '';
  // SK-8d: раздел снят с роли — сервер отвечает 403 «Раздел «…» для вашей роли закрыт»: показать его текст, не общий
  const closed = res.status === 403 && russian && /раздел/i.test(msg) && /закрыт/i.test(msg);
  const err = ([400, 409, 422].includes(res.status) && russian) || closed ? new ApiError(msg, res.status) : new ApiError(crash || HUMAN[res.status] || (russian ? msg : HUMAN[500]), res.status);
  if (closed) err.sectionClosed = true;
  if (res.status === 400 && Array.isArray(data?.unmatched)) err.data = { unmatched: data.unmatched }; // КМ: договоры с несопоставленными позициями
  if (Array.isArray(fields)) err.fields = fields.map((f) => (typeof f === 'string' ? { key: f } : f)); // ОШ: подсветить поля в форме
  return err;
}

/** Скачать файл (PDF, ZIP) с сервера и сохранить: имя — из Content-Disposition (filename*). */
export async function apiFile(path, opts = {}) {
  return fileGet(path, opts).catch((e) => failed(e, path, 'GET'));
}
async function fileGet(path, { query, fallback = 'file', timeout = 180000 } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  let res = await raw(path + qs, { timeout }, session.access);
  if (res.status === 401 && session.refresh) {
    try { await refreshAccess(); } catch (e) { if (e instanceof AuthError) events.onAuthLost(); throw e; }
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

/** Проверка пароля текущего пользователя → токен подтверждения. Неверный пароль (401/403) не выбрасывает из системы. */
export async function confirmPassword(password) {
  const res = await raw('/auth/confirm', { method: 'POST', body: { password } }, session.access);
  if (res.status === 401 || res.status === 403 || res.status === 400) throw new Error('Пароль неверный');
  if (!res.ok) throw await errorOf(res);
  return (parse(await res.text()) || {}).token;
}

/** Запрос к API. path — без /api. body — объект (JSON) или FormData. */
export async function api(path, opts = {}) {
  return trackLoad(call(path, opts).catch((e) => failed(e, path, opts.method || 'GET')));
}

/** Полоска загрузки сверху: видна, если что-то идёт дольше 150 мс (api-запросы, ленивая загрузка раздела). */
let active = 0;
let barTimer = 0;
let barEl = null;
function barSet(on) {
  if (typeof document === 'undefined') return;
  if (on) {
    if (barTimer || (barEl && barEl.isConnected)) return;
    barTimer = setTimeout(() => {
      barTimer = 0;
      if (!active) return;
      barEl = barEl || Object.assign(document.createElement('div'), { className: 'load-bar', role: 'progressbar' });
      barEl.setAttribute('aria-label', 'Загрузка');
      document.body.append(barEl);
    }, 150);
  } else {
    clearTimeout(barTimer); barTimer = 0;
    if (barEl) barEl.remove();
  }
}
export function trackLoad(p) {
  active++; barSet(true);
  const end = () => { if (--active <= 0) { active = 0; barSet(false); } };
  Promise.resolve(p).then(end, end);
  return p;
}
async function call(path, { method = 'GET', body, query } = {}) {
  const qs = query ? '?' + new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString() : '';
  // одинаковые GET, пока первый ещё в пути (меню и «Сегодня» просят одни и те же счётчики), — один запрос к серверу;
  // разбор — у каждого свой, чтобы правка ответа одним местом не задела другое
  if (method !== 'GET') { const out = parse(await send(path + qs, method, body)); for (const f of writeHooks) f(path, method); announceChange(path, method, out); return out; }
  const key = path + qs;
  let p = inflight.get(key);
  if (!p) { p = sendRetry(key).finally(() => inflight.delete(key)); inflight.set(key, p); }
  return parse(await p);
}
const inflight = new Map();
/** Единое «данные изменились»: после успешной записи (не GET) — dc:changed {path, method}. Слушают main.js (список, счётчики, «Сегодня», кэши) и ui/list.js. */
function announceChange(path, method, result) {
  if (typeof document === 'undefined' || /^\/(auth|meta|client|prefs)(\/|$|\?)|\/me(\/|$|\?)|ui-?prefs/i.test(path)) return;
  document.dispatchEvent(new CustomEvent('dc:changed', { detail: { path, method, result } }));
}
/** А5: GET повторяем до 2 раз (через 0,7 и 2 с) при сбое связи, 502/503/504 — туннель моргнул; запись (POST/PATCH) не повторяем. */
export const RETRY_WAIT = [700, 2000];
export const retryable = (e) => (e?.status === 0 && !e.timeout) || e?.status === 502 || e?.status === 503 || e?.status === 504;
async function sendRetry(url) {
  for (let i = 0; ; i++) {
    try { return await send(url, 'GET'); } catch (e) {
      if (i >= RETRY_WAIT.length || !retryable(e)) throw e;
      await new Promise((r) => setTimeout(r, RETRY_WAIT[i]));
    }
  }
}
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
    try { await refreshAccess(); } catch (e) { if (e instanceof AuthError) events.onAuthLost(); throw e; }
    res = await raw(url, { method, body }, session.access);
  }
  if (res.status === 401) { events.onAuthLost(); throw new AuthError('Сессия завершена — войдите снова', 401); }
  if (!res.ok) throw await errorOf(res);
  // пустой ответ (204 или 200 без тела — например, удаление паспорта) — null, а не ошибка разбора JSON
  if (res.status === 204) return null;
  return res.text();
}

/** Тихая запись без продления входа, хуков и сборщика (ОШ2: отправка ошибки не должна сама порождать ошибки). → HTTP-код. */
export async function apiQuiet(path, body) {
  const res = await raw(path, { method: 'POST', body, timeout: 10000 }, session.access);
  return res.status;
}

export async function login(username, password, remember = true) {
  const res = await raw('/auth/login', { method: 'POST', body: { username, password, remember } });
  if (!res.ok) {
    if (res.status === 401) throw new ApiError('Неверный логин или пароль', 401);
    if (res.status === 429) throw new ApiError('Слишком много попыток входа. Подождите минуту.', 429);
    throw await errorOf(res);
  }
  const j = await res.json();
  session.clear();
  try { sessionStorage.removeItem('dca_refresh'); if (!remember) sessionStorage.setItem('dca_refresh', j.refresh); } catch { /* приватный режим */ }
  session.access = j.access; session.refresh = j.refresh; session.user = j.user;
  try { localStorage.setItem('dca_last_user', username); } catch { /* приватный режим */ }
  return j.user;
}
