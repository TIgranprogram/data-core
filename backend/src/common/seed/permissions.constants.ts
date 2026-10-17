/**
 * Canonical permission keys for the entire app. Used to seed the
 * `permissions` collection on first start and to validate role updates.
 *
 * Format: `<section>:<action>` where action is read|write|admin.
 * Human RU labels for admin UI: `frontend/src/app/pages/admin/permission-labels.ru.ts`
 *
 * When adding a key or page: update `docs/FEATURE-INTEGRATION-CHECKLIST.md` (sections B / A).
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
  { key: 'production:read', section: 'production', action: 'read', description: 'View production orders' },
  /** TZ-PRODUCTION-309: also gates WorkType mutate + PATCH /orders/:id/estimate-days (not Roles-only). */
  { key: 'production:write', section: 'production', action: 'write', description: 'Create/edit production orders' },
  { key: 'production:admin', section: 'production', action: 'admin', description: 'Close orders / manage workers' },
  { key: 'warehouse:read', section: 'warehouse', action: 'read', description: 'View stock' },
  { key: 'warehouse:write', section: 'warehouse', action: 'write', description: 'Move stock / reservations' },
  { key: 'procurement:read', section: 'procurement', action: 'read', description: 'View PRs/POs/invoices' },
  { key: 'procurement:write', section: 'procurement', action: 'write', description: 'Create/edit PRs/POs' },
  { key: 'sales:read', section: 'sales', action: 'read', description: 'View quotations/contracts/orders' },
  { key: 'sales:write', section: 'sales', action: 'write', description: 'Create/edit sales' },
  { key: 'sales:admin', section: 'sales', action: 'admin', description: 'Confirm orders, manage shipments' },
  { key: 'document:read', section: 'document', action: 'read', description: 'View documents' },
  { key: 'document:write', section: 'document', action: 'write', description: 'Create document templates' },
  { key: 'finance:read', section: 'finance', action: 'read', description: 'View reconciliation / reports' },
  { key: 'finance:write', section: 'finance', action: 'write', description: 'Create reconciliation acts' },
  { key: 'system:read', section: 'system', action: 'read', description: 'View system settings' },
  { key: 'system:write', section: 'system', action: 'write', description: 'Edit system settings / flags' },
  /** TZD-72: gates pairing-key issue/list/revoke + the NX shell download/pairing button. */
  { key: 'desktop:admin', section: 'desktop', action: 'admin', description: 'Download Desktop / issue pairing keys' },
] as const;

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
