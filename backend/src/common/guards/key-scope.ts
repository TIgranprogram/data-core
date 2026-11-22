/**
 * P2: права машинного ключа `kppd_…` (scope).
 *
 * Контракт `req.user.keyScope` (читает модуль app-data):
 *   keyScope?: KeyScope
 * Ключ без scope в БД (старые ключи) = `{ access: 'full' }` — права выдавшего.
 * JWT-сессии keyScope не получают и здесь не ограничиваются.
 */
export type KeyScopeAccess = 'read' | 'write' | 'full' | 'app';

export type KeyScope =
  | { access: Exclude<KeyScopeAccess, 'app'>; apps?: string[] }
  | { access: 'app'; apps: [string] };

export const KEY_SCOPE_ACCESS: readonly KeyScopeAccess[] = ['read', 'write', 'full', 'app'];
/** Без «_»: иначе имя коллекции app_<app>_<collection> было бы неоднозначным. */
export const KEY_SCOPE_APP_RE = /^[a-z][a-z0-9]{0,39}$/;
export const KEY_SCOPE_MAX_APPS = 50;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const APP_KEY_METHODS = new Set(['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE']);

export function isAppDataSlug(value: unknown): value is string {
  // Служебные коллекции сервера app_control_*.
  return typeof value === 'string' && KEY_SCOPE_APP_RE.test(value) && value !== 'control';
}

/** Только отсутствие поля означает старый ключ. Повреждённая запись → null. */
export function normalizeKeyScope(raw: unknown): KeyScope | null {
  if (raw === undefined) return { access: 'full' };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!Object.prototype.hasOwnProperty.call(raw, 'access')) return null;
  if (Object.keys(raw).some((key) => key !== 'access' && key !== 'apps')) return null;

  const { access, apps } = raw as { access: KeyScopeAccess; apps?: unknown };
  if (!KEY_SCOPE_ACCESS.includes(access)) return null;
  if (access === 'app') {
    if (!Array.isArray(apps) || apps.length !== 1 || !isAppDataSlug(apps[0])) return null;
    return { access, apps: [apps[0]] };
  }

  if (apps === undefined) return { access };
  if (!Array.isArray(apps) || apps.length > KEY_SCOPE_MAX_APPS) return null;
  if (!apps.every((app) => typeof app === 'string' && KEY_SCOPE_APP_RE.test(app))) return null;
  return apps.length ? { access, apps: [...new Set(apps)] } : { access };
}

/** Путь без query, декодированный, в нижнем регистре, без повторных/хвостовых `/`. */
function normalizePath(url: string): string {
  let p = (url || '').split('?')[0].split('#')[0];
  try {
    p = decodeURIComponent(p);
  } catch {
    /* оставляем как есть */
  }
  p = p.toLowerCase().replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  if (p.length > 1) p = p.replace(/\/+$/, '');
  return p;
}

function under(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** Админ-маршрут: недоступен ключам read/write. */
export function isAdminRoute(method: string, url: string): boolean {
  const path = normalizePath(url);
  const m = method.toUpperCase();
  if (under(path, '/api/admin')) return true; // включая /api/admin/devices
  if (under(path, '/api/roles')) return true;
  // Выдача/список/отзыв ключей, включая алиас POST /api/desktop/pairing.
  if (under(path, '/api/desktop/pairing-keys') || under(path, '/api/desktop/pairing')) {
    return true;
  }
  // Пользователи: чтение можно, изменение — нет.
  if (under(path, '/api/users') && !SAFE_METHODS.has(m)) return true;
  return false;
}

/**
 * Проверка запроса по scope ключа. Возвращает текст ошибки для 403 или null.
 * `apps` здесь не проверяется — это делает модуль app-data.
 */
export function keyScopeViolation(
  scope: KeyScope | undefined,
  method: string,
  url: string,
  appKeyRoute = false,
): string | null {
  if (!scope || scope.access === 'full') return null;
  const m = (method || '').toUpperCase();
  if (scope.access === 'app') {
    return appKeyRoute && APP_KEY_METHODS.has(m) && under(normalizePath(url), '/api/apps')
      ? null
      : 'API-ключ предназначен только для данных своего приложения';
  }
  if (scope.access === 'read' && !SAFE_METHODS.has(m)) {
    return 'API-ключ только для чтения: изменение данных запрещено';
  }
  if (isAdminRoute(m, url)) {
    return 'API-ключ с ограниченными правами не даёт доступа к администрированию (пользователи, роли, ключи, устройства)';
  }
  return null;
}
