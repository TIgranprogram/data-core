import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { OwnerOnlyGuard } from './owner-only.guard';

/** TZ-AUTH-306 — OwnerOnlyGuard unit spec. */
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

describe('OwnerOnlyGuard (TZ-AUTH-306)', () => {
  it('allows the single owner', () => {
    const guard = new OwnerOnlyGuard();
    expect(guard.canActivate(makeContext({ id: 'u', role: 'admin', isOwner: true }))).toBe(true);
  });

  it('refuses a non-owner with a safe 403 OWNER_ONLY', () => {
    const guard = new OwnerOnlyGuard();
    expect(() =>
      guard.canActivate(makeContext({ id: 'u', role: 'admin', isOwner: false })),
    ).toThrow(ForbiddenException);
    try {
      guard.canActivate(makeContext({ id: 'u', role: 'admin', isOwner: false }));
    } catch (err) {
      const resp = (err as ForbiddenException).getResponse();
      expect(resp).toMatchObject({ code: 'OWNER_ONLY' });
    }
  });

  it('refuses a missing user context', () => {
    const guard = new OwnerOnlyGuard();
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
