import {
  SYSTEM_ROLE_NAMES,
  effectivePermissions,
  isUserOwnedEntity,
  lastAdminInvariant,
  ownershipColumnFor,
  OWNERSHIP_BY_ENTITY,
  PERMISSIONS,
  PERMISSION_WILDCARD,
} from './rbac-contract';

/**
 * TZ-254 — RBAC contract unit tests.
 *
 * These tests cover the **canonical contract**, not the implementation of
 * the @Roles() / @Permissions() guards (those land at TZ-255). The contract
 * must hold stable whether the runtime enforcement is RolesGuard,
 * PermissionsGuard, or a future custom guard.
 */
describe('RBAC contract (TZ-254)', () => {
  describe('catalog re-export', () => {
    it('exports the same PERMISSIONS catalog as the seed module', () => {
      // 30 keys seeded by PermissionsService (3+3+3+2+2+3+2+2+3+2+2+2+1 desktop);
      // we use a smoke-test bound to catch accidental truncation or remap.
      // TZD-72 added `desktop:admin` (29 -> 30).
      expect(PERMISSIONS.length).toBe(30);
    });

    it('every permission key is well-formed `<section>:<action>`', () => {
      for (const p of PERMISSIONS) {
        expect(p.key).toMatch(/^[a-z]+:(read|write|admin)$/);
      }
    });

    it('every permission key is unique (no duplicates across the catalog)', () => {
      const keys = PERMISSIONS.map((p) => p.key);
      expect(new Set(keys).size).toBe(keys.length);
    });

    it('every permission key carries an action ∈ {read, write, admin}', () => {
      const validActions = new Set(['read', 'write', 'admin']);
      for (const p of PERMISSIONS) {
        expect(validActions.has(p.action)).toBe(true);
      }
    });

    it('covers identity (user, role) + catalog (product, category, material) + production + warehouse + procurement + sales + document + finance + system sections', () => {
      // Widened Set<string> so the `sections.has(s)` lookup accepts the
      // string literal — the runtime contract is unaffected.
      const sections: Set<string> = new Set(PERMISSIONS.map((p) => p.section));
      for (const s of [
        'user',
        'role',
        'product',
        'category',
        'material',
        'production',
        'warehouse',
        'procurement',
        'sales',
        'document',
        'finance',
        'system',
      ]) {
        expect(sections.has(s)).toBe(true);
      }
    });
  });

  describe('SYSTEM_ROLE_NAMES', () => {
    it('is exactly admin / manager / user (no fourth name)', () => {
      expect(SYSTEM_ROLE_NAMES).toEqual(['admin', 'manager', 'user']);
    });

    it('is frozen at module load via Object.freeze', () => {
      // Module load Object.freeze()s the array; runtime mutation throws
      // in non-strict and silently fails in strict.
      expect(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (SYSTEM_ROLE_NAMES as unknown as any[]).push('hacker');
      }).toThrow();
    });
  });

  describe('effectivePermissions() — union + wildcard', () => {
    it('returns the union of user.permissions and role.permissions', () => {
      const user = { permissions: ['product:read'] };
      const role = { name: 'manager', permissions: ['product:write'] };
      const result = effectivePermissions(user, role);
      expect(result.has('product:read')).toBe(true);
      expect(result.has('product:write')).toBe(true);
      expect(result.has('user:admin')).toBe(false);
    });

    it('returns just user.permissions when role is null', () => {
      const result = effectivePermissions(
        { permissions: ['document:read'] },
        null,
      );
      expect(result.has('document:read')).toBe(true);
      expect(result.size).toBe(1);
    });

    it('returns just role.permissions when user.permissions is undefined', () => {
      const result = effectivePermissions(
        { permissions: undefined },
        { name: 'manager', permissions: ['document:write'] },
      );
      expect(result.has('document:write')).toBe(true);
      expect(result.size).toBe(1);
    });

    it('returns empty set when both user.permissions and role.permissions are empty/missing', () => {
      const result = effectivePermissions({}, { name: 'user', permissions: [] });
      expect(result.size).toBe(0);
    });

    it('promotes EVERY catalog key when role.name === "admin"', () => {
      const result = effectivePermissions({}, { name: 'admin' });
      // Each catalog entry must be present.
      for (const p of PERMISSIONS) {
        expect(result.has(p.key)).toBe(true);
      }
      expect(result.size).toBe(PERMISSIONS.length);
    });

    it('promotes EVERY catalog key when user.permissions contains the wildcard', () => {
      const result = effectivePermissions(
        { permissions: [PERMISSION_WILDCARD] },
        { name: 'user' },
      );
      for (const p of PERMISSIONS) {
        expect(result.has(p.key)).toBe(true);
      }
    });

    it('promotes EVERY catalog key when role.permissions contains the wildcard', () => {
      const result = effectivePermissions(
        { permissions: [] },
        { name: 'manager', permissions: [PERMISSION_WILDCARD] },
      );
      for (const p of PERMISSIONS) {
        expect(result.has(p.key)).toBe(true);
      }
    });

    it('does NOT promote the wildcard silently when granted only via `permissions: undefined`', () => {
      // Defensive — ensures we do not treat `undefined.permissions`
      // as "wildcard by accident".
      const result = effectivePermissions(
        { permissions: undefined },
        { name: 'manager', permissions: [] },
      );
      expect(result.size).toBe(0);
    });

    it('preserves unknown permissions on the user (canonical validation lives in TZ-255)', () => {
      const result = effectivePermissions(
        { permissions: ['made-up:foo'] },
        { name: 'user', permissions: [] },
      );
      // Unknown keys flow through; @Permissions() guard surfaces them.
      expect(result.has('made-up:foo')).toBe(true);
    });
  });

  describe('lastAdminInvariant()', () => {
    it('is safe when target is NOT admin in role (no effect on admin count)', () => {
      const r = lastAdminInvariant({
        currentActiveAdminCount: 1,
        targetUserIsAdminInRole: false,
        currentTargetActive: true,
        proposedTargetActive: false,
        isDeletingAdmin: false,
      });
      expect(r.safe).toBe(true);
      expect(r.reason).toBeNull();
    });

    it('is safe when admin count is > 1 and target is active admin being deactivated', () => {
      const r = lastAdminInvariant({
        currentActiveAdminCount: 2,
        targetUserIsAdminInRole: true,
        currentTargetActive: true,
        proposedTargetActive: false,
        isDeletingAdmin: false,
      });
      expect(r.safe).toBe(true);
      expect(r.reason).toBeNull();
    });

    it('rejects when only admin is being deactivated', () => {
      const r = lastAdminInvariant({
        currentActiveAdminCount: 1,
        targetUserIsAdminInRole: true,
        currentTargetActive: true,
        proposedTargetActive: false,
        isDeletingAdmin: false,
      });
      expect(r.safe).toBe(false);
      expect(r.reason).toBe('cannot-deactivate-last-active-admin');
    });

    it('rejects deletion of the only ACTIVE admin', () => {
      const r = lastAdminInvariant({
        currentActiveAdminCount: 1,
        targetUserIsAdminInRole: true,
        currentTargetActive: true,
        proposedTargetActive: false,
        isDeletingAdmin: true,
      });
      expect(r.safe).toBe(false);
      expect(r.reason).toBe('cannot-delete-last-active-admin');
    });

    it('is SAFE when deleting an already-inactive admin (inactive target + count=1)', () => {
      // Pre-mutation state: target is INACTIVE; the system's 1 active
      // admin is the OTHER admin. Deleting the inactive target leaves
      // the active admin intact → safe.
      const r = lastAdminInvariant({
        currentActiveAdminCount: 1,
        targetUserIsAdminInRole: true,
        currentTargetActive: false,
        proposedTargetActive: false,
        isDeletingAdmin: true,
      });
      expect(r.safe).toBe(true);
      expect(r.reason).toBeNull();
    });

    it('is SAFE when deleting an inactive admin while other active admins exist', () => {
      const r = lastAdminInvariant({
        currentActiveAdminCount: 2,
        targetUserIsAdminInRole: true,
        currentTargetActive: false,
        proposedTargetActive: false,
        isDeletingAdmin: true,
      });
      expect(r.safe).toBe(true);
    });
  });

  describe('OWNERSHIP_BY_ENTITY', () => {
    it('marks user-owned entities with `createdBy`', () => {
      expect(OWNERSHIP_BY_ENTITY.documentTemplate).toBe('createdBy');
      expect(OWNERSHIP_BY_ENTITY.generatedDocument).toBe('createdBy');
      expect(OWNERSHIP_BY_ENTITY.photo).toBe('createdBy');
    });

    it('marks shared corporate-data entities as `null`', () => {
      expect(OWNERSHIP_BY_ENTITY.counterparty).toBeNull();
      expect(OWNERSHIP_BY_ENTITY.product).toBeNull();
      expect(OWNERSHIP_BY_ENTITY.material).toBeNull();
      expect(OWNERSHIP_BY_ENTITY.category).toBeNull();
      expect(OWNERSHIP_BY_ENTITY.warehouse).toBeNull();
      expect(OWNERSHIP_BY_ENTITY.order).toBeNull();
      expect(OWNERSHIP_BY_ENTITY.contract).toBeNull();
      expect(OWNERSHIP_BY_ENTITY.organization).toBeNull();
    });

    it('isUserOwnedEntity() returns true for createdBy-entries and false otherwise', () => {
      expect(isUserOwnedEntity('documentTemplate')).toBe(true);
      expect(isUserOwnedEntity('photo')).toBe(true);
      expect(isUserOwnedEntity('counterparty')).toBe(false);
      expect(isUserOwnedEntity('product')).toBe(false);
    });

    it('isUserOwnedEntity() returns false for unknown entity keys (defensive default)', () => {
      expect(isUserOwnedEntity('unknown-entity-name')).toBe(false);
    });

    it('ownershipColumnFor() returns null for unknown entity keys (permission-only fallback)', () => {
      expect(ownershipColumnFor('counterparty')).toBeNull();
      expect(ownershipColumnFor('not-in-catalog')).toBeNull();
    });

    it('ownershipColumnFor() returns the same value as OWNERSHIP_BY_ENTITY lookup', () => {
      for (const [entity, column] of Object.entries(OWNERSHIP_BY_ENTITY)) {
        expect(ownershipColumnFor(entity)).toBe(column);
      }
    });
  });
});
