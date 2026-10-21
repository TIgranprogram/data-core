/**
 * TZ-257 — DTO mappers (extracted from controller files).
 *
 * `toClientUser` and `toClientRole` are pure functions that map raw
 * Mongoose documents into the public client shape. Stripping
 * `passwordHash` and other sensitive fields is the canonical acceptance
 * criterion for TZ-257 §ШАГ 0.
 *
 * Both mappers are intentionally placed under `dto/mapper.ts` rather
 * than co-located with controllers — future TZ-257.A mutators (create /
 * patch / delete / activate / change-password) will reuse the same
 * sanitizer without re-declaring the function. Controllers stay thin.
 */

/**
 * Public shape returned to the client for user entities. NEVER include
 * `passwordHash`, `refreshTokenHash`, or any future credential fields.
 */
export interface ClientUser {
  id: string;
  username: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  permissions: string[];
  createdAt?: string;
  updatedAt?: string;
}

/**
 * Map a raw user Mongoose document (or its lean POJO shape) to a
 * `ClientUser`. Pure function — no I/O, trivially unit-testable.
 *
 * Defensive defaults: missing role → `'user'`, missing isActive →
 * `true`, missing permissions → `[]`. Restrictive defaults would block
 * documents with partial legacy data; tolerant defaults preserve
 * read-after-mutation operator UX.
 */
export function toClientUser(doc: Record<string, unknown>): ClientUser {
  return {
    id: String(doc._id ?? ''),
    username: String(doc.username ?? ''),
    email: String(doc.email ?? ''),
    displayName: String(doc.displayName ?? ''),
    role: String(doc.role ?? 'user'),
    isActive: Boolean(doc.isActive ?? true),
    permissions: Array.isArray(doc.permissions)
      ? (doc.permissions as unknown[]).map(String)
      : [],
    createdAt: doc.createdAt ? new Date(doc.createdAt as string).toISOString() : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt as string).toISOString() : undefined,
  };
}

/**
 * Public shape returned to the client for role entities. `isSystem`
 * flag lets the UI render system roles read-only per TZ-257 §ШАГ 0.
 * `label` (display name) added in TZ-256.B so the admin UI can render
 * a human-readable role name alongside the system `name` slug.
 */
export interface ClientRole {
  id: string;
  name: string;
  label: string;
  description?: string;
  permissions: string[];
  /** TZ-ADMIN-301 / ACCESS-301: nav pageKey ACL. */
  pages: string[];
  isSystem: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export function toClientRole(doc: Record<string, unknown>): ClientRole {
  return {
    id: String(doc._id ?? ''),
    name: String(doc.name ?? ''),
    label: String(doc.label ?? doc.name ?? ''),
    description: doc.description ? String(doc.description) : undefined,
    permissions: Array.isArray(doc.permissions)
      ? (doc.permissions as unknown[]).map(String)
      : [],
    pages: Array.isArray(doc.pages) ? (doc.pages as unknown[]).map(String) : [],
    isSystem: Boolean(doc.isSystem ?? false),
    createdAt: doc.createdAt ? new Date(doc.createdAt as string).toISOString() : undefined,
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt as string).toISOString() : undefined,
  };
}
