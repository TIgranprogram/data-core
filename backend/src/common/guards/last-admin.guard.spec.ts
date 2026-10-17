import {
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Types } from 'mongoose';
import { LastAdminGuard } from './last-admin.guard';

/**
 * TZ-257 §ШАГ 5 — LastAdminGuard unit spec.
 *
 * Pure unit spec for the guard's verdict logic. We construct a
 * `User` document mock with the bare minimum chainable query
 * interface that LastAdminGuard uses (`findById().exec()` and
 * `countDocuments().exec()`).
 */
describe('LastAdminGuard (TZ-257 §ШАГ 1)', () => {
  const VALID_USER_ID = new Types.ObjectId().toString();
  const OTHER_USER_ID = new Types.ObjectId().toString();

  function makeContext(req: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => req,
        getNext: () => undefined,
        getResponse: () => undefined,
      }),
      getHandler: () => () => undefined,
      getClass: () => class FakeClass {},
      getArgs: () => [] as unknown[],
      getArgByIndex: () => undefined,
      switchToRpc: () => ({}) as any,
      switchToWs: () => ({}) as any,
      getType: () => 'http',
    } as unknown as ExecutionContext;
  }

  function buildModelMock(opts: {
    target?: { id: string; role: string; isActive: boolean } | null;
    adminCount: number;
  }): { userModel: any } {
    const findByIdExec = jest.fn().mockResolvedValue(opts.target);
    const findById = jest.fn().mockReturnValue({ exec: findByIdExec });
    const countExec = jest.fn().mockResolvedValue(opts.adminCount);
    const countDocuments = jest.fn().mockReturnValue({ exec: countExec });
    const userModel = { findById, countDocuments };
    return { userModel };
  }

  function buildGuard(userModel: any): LastAdminGuard {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    } as unknown as Reflector;
    return new LastAdminGuard(reflector, userModel);
  }

  describe('Target user is admin', () => {
    it('REJECTS delete of the only active admin (LAST_ADMIN_INVARIANT)', async () => {
      const adminId = VALID_USER_ID;
      const { userModel } = buildModelMock({
        target: { id: adminId, role: 'admin', isActive: true },
        adminCount: 1,
      });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'DELETE',
        params: { id: adminId },
        user: { id: OTHER_USER_ID, role: 'admin' },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows delete of last admin if count was wrong (sanity, count was 2)', async () => {
      const adminId = VALID_USER_ID;
      const { userModel } = buildModelMock({
        target: { id: adminId, role: 'admin', isActive: true },
        adminCount: 2,
      });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'DELETE',
        params: { id: adminId },
        user: { id: OTHER_USER_ID, role: 'admin' },
      });
      // active admins INCLUDING target = 2 → delete leaves 1 → safe
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('REJECTS deactivation of the only active admin', async () => {
      const { userModel } = buildModelMock({
        target: { id: VALID_USER_ID, role: 'admin', isActive: true },
        adminCount: 1,
      });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: VALID_USER_ID },
        user: { id: OTHER_USER_ID, role: 'admin' },
        body: { isActive: false },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows deactivation when count > 1', async () => {
      const { userModel } = buildModelMock({
        target: { id: VALID_USER_ID, role: 'admin', isActive: true },
        adminCount: 2,
      });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: VALID_USER_ID },
        user: { id: OTHER_USER_ID, role: 'admin' },
        body: { isActive: false },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('TZ-257.A.1 REJECTS demotion of the only active admin via PATCH body.role', async () => {
      const adminId = VALID_USER_ID;
      const { userModel } = buildModelMock({
        target: { id: adminId, role: 'admin', isActive: true },
        adminCount: 1,
      });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: adminId },
        user: { id: OTHER_USER_ID, role: 'admin' },
        body: { role: 'manager' },
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('TZ-257.A.1 allows demotion when another active admin exists', async () => {
      const { userModel } = buildModelMock({
        target: { id: VALID_USER_ID, role: 'admin', isActive: true },
        adminCount: 2,
      });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: VALID_USER_ID },
        user: { id: OTHER_USER_ID, role: 'admin' },
        body: { role: 'manager' },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('TZ-257.A.1 allows no-op role patch (admin → admin)', async () => {
      const { userModel } = buildModelMock({
        target: { id: VALID_USER_ID, role: 'admin', isActive: true },
        adminCount: 1,
      });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: VALID_USER_ID },
        user: { id: OTHER_USER_ID, role: 'admin' },
        body: { role: 'admin' },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('Target user is NOT admin', () => {
    it('allows any mutation (no last-admin concern)', async () => {
      const { userModel } = buildModelMock({
        target: { id: VALID_USER_ID, role: 'manager', isActive: true },
        adminCount: 1,
      });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'DELETE',
        params: { id: VALID_USER_ID },
        user: { id: OTHER_USER_ID, role: 'admin' },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('TZ-257.A.1 allows role patch on a non-admin target (no invariant)', async () => {
      const { userModel } = buildModelMock({
        target: { id: VALID_USER_ID, role: 'manager', isActive: true },
        adminCount: 1,
      });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: VALID_USER_ID },
        user: { id: OTHER_USER_ID, role: 'admin' },
        body: { role: 'user' },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('passes when target :id is missing (no validation target)', async () => {
      const { userModel } = buildModelMock({ adminCount: 1 });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'GET',
        params: {},
        user: { id: OTHER_USER_ID, role: 'admin' },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(userModel.findById).not.toHaveBeenCalled();
    });

    it('passes when target user is not found (no validation target)', async () => {
      const { userModel } = buildModelMock({ target: null, adminCount: 1 });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'DELETE',
        params: { id: VALID_USER_ID },
        user: { id: OTHER_USER_ID, role: 'admin' },
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('ForbiddenException shape', () => {
    it('exposes reason code on the rejection', async () => {
      const { userModel } = buildModelMock({
        target: { id: VALID_USER_ID, role: 'admin', isActive: true },
        adminCount: 1,
      });
      const guard = buildGuard(userModel);
      const ctx = makeContext({
        method: 'DELETE',
        params: { id: VALID_USER_ID },
        user: { id: OTHER_USER_ID, role: 'admin' },
      });
      try {
        await guard.canActivate(ctx);
        throw new Error('expected rejection');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const resp = (err as ForbiddenException).getResponse();
        expect(typeof resp === 'object' && resp !== null ? (resp as { code?: string }).code : undefined).toBe('LAST_ADMIN_INVARIANT');
      }
    });
  });
});
