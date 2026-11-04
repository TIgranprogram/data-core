/** «Смотреть как роль» — только экран. JWT и dca_user не меняются.
 *  Ключ sessionStorage `dca_viewAs` = код роли или пусто. Снимок полей — рядом, чтобы меню
 *  собралось до повторного GET /roles. Зоны склада этим режимом не проверяются. */

const KEY = 'dca_viewAs';
const SNAP = 'dca_viewAsSnap';
export const VIEW_AS_BLOCK = 'Сейчас только просмотр роли — менять данные нельзя';

/** Разделы меню, которые сервер отдаёт в /auth/me (common/app-sections.ts). Чужие id отбрасываются. */
const APP_IDS = new Set(['home', 'requests', 'suppliercatalog', 'stock', 'salesorders', 'partners', 'products', 'docs', 'passports', 'orders', 'money', 'payroll', 'design', 'work', 'offers', 'stock-mobile']);
const BASE = new Set(['user', 'manager', 'accountant', 'director', 'admin']);
const MONEY = new Set(['admin', 'director', 'accountant', 'manager']);
const BUILTIN = { director: 'Директор', accountant: 'Бухгалтер', manager: 'Менеджер', user: 'Наблюдатель' };
const RANK = { director: 0, accountant: 1, manager: 2, user: 3 };

const catalog = new Map();

const ss = {
  get(k) { try { return sessionStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch { /* приватный режим */ } },
};

/** Код выбранной роли или '' . */
export function getViewAs() { return ss.get(KEY); }

/** Админ или владелец по записи пользователя до наложения просмотра. */
export function canViewAsUser(user) {
  if (!user) return false;
  const role = user.baseRole || user.role;
  return role === 'admin' || user.isOwner === true;
}

function builtinDoc(code) {
  if (!BUILTIN[code]) return null;
  return { name: code, label: BUILTIN[code], baseRole: code };
}

function labelOf(doc) {
  const role = String(doc?.name || doc?.code || '');
  const label = doc?.label || doc?.roleLabel || '';
  if (label && /[а-яё]/i.test(label)) return label;
  return BUILTIN[role] || label || role;
}

/** Поля как у /auth/me после resolveForAuth: baseRole, подпись, разделы, галочка «Деньги». */
export function fieldsOf(doc) {
  const role = String(doc?.name || doc?.code || '');
  if (!role) return null;
  const rawBase = doc.baseRole || (BASE.has(role) ? role : '');
  const baseRole = BASE.has(rawBase) ? rawBase : role;
  let sections = null;
  if (role !== 'admin') {
    const raw = Array.isArray(doc.appSections) ? doc.appSections.filter((s) => APP_IDS.has(s)) : [];
    sections = raw.length ? raw : null;
  }
  // Как canSeeMoney: встроенные admin и director всегда видят суммы; у своей роли — поле money, иначе по baseRole.
  let canMoney;
  if (role === 'admin' || role === 'director') canMoney = true;
  else if (typeof doc.money === 'boolean') canMoney = doc.money;
  else canMoney = MONEY.has(baseRole);
  return { role, baseRole, roleLabel: labelOf(doc), sections, canMoney };
}

function readSnap(code) {
  try {
    const o = JSON.parse(ss.get(SNAP) || 'null');
    if (!o || o.role !== code || !o.baseRole) return null;
    return o;
  } catch { return null; }
}

function same(a, b) {
  if (!a || !b) return false;
  return a.role === b.role && a.baseRole === b.baseRole && a.roleLabel === b.roleLabel && a.canMoney === b.canMoney && JSON.stringify(a.sections ?? null) === JSON.stringify(b.sections ?? null);
}

function overlayFields() {
  const code = getViewAs();
  if (!code) return null;
  return readSnap(code) || fieldsOf(catalog.get(code) || builtinDoc(code));
}

/** Настоящий пользователь с подменой прав роли. Не админ — без наложения. */
export function applyView(user) {
  if (!user || !canViewAsUser(user)) return user;
  const snap = overlayFields();
  if (!snap?.role) return user;
  return {
    ...user,
    role: snap.role,
    baseRole: snap.baseRole,
    roleLabel: snap.roleLabel,
    sections: snap.sections ?? null,
    canMoney: !!snap.canMoney,
    isOwner: false,
  };
}

/** Режим включён: есть код, пользователь реально админ, поля роли известны. */
export function viewAsActive(user) {
  return !!(user && canViewAsUser(user) && overlayFields());
}

function dispatch() {
  if (typeof document === 'undefined') return;
  document.dispatchEvent(new CustomEvent('dc:view-as', { detail: { code: getViewAs() } }));
}

/** Сброс ключей без события (выход). */
export function clearViewAsStore() { ss.set(KEY, ''); ss.set(SNAP, ''); }

/** Включить код роли или сбросить (null / ''). false — такой роли нет. */
export function setViewAs(code) {
  const next = String(code || '');
  const prev = getViewAs();
  if (!next) {
    clearViewAsStore();
  } else {
    const doc = catalog.get(next) || builtinDoc(next);
    const fields = doc ? fieldsOf(doc) : readSnap(next);
    if (!fields?.role) return false;
    ss.set(KEY, fields.role);
    ss.set(SNAP, JSON.stringify(fields));
  }
  if (getViewAs() !== prev) dispatch();
  return true;
}

function listOf(res) {
  if (Array.isArray(res)) return res;
  if (Array.isArray(res?.items)) return res.items;
  return [];
}

/** Запомнить ответ GET /roles (в памяти вкладки). */
export function rememberRoles(res) {
  catalog.clear();
  for (const r of listOf(res)) {
    const name = String(r?.name || r?.code || '');
    if (!name || name === 'admin' || r?.isActive === false) continue;
    catalog.set(name, r);
  }
}

/** «Как обычно» рисует профиль сам. Здесь — роли без встроенного администратора. */
export function rolesForSelect() {
  const by = new Map(catalog);
  for (const [name, label] of Object.entries(BUILTIN)) {
    if (!by.has(name)) by.set(name, { name, label, baseRole: name });
  }
  return [...by.values()].sort((a, b) => {
    const ra = RANK[a.name] ?? 10;
    const rb = RANK[b.name] ?? 10;
    if (ra !== rb) return ra - rb;
    return labelOf(a).localeCompare(labelOf(b), 'ru');
  }).map((r) => ({ name: r.name || r.code, label: labelOf(r) }));
}

/** Подтянуть роли с сервера и обновить снимок. true — поля изменились, событие уже послано. */
export async function syncViewAsRoles(api) {
  const code = getViewAs();
  if (!code) return false;
  rememberRoles(await api('/roles'));
  const doc = catalog.get(code) || builtinDoc(code);
  if (!doc) return setViewAs(null);
  const fields = fieldsOf(doc);
  const prev = readSnap(code);
  ss.set(KEY, fields.role);
  ss.set(SNAP, JSON.stringify(fields));
  if (!same(prev, fields)) { dispatch(); return true; }
  return false;
}
