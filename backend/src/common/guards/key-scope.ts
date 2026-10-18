/**
 * P2: права машинного ключа `kppd_…` (scope).
 *
 * Контракт `req.user.keyScope` (читает модуль app-data):
 *   keyScope?: { access: 'read' | 'write' | 'full'; apps?: string[] }
 * Ключ без scope в БД (старые ключи) = `{ access: 'full' }` — права выдавшего.
 * JWT-сессии keyScope не получают и здесь не ограничиваются.
 */
export type KeyScopeAccess = 'read' | 'write' | 'full';

export interface KeyScope {
  access: KeyScopeAccess;
  apps?: string[];
}

export const KEY_SCOPE_ACCESS: readonly KeyScopeAccess[] = ['read', 'write', 'full'];
/** Имя приложения (совпадает с правилом модуля app-data). */
export const KEY_SCOPE_APP_RE = /^[a-z][a-z0-9_]{0,39}$/;
export const KEY_SCOPE_MAX_APPS = 50;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Нормализует scope из БД: отсутствует/битый → full. */
export function normalizeKeyScope(raw: unknown): KeyScope {
  const r = raw as { access?: unknown; apps?: unknown } | null | undefined;
  const access = KEY_SCOPE_ACCESS.includes(r?.access as KeyScopeAccess)
    ? (r!.access as KeyScopeAccess)
    : 'full';
  const scope: KeyScope = { access };
  if (Array.isArray(r?.apps) && r!.apps.length > 0) {
    scope.apps = r!.apps.map(String);
  }
  return scope;
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
): string | null {
  if (!scope || scope.access === 'full') return null;
  const m = (method || '').toUpperCase();
  if (scope.access === 'read' && !SAFE_METHODS.has(m)) {
    return 'API-ключ только для чтения: изменение данных запрещено';
  }
  if (isAdminRoute(m, url)) {
    return 'API-ключ с ограниченными правами не даёт доступа к администрированию (пользователи, роли, ключи, устройства)';
  }
  return null;
}
