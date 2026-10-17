import {
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { OwnerTargetGuard } from './owner-target.guard';

/**
 * TZ-AUTH-306 — OwnerTargetGuard unit spec.
 *
 * Pins the three rules:
 *   1. non-owner mutation of the owner → 404 (no enumeration).
 *   2. owner self delete / deactivate / demote → 403 OWNER_SELF_PROTECTED;
 *      profile edit + reset-password stay allowed (break-glass).
 *   3. non-owner grant/revoke of admin power → 403 OWNER_ONLY; regular
 *      users remain manageable by ordinary admins.
 */

const OWNER_ID = new Types.ObjectId().toString();
const ADMIN_ID = new Types.ObjectId().toString();
const USER_ID = new Types.ObjectId().toString();

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
    switchToRpc: () => ({}) as never,
    switchToWs: () => ({}) as never,
    getType: () => 'http',
  } as unknown as ExecutionContext;
}

function buildGuard(target: Record<string, unknown> | null): OwnerTargetGuard {
  const userModel = {
    findById: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(target) }),
  };
  return new OwnerTargetGuard(userModel as never);
}

function actor(isOwner: boolean): { id: string; role: string; isOwner: boolean } {
  return { id: 'actor', role: 'admin', isOwner };
}

describe('OwnerTargetGuard (TZ-AUTH-306)', () => {
  describe('rule 1 — owner hidden from non-owners', () => {
    it('returns 404 when a non-owner mutates the owner', async () => {
      const guard = buildGuard({ _id: OWNER_ID, isOwner: true, role: 'admin' });
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: OWNER_ID },
        user: actor(false),
        body: { displayName: 'Hijack' },
        originalUrl: `/api/admin/users/${OWNER_ID}`,
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns 404 (not 403) so the owner existence is not fingerprintable', async () => {
      const guard = buildGuard({ _id: OWNER_ID, isOwner: true, role: 'admin' });
      const ctx = makeContext({
        method: 'DELETE',
        params: { id: OWNER_ID },
        user: actor(false),
        originalUrl: `/api/admin/users/${OWNER_ID}`,
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(NotFoundException);
      await expect(guard.canActivate(ctx)).rejects.not.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('rule 2 — owner self-protection', () => {
    it('blocks owner DELETE of their own account', async () => {
      const guard = buildGuard({ _id: OWNER_ID, isOwner: true, role: 'admin' });
      const ctx = makeContext({
        method: 'DELETE',
        params: { id: OWNER_ID },
        user: actor(true),
        originalUrl: `/api/admin/users/${OWNER_ID}`,
      });
      await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OWNER_SELF_PROTECTED' }),
      });
    });

    it('blocks owner self-deactivate', async () => {
      const guard = buildGuard({ _id: OWNER_ID, isOwner: true, role: 'admin' });
      const ctx = makeContext({
        method: 'POST',
        params: { id: OWNER_ID },
        user: actor(true),
        originalUrl: `/api/admin/users/${OWNER_ID}/deactivate`,
      });
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OWNER_SELF_PROTECTED' }),
      });
    });

    it('blocks owner self-demote via PATCH role', async () => {
      const guard = buildGuard({ _id: OWNER_ID, isOwner: true, role: 'admin' });
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: OWNER_ID },
        user: actor(true),
        body: { role: 'manager' },
        originalUrl: `/api/admin/users/${OWNER_ID}`,
      });
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OWNER_SELF_PROTECTED' }),
      });
    });

    it('blocks owner self-deactivate via PATCH isActive:false', async () => {
      const guard = buildGuard({ _id: OWNER_ID, isOwner: true, role: 'admin' });
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: OWNER_ID },
        user: actor(true),
        body: { isActive: false },
        originalUrl: `/api/admin/users/${OWNER_ID}`,
      });
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OWNER_SELF_PROTECTED' }),
      });
    });

    it('allows owner profile edit (no role/isActive change)', async () => {
      const guard = buildGuard({ _id: OWNER_ID, isOwner: true, role: 'admin' });
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: OWNER_ID },
        user: actor(true),
        body: { displayName: 'New name' },
        originalUrl: `/api/admin/users/${OWNER_ID}`,
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('allows owner reset-password (break-glass)', async () => {
      const guard = buildGuard({ _id: OWNER_ID, isOwner: true, role: 'admin' });
      const ctx = makeContext({
        method: 'POST',
        params: { id: OWNER_ID },
        user: actor(true),
        originalUrl: `/api/admin/users/${OWNER_ID}/reset-password`,
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('rule 3 — admin power is owner-only', () => {
    it('refuses a non-owner mutating another admin', async () => {
      const guard = buildGuard({ _id: ADMIN_ID, isOwner: false, role: 'admin' });
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: ADMIN_ID },
        user: actor(false),
        body: { role: 'manager' },
        originalUrl: `/api/admin/users/${ADMIN_ID}`,
      });
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OWNER_ONLY' }),
      });
    });

    it('refuses a non-owner deleting an admin', async () => {
      const guard = buildGuard({ _id: ADMIN_ID, isOwner: false, role: 'admin' });
      const ctx = makeContext({
        method: 'DELETE',
        params: { id: ADMIN_ID },
        user: actor(false),
        originalUrl: `/api/admin/users/${ADMIN_ID}`,
      });
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OWNER_ONLY' }),
      });
    });

    it('refuses a non-owner promoting a regular user to admin', async () => {
      const guard = buildGuard({ _id: USER_ID, isOwner: false, role: 'user' });
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: USER_ID },
        user: actor(false),
        body: { role: 'admin' },
        originalUrl: `/api/admin/users/${USER_ID}`,
      });
      await expect(guard.canActivate(ctx)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OWNER_ONLY' }),
      });
    });

    it('allows the owner to manage admin accounts', async () => {
      const guard = buildGuard({ _id: ADMIN_ID, isOwner: false, role: 'admin' });
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: ADMIN_ID },
        user: actor(true),
        body: { role: 'manager' },
        originalUrl: `/api/admin/users/${ADMIN_ID}`,
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('allows an ordinary admin to manage a regular (non-admin) user', async () => {
      const guard = buildGuard({ _id: USER_ID, isOwner: false, role: 'user' });
      const ctx = makeContext({
        method: 'PATCH',
        params: { id: USER_ID },
        user: actor(false),
        body: { displayName: 'Edited' },
        originalUrl: `/api/admin/users/${USER_ID}`,
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });

  describe('edge cases', () => {
    it('passes when no :id is present (create/list handled inline)', async () => {
      const guard = buildGuard(null);
      const ctx = makeContext({ method: 'POST', params: {}, user: actor(false) });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });

    it('passes when target is missing (404 downstream)', async () => {
      const guard = buildGuard(null);
      const ctx = makeContext({
        method: 'DELETE',
        params: { id: USER_ID },
        user: actor(false),
      });
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
    });
  });
});
