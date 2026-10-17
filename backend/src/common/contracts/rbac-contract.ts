/**
 * TZ-254 — RBAC contract (canonical reference).
 *
 * This file is the **single source of truth** for:
 *   - Permission key format (`<section>:<action>`)
 *   - Section / Action enumeration derived from the seeded catalog
 *   - Effective-permission algorithm (User.permissions ∪ Role.permissions ∪ wildcard)
 *   - System / Custom role invariants
 *   - Object-ownership matrix (consumed by TZ-251 object-level authorization)
 *
 * The catalog itself lives in `backend/src/common/seed/permissions.constants.ts`
 * so that the existing `PermissionsService` seeder keeps its single boot-time
 * upsert path — no contract-vs-seed drift is possible because this file
 * RE-EXPORTS from the constants module rather than redefining the array.
 *
 * **MUST NOT** introduce ABAC, multi-tenancy, SSO, LDAP, or a policy engine
 * here — all of those are out of scope for this TZ.
 */
import {
  PERMISSIONS,
  type PermissionKey,
} from '../seed/permissions.constants';

// ---------------------------------------------------------------------------
// 1. Section + Action enumeration (derived from the canonical catalog)
// ---------------------------------------------------------------------------

/**
 * All sections that appear in the canonical catalog. Derived from the
 * catalog itself so adding a new section to `permissions.constants.ts`
 * automatically widens this union — there is no second copy of the
 * section list to fall out of sync.
 */
export type Section = (typeof PERMISSIONS)[number]['section'];

/**
 * Three-action contract. Derived from the catalog (`read` | `write` |
 * `admin`); adding a fourth action to the canonical array widens this
 * union automatically.
 *
 *   - `read`: SELECT / list / detail fetch (no mutation, idempotent)
 *   - `write`: INSERT / UPDATE / soft-activate (mutation, scoped to row)
 *   - `admin`: DELETE / role assignment / status overrides / DB-level sweeps
 */
export type Action = (typeof PERMISSIONS)[number]['action'];

/**
 * Re-export the existing catalog and its key type verbatim. The original
 * `permissions.constants.ts` is in `common/seed/` because the seeder reads
 * it during OnModuleInit; this file treats it as canonical and adds the
 * algorithm + invariants on top.
 */
export { PERMISSIONS };
export type { PermissionKey };

// ---------------------------------------------------------------------------
// 2. System roles + workflow invariants
// ---------------------------------------------------------------------------

/**
 * Canonical names of system roles. These are seeded on first boot and
 * CANNOT be deleted or rename-renamed at runtime (TZ-257 enforces this
 * via `last-admin-guard`). Frozen at module load so runtime tools
 * surface a `TypeError` if anyone tries to mutate the array.
 */
export const SYSTEM_ROLE_NAMES: readonly SystemRoleName[] = Object.freeze([
  'admin',
  'manager',
  'user',
] as const);
export type SystemRoleName = 'admin' | 'manager' | 'user';

/**
 * Wildcard character that grants every permission in the catalog.
 * Present on either `User.permissions` OR `Role.permissions` (effectively
 * the same — both feed `effectivePermissions`).
 */
export const PERMISSION_WILDCARD = '*' as const;

/**
 * Structural-input types for `effectivePermissions`. We intentionally do
 * NOT import from `modules/user/user.schema` or `modules/role/role.schema`
 * — common-contract files must not reach into feature modules to avoid
 * circular-DI risk on further expansion of either side. The schema
 * classes satisfy this contract implicitly via structural compatibility.
 */
export interface PermissionSources {
  /** User-level permission overrides/additions. May include `*`. */
  permissions?: string[] | null | undefined;
}

export interface RolePermissionsSource extends PermissionSources {
  /** Canonical role name; checked for the `'admin'` wildcard shortcut. */
  name: string;
}

// ---------------------------------------------------------------------------
// 3. Effective-permission algorithm
// ---------------------------------------------------------------------------

/**
 * TZ-254 §ШАГ 2 effective-permissions union:
 *   - start empty
 *   - copy `user.permissions`
 *   - copy `role.permissions`
 *   - if `user.permissions` OR `role.permissions` contains `'*'`, OR
 *     `role.name === 'admin'`, promote every catalog key
 *
 * Returns a `Set<PermissionKey>` so callers can use `.has(...)` in O(1).
 *
 * The catalog validates that PermissionKey is one of the seeded strings,
 * so unsafe / unknown strings stored on a User or Role are silently
 * promoted into the result — they pass type-narrowing checks downstream
 * and are surfaced via the audit log. We do NOT throw on unknown keys;
 * canonical key validation is a separate concern owned by `@Permissions()`
 * guard (TZ-255) and the seeder.
 */
export function effectivePermissions(
  user: PermissionSources,
  role: RolePermissionsSource | null | undefined,
): Set<string> {
  const result = new Set<string>();
  for (const p of user.permissions ?? []) result.add(p);
  if (role) {
    for (const p of role.permissions ?? []) result.add(p);
  }
  const userHasWildcard =
    (user.permissions ?? []).includes(PERMISSION_WILDCARD) === true;
  const roleHasWildcard =
    role != null && role.permissions?.includes(PERMISSION_WILDCARD) === true;
  const roleIsAdmin = role != null && role.name === 'admin';
  if (userHasWildcard || roleHasWildcard || roleIsAdmin) {
    for (const p of PERMISSIONS) result.add(p.key);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 1b. Authenticated-user shape (consumed by ×OwnershipGuard, future PermissionsGuard)
// ---------------------------------------------------------------------------

/**
 * Canonical shape of `req.user` after the JWT strategy runs.
 *
 * Guards (`OwnershipGuard`, future `PermissionsGuard`) and route handlers
 * (DocumentTemplateController create/duplicate) all read `req.user` for
 * authorization. This structural-input interface is the cross-module
 * contract — never reach into the JWT strategy's resolved object
 * directly. Adding a field here ripples to every consumer immediately.
 *
 * `permissions` may be `null` (no user-level overrides) or absent (the
 * upstream JWT strategy may not pass it through). Callers should
 * defensively default to `[]` (see TZ-251 ownership guard Step 5).
 *
 * NOTE: This is a *type-only* contract. It is intentionally narrower
 * than the full Mongoose `User` document (no `passwordHash`, no internal
 * flags) to avoid guarding against invalid fields at runtime — guards
 * that read more than they should are an information-leak vector.
 */
export interface AuthenticatedUserLike {
  id: string;
  role: string;
  permissions?: string[] | null;
  rolePermissions?: string[] | null;
  /** TZ-AUTH-306: single hidden owner marker (server-hydrated, not JWT claim). */
  isOwner?: boolean;
}

// ---------------------------------------------------------------------------
// 4. Last-admin invariant (TZ-257 will enforce at runtime)
// ---------------------------------------------------------------------------

/**
 * Helper for the TZ-257 last-admin invariant. Pure function — given the
 * current count of `name === 'admin'` users and the proposed mutation,
 * returns `true` when the mutation would leave the system with zero admins.
 *
 * `proposedActive` is the post-mutation `isActive` for the target user.
 * `currentActive` is the pre-mutation value. We count admins by
 *   (currently-active admin count) − (target was active admin) + proposed
 *
 * Returns a SAFETY-MARGIN-aware boolean; the offending call site must
 * raise a `ConflictException` with the returned `reason`.
 */
export interface LastAdminCheck {
  safe: boolean;
  reason: string | null;
}

export function lastAdminInvariant(
  args: {
    currentActiveAdminCount: number;
    targetUserIsAdminInRole: boolean;
    currentTargetActive: boolean;
    proposedTargetActive: boolean;
    isDeletingAdmin: boolean;
  },
): LastAdminCheck {
  const {
    currentActiveAdminCount,
    targetUserIsAdminInRole,
    currentTargetActive,
    proposedTargetActive,
    isDeletingAdmin,
  } = args;

  // Non-admin case: always safe to mutate.
  if (!targetUserIsAdminInRole) {
    return { safe: true, reason: null };
  }

  // Deleting the user entirely.
  //
  // The pre-mutation `currentActiveAdminCount` is the count of active
  // admins IN THE SYSTEM. If the target is currently ACTIVE, that count
  // INCLUDES the target; deleting the target then subtracts 1.
  //
  // Refuse only when the target is currently an active admin AND
  // removing it would leave zero active admins.
  if (isDeletingAdmin) {
    if (currentTargetActive && currentActiveAdminCount <= 1) {
      return {
        safe: false,
        reason: 'cannot-delete-last-active-admin',
      };
    }
    return { safe: true, reason: null };
  }

  // Deactivation path: target was active and is about to be inactive.
  // Refuse when the target is the only active admin.
  if (currentTargetActive && !proposedTargetActive) {
    if (currentActiveAdminCount <= 1) {
      return {
        safe: false,
        reason: 'cannot-deactivate-last-active-admin',
      };
    }
    return { safe: true, reason: null };
  }

  // Demotion path: target stays active; permission-count is not
  // affected. Always safe (the demoted target retains other perms).
  void proposedTargetActive;
  return { safe: true, reason: null };
}

// ---------------------------------------------------------------------------
// 5. Object-ownership matrix (consumed by TZ-251 IDOR guard)
// ---------------------------------------------------------------------------

/**
 * For each entity, the field used to determine user-owned vs shared
 * data. `null` means the entity is shared corporate data (everyone with
 * the section's `read` permission can fetch by id; ownership checks do
 * not apply). A string means the entity is user-owned — only the user
 * whose `createdBy` matches the requester (or an admin) may fetch.
 *
 * TZ-251 expands this matrix to the full entity list and wires it into
 * a generic `OwnershipGuard`. This TZ ships the canonical location +
 * the matrix for the entities most commonly observed in current
 * controllers, so IDOR testing can begin immediately.
 */
export type OwnershipColumn = 'createdBy' | null;

export const OWNERSHIP_BY_ENTITY: Record<string, OwnershipColumn> = {
  // User-owned (TZ-251 IDOR scope).
  documentTemplate: 'createdBy',
  generatedDocument: 'createdBy',
  photo: 'createdBy',

  // Shared corporate data — `read`/`write`/`admin` permissions are
  // sufficient; ownership is non-applicable.
  counterparty: null,
  product: null,
  material: null,
  category: null,
  warehouse: null,
  order: null,
  contract: null,
  organization: null,
};

/**
 * Predicate helper. Returns true when the entity is user-owned and the
 * requester must therefore be the `createdBy` (or hold an admin class
 * permission). Returns false when the entity is shared and a permission
 * check alone is sufficient.
 */
export function isUserOwnedEntity(entityKey: string): boolean {
  return OWNERSHIP_BY_ENTITY[entityKey] === 'createdBy';
}

/**
 * Returns the ownership column for an entity, or `null` when the entity
 * is unknown OR known to be shared. Callers should fall back to a
 * permission-only authorization path in the latter case.
 */
export function ownershipColumnFor(entityKey: string): OwnershipColumn {
  return OWNERSHIP_BY_ENTITY[entityKey] ?? null;
}
