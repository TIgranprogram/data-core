/**
 * Canonical permission keys for the entire app. Used to seed the
 * `permissions` collection on first start and to validate role updates.
 *
 * Format: `<section>:<action>` where action is read|write|admin.
 * GET /api/admin/permissions отдаёт этот каталог (sections) и PAGE_KEYS (pages).
 *
 * Новый ключ: добавить сюда + @Permissions(...) на маршрут (PermissionsBootValidator сверяет).
 */
export const PERMISSIONS = [
  { key: 'user:read', section: 'user', action: 'read', description: 'View users' },
  { key: 'user:write', section: 'user', action: 'write', description: 'Create/edit users' },
  { key: 'user:admin', section: 'user', action: 'admin', description: 'Delete users / change roles' },
  { key: 'role:read', section: 'role', action: 'read', description: 'View roles' },
  { key: 'role:write', section: 'role', action: 'write', description: 'Create/edit roles' },
  { key: 'role:admin', section: 'role', action: 'admin', description: 'Delete roles' },
  { key: 'product:read', section: 'product', action: 'read', description: 'View products' },
  { key: 'product:write', section: 'product', action: 'write', description: 'Create/edit products' },
  { key: 'product:admin', section: 'product', action: 'admin', description: 'Delete products' },
  { key: 'category:read', section: 'category', action: 'read', description: 'View categories' },
  { key: 'category:write', section: 'category', action: 'write', description: 'Manage categories' },
  { key: 'material:read', section: 'material', action: 'read', description: 'View materials' },
  { key: 'material:write', section: 'material', action: 'write', description: 'Manage materials' },
  /** Выдаётся director/manager сидом ролей (admin.seed.ts); сам по себе маршрутов не защищает. */
  { key: 'production:read', section: 'production', action: 'read', description: 'View work types (informational, gates no route)' },
  /**
   * TZ-PRODUCTION-309: защищает изменение видов работ (POST/PATCH/DELETE /work-types).
   * Имя историческое (CRM «производство»); не переименовывать без миграции ролей в БД — см. docs/TASKS.md (D4).
   */
  { key: 'production:write', section: 'production', action: 'write', description: 'Create/edit/delete work types' },
  // T15: разделы warehouse/procurement/sales/document/finance/system и production:admin удалены —
  // ни один маршрут их не требовал (домен CRM удалён). Ключи, оставшиеся у ролей в БД, безвредны.
  /** TZD-72: gates pairing-key issue/list/revoke + the NX shell download/pairing button. */
  { key: 'desktop:admin', section: 'desktop', action: 'admin', description: 'Download Desktop / issue pairing keys' },
  /** P1: универсальное хранилище /api/apps/:app/:collection. admin — физическое удаление (?hard=true). */
  { key: 'app-data:read', section: 'app-data', action: 'read', description: 'Read app data (/api/apps)' },
  { key: 'app-data:write', section: 'app-data', action: 'write', description: 'Create/edit/soft-delete app data' },
  { key: 'app-data:admin', section: 'app-data', action: 'admin', description: 'Hard-delete app data documents' },
] as const;

/**
 * Ключи навигации удалённого фронта kppdf. НЕ удалены (T15): отдаются в GET /api/admin/permissions (pages),
 * хранятся в roles.pages и в ответе auth (user.pages); дефолты ролей — admin.seed.ts. Решение — docs/TASKS.md (D5).
 */
export const PAGE_KEYS = [
  'products', 'modules', 'materials', 'work-types',
  'organizations', 'proposals', 'contracts', 'orders',
  // TZ-NAV-301 — lifecycle stubs + clients hub
  'counterparties', 'design', 'supply', 'shipping',
  'dictionaries', 'categories', 'doc-template-categories', 'text-block-categories', 'color-references',
  'doc-templates', 'doc-texts', 'doc-tables', 'doc-documents', 'doc-studio',
  'inventory', 'storage-items', 'stock-movements',
  'people',
  'production',
  'import-todos',
  'admin-users', 'admin-roles',
] as const;

export type PageKey = (typeof PAGE_KEYS)[number];
export type PermissionKey = (typeof PERMISSIONS)[number]['key'];
