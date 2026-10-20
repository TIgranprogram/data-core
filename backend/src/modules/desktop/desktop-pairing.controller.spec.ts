import { Reflector } from '@nestjs/core';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { DesktopPairingController } from './desktop-pairing.controller';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator';
import type { AuthenticatedUserLike } from '../../common/contracts/rbac-contract';

/**
 * TZD-72 — RBAC gate on pairing-key issue/list/revoke.
 *
 * Uses the REAL `DesktopPairingController` class + a REAL `Reflector`
 * (not a mocked one) so the guard reads the actual `@Permissions(...)`
 * metadata reflected off the production controller methods — proving the
 * decorator is really wired, not just unit-testing the guard in isolation
 * (that generic ladder is already covered by `permissions.guard.spec.ts`).
 */

const GATED_METHODS = ['issue', 'issuePairing', 'list', 'revoke'] as const;

function makeContext(
  handlerName: (typeof GATED_METHODS)[number] | 'compatInfo',
  user: AuthenticatedUserLike | undefined,
): ExecutionContext {
  const handler = (
    DesktopPairingController.prototype as unknown as Record<string, () => unknown>
  )[handlerName];
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => DesktopPairingController,
  } as unknown as ExecutionContext;
}

function user(overrides: Partial<AuthenticatedUserLike> = {}): AuthenticatedUserLike {
  return { id: '65a0000000000000000000a1', role: 'user', permissions: [], ...overrides };
}

describe('DesktopPairingController RBAC (TZD-72)', () => {
  const guard = new PermissionsGuard(new Reflector());

  it.each(GATED_METHODS)('%s: has @Permissions(desktop:admin) metadata', (name) => {
    const handler = (
      DesktopPairingController.prototype as unknown as Record<string, () => unknown>
    )[name];
    expect(Reflect.getMetadata(PERMISSIONS_KEY, handler)).toEqual(['desktop:admin']);
  });

  it.each(GATED_METHODS)('%s: 403 for an authenticated user without desktop:admin', (name) => {
    const ctx = makeContext(name, user({ role: 'manager', permissions: [] }));
    expect(() => guard.canActivate(ctx)).toThrow(ForbiddenException);
  });

  it.each(GATED_METHODS)('%s: 200 (allowed) with explicit desktop:admin permission', (name) => {
    const ctx = makeContext(name, user({ role: 'manager', permissions: ['desktop:admin'] }));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it.each(GATED_METHODS)('%s: 200 (allowed) for admin role (wildcard shortcut)', (name) => {
    const ctx = makeContext(name, user({ role: 'admin', permissions: [] }));
    expect(guard.canActivate(ctx)).toBe(true);
  });

  it('compatInfo carries no @Permissions metadata — stays @Public', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, DesktopPairingController.prototype.compatInfo)).toBeUndefined();
    const ctx = makeContext('compatInfo', undefined);
    expect(guard.canActivate(ctx)).toBe(true);
  });
});
