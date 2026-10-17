import {
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSIONS_KEY,
  Permissions,
  __TESTING_CANONICAL_PERMISSION_KEYS as CANONICAL,
} from '../decorators/permissions.decorator';
import { PermissionsGuard } from './permissions.guard';
import type { AuthenticatedUserLike } from '../contracts/rbac-contract';

/**
 * TZ-255 §ШАГ 5 — Unit spec for PermissionsGuard.
 *
 * Each `describe` block corresponds to ONE step in the guard's authorization
 * ladder (see guard docstring). Tests pin the step number in their name so a
 * regression points at the specific ladder step in the failure message.
 *
 * Additionally covers:
 *  - decorator construction canonical-key assertion
 *  - canonical-keys set shape (29 keys)
 *  - role.name === 'admin' shortcut (admin class WITHOUT '*' in perms)
 *  - wildcard `*` shortcut (non-admin WITH '*' in perms)
 *  - AND-composition with RolesGuard implied by separate guard runs
 *  - empty / non-array metadata edge cases
 */

function makeContext(req: Record<string, unknown>): ExecutionContext {
  const http = {
    getRequest: () => req,
    getNext: () => undefined,
    getResponse: () => undefined,
  };
  return {
    switchToHttp: () => http,
    getHandler: () => () => undefined,
    getClass: () => class FakeClass {},
    getArgs: () => [] as unknown[],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as any,
    switchToWs: () => ({}) as any,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

function makeGuard(metadataValue: string[] | undefined): PermissionsGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(metadataValue),
  } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

function user(overrides: Partial<AuthenticatedUserLike> = {}): AuthenticatedUserLike {
  return {
    id: '65a0000000000000000000a1',
    role: 'user',
    permissions: [],
    ...overrides,
  };
}

describe('PermissionsGuard (TZ-255 ladder)', () => {
  describe('Step 1 — no @Permissions metadata → pass-through', () => {
    it('returns true without consulting req.user', () => {
      const guard = makeGuard(undefined);
      const ctx = makeContext({ user: user() });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('returns true for empty-array metadata (defensive)', () => {
      const guard = makeGuard([]);
      const ctx = makeContext({ user: user() });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('Step 2 — no authenticated user → 401', () => {
    it('throws UnauthorizedException when req.user is missing', () => {
      const guard = makeGuard(['material:read']);
      const ctx = makeContext({});
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when req.user.id is missing', () => {
      const guard = makeGuard(['material:read']);
      const ctx = makeContext({ user: { role: 'user' } as any });
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });
  });

  describe('Step 3-4 — exact match → allow', () => {
    it('allows when user has the required permission key', () => {
      const guard = makeGuard(['material:write']);
      const ctx = makeContext({
        user: user({ permissions: ['material:write'] }),
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows when user has ONE OF multiple required keys (any-of semantics)', () => {
      const guard = makeGuard(['user:admin', 'role:admin']);
      const ctx = makeContext({
        user: user({ role: 'manager', permissions: ['role:admin'] }),
      });
      // OR semantics — at least one required key in effective → allow.
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('Step 4 — missing permission → 403 ForbiddenException', () => {
    it('throws ForbiddenException when user has no matching permission', () => {
      const guard = makeGuard(['material:write']);
      const ctx = makeContext({
        user: user({ permissions: ['material:read'] }),
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('throws ForbiddenException when user has neither of N required', () => {
      const guard = makeGuard(['user:admin', 'role:admin']);
      const ctx = makeContext({
        user: user({ permissions: ['material:write'] }),
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('REGRESSION: missing perm throws 403, NOT 401', () => {
      const guard = makeGuard(['user:write']);
      const ctx = makeContext({
        user: user({ permissions: ['material:read'] }),
      });
      // Step 2 is the only place 401 fires (no user); this is a
      // 403 case (user present, missing capability).
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
      expect(() => guard.canActivate(ctx)).not.toThrow(UnauthorizedException);
    });
  });

  describe('Step 3 — role permissions + user overrides (TZ-AUTH-RBAC-ROLE-PERMS)', () => {
    it('allows a manager role permission even when user overrides contain a different key', () => {
      const guard = makeGuard(['material:write']);
      const ctx = makeContext({
        user: user({
          role: 'manager',
          permissions: ['product:read'],
          rolePermissions: ['material:write'],
        }),
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('allows an extra user override when the role has no matching permission', () => {
      const guard = makeGuard(['product:write']);
      const ctx = makeContext({
        user: user({
          role: 'manager',
          permissions: ['product:write'],
          rolePermissions: [],
        }),
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('does not treat a lower user permission as a denial of a role permission', () => {
      const guard = makeGuard(['material:write']);
      const ctx = makeContext({
        user: user({
          role: 'manager',
          permissions: ['material:read'],
          rolePermissions: ['material:write'],
        }),
      });
      // The canonical contract is a union of user overrides and role perms;
      // there is no deny-list syntax in the RBAC catalog.
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('Step 3 — admin role shortcut (TZ-254 effectivePermissions alignment)', () => {
    it('allows admin user with NO permissions (role.name === "admin")', () => {
      // Mirror TZ-251's admin-class OR-wildcard decision: a freshly-seeded
      // admin has `permissions: []` and `role.name === 'admin'` carries
      // the ALL promotion. Failing this test would lock the admin out
      // of every @Permissions route.
      const guard = makeGuard(['user:admin']);
      const ctx = makeContext({
        user: user({ role: 'admin', permissions: [] }),
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('REGRESSION: locks out non-admin without wildcard', () => {
      const guard = makeGuard(['user:admin']);
      const ctx = makeContext({
        user: user({ role: 'manager', permissions: [] }),
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('allows non-admin WITH explicit wildcard "*" via perms array', () => {
      const guard = makeGuard(['user:admin']);
      const ctx = makeContext({
        user: user({ role: 'manager', permissions: ['*'] }),
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });
  });

  describe('TZ-AUTH-306 — owner bypass', () => {
    it('allows the single hidden owner regardless of role/permissions', () => {
      const guard = makeGuard(['user:admin']);
      const ctx = makeContext({
        user: user({ role: 'user', permissions: [], isOwner: true }),
      });
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('does NOT bypass for isOwner: false (ordinary admin still needs perms)', () => {
      const guard = makeGuard(['material:write']);
      const ctx = makeContext({
        user: user({ role: 'user', permissions: [], isOwner: false }),
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });

  describe('null/undefined defensive handling', () => {
    it('treats null permissions array as empty', () => {
      const guard = makeGuard(['material:write']);
      const ctx = makeContext({
        user: user({ permissions: null as any }),
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });

    it('treats missing permissions key as empty', () => {
      const guard = makeGuard(['material:write']);
      const ctx = makeContext({
        user: { id: 'x', role: 'user' } as AuthenticatedUserLike,
      });
      expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
    });
  });
});

describe('@Permissions decorator — canonical key construction', () => {
  // Using a stub class to evaluate the decorator on a class-with-method.
  class FakeTarget {
    handler() { /* noop */ }
  }

  it('accepts a single canonical key', () => {
    expect(() => Permissions('material:read')(FakeTarget, 'handler', Object.getOwnPropertyDescriptor(FakeTarget.prototype, 'handler')!)).not.toThrow();
  });

  it('accepts multiple canonical keys (OR semantics)', () => {
    expect(() => Permissions('user:admin', 'role:admin')(FakeTarget, 'handler', Object.getOwnPropertyDescriptor(FakeTarget.prototype, 'handler')!)).not.toThrow();
  });

  it('throws on a non-canonical key (typo regression guard)', () => {
    expect(() => Permissions('bad:key')(FakeTarget, 'handler', Object.getOwnPropertyDescriptor(FakeTarget.prototype, 'handler')!))
      .toThrow(/non-canonical key "bad:key"/);
  });

  it('accepts the wildcard "*"', () => {
    expect(() => Permissions('*')(FakeTarget, 'handler', Object.getOwnPropertyDescriptor(FakeTarget.prototype, 'handler')!)).not.toThrow();
  });

  it('exposes the metadata key PERMISSIONS_KEY for guard contract', () => {
    expect(PERMISSIONS_KEY).toBe('permissions');
  });

  it('canonical key set has 30 entries (matches the seed catalog)', () => {
    // Regression pin against catalog drift. If the seed in
    // permissions.constants.ts grows or shrinks, update this number
    // and document why. TZD-72 added `desktop:admin` (29 -> 30).
    expect(CANONICAL.size).toBe(30);
  });
});
