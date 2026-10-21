import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

/** TZ-AUTH-306 — RolesGuard unit spec (owner bypass + legacy role gate). */
function makeContext(user: Record<string, unknown> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class FakeClass {},
    getArgs: () => [] as unknown[],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

function makeGuard(requiredRoles: string[] | undefined): RolesGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requiredRoles),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('RolesGuard (TZ-AUTH-306)', () => {
  it('passes when no @Roles metadata is present', () => {
    expect(makeGuard(undefined).canActivate(makeContext(undefined))).toBe(true);
  });

  it('allows a user whose role is required', () => {
    const guard = makeGuard(['admin']);
    expect(guard.canActivate(makeContext({ role: 'admin' }))).toBe(true);
  });

  it('refuses a user whose role is not required', () => {
    const guard = makeGuard(['admin']);
    expect(() => guard.canActivate(makeContext({ role: 'user' }))).toThrow(
      ForbiddenException,
    );
  });

  it('TZ-AUTH-306 — allows the single owner regardless of role name', () => {
    const guard = makeGuard(['admin']);
    expect(
      guard.canActivate(makeContext({ role: 'user', isOwner: true })),
    ).toBe(true);
  });

  it('TZ-AUTH-306 — does NOT bypass for isOwner: false', () => {
    const guard = makeGuard(['admin']);
    expect(() =>
      guard.canActivate(makeContext({ role: 'user', isOwner: false })),
    ).toThrow(ForbiddenException);
  });
});
