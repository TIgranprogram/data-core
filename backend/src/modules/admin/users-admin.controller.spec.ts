import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersAdminController } from './users-admin.controller';
import { AdminResetPasswordDto } from './dto/admin-reset-password.dto';
import type { UserService } from '../user/user.service';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

/**
 * TZ-257.A.1 §3 — UsersAdminController unit spec.
 *
 * Pure unit spec with manual mocks (repository convention — see
 * `last-admin.guard.spec.ts`). Verifies mutation delegation to
 * `UserService`, audit-safe mapped responses (no `passwordHash`), and
 * the reset-password endpoint shape.
 */

function buildController(opts: {
  create?: jest.Mock;
  update?: jest.Mock;
  remove?: jest.Mock;
  adminResetPassword?: jest.Mock;
  findById?: jest.Mock;
  find?: jest.Mock;
  countDocuments?: jest.Mock;
}) {
  const create = opts.create ?? jest.fn();
  const update = opts.update ?? jest.fn();
  const remove = opts.remove ?? jest.fn();
  const adminResetPassword = opts.adminResetPassword ?? jest.fn();
  const userService = { create, update, remove, adminResetPassword } as unknown as UserService;
  const defaultFindById = jest.fn().mockReturnValue({
    lean: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue({ accountType: 'user' }),
    }),
  });
  const userModel = {
    findById: opts.findById ?? defaultFindById,
    find: opts.find ?? jest.fn(),
    countDocuments: opts.countDocuments ?? jest.fn(),
  } as any;
  const roleModel = {} as any;
  const controller = new UsersAdminController(userModel, roleModel, userService);
  return { controller, create, update, remove, adminResetPassword, userModel };
}

function clientUserDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId().toString(),
    username: 'alice',
    email: 'a@example.com',
    displayName: 'Alice',
    role: 'manager',
    isActive: true,
    permissions: [],
    passwordHash: '$2b$10$NEVER_LEAK_ME',
    refreshTokenVersion: 3,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('UsersAdminController (TZ-257.A.1)', () => {
  describe('mutation delegation', () => {
    it('delegates create to UserService.create and returns redacted user', async () => {
      const { controller, create } = buildController({
        create: jest.fn().mockResolvedValue(clientUserDoc()),
      });
      const dto = {
        username: 'bob',
        email: 'b@x',
        displayName: 'Bob',
        password: 'secret12',
        role: 'user',
      } as any;
      const out = await controller.create(dto);
      expect(create).toHaveBeenCalledWith(dto);
      expect(out).not.toHaveProperty('passwordHash');
      expect(out).not.toHaveProperty('refreshTokenVersion');
      expect(out).toHaveProperty('id');
    });

    it('delegates update to UserService.update and returns redacted user', async () => {
      const { controller, update } = buildController({
        update: jest.fn().mockResolvedValue(clientUserDoc({ role: 'admin' })),
      });
      const dto = { role: 'manager' } as any;
      const out = await controller.update('u1', dto);
      expect(update).toHaveBeenCalledWith('u1', dto);
      expect(out).not.toHaveProperty('passwordHash');
    });

    it('delegates deactivate with isActive false and returns redacted user', async () => {
      const { controller, update } = buildController({
        update: jest.fn().mockResolvedValue(clientUserDoc({ isActive: false })),
      });
      const out = await controller.deactivate('u1');
      expect(update).toHaveBeenCalledWith('u1', { isActive: false });
      expect(out).not.toHaveProperty('passwordHash');
    });

    it('delegates delete to UserService.remove and returns redacted user', async () => {
      const { controller, remove } = buildController({
        remove: jest.fn().mockResolvedValue(clientUserDoc()),
      });
      const out = await controller.remove('u1');
      expect(remove).toHaveBeenCalledWith('u1');
      expect(out).not.toHaveProperty('passwordHash');
    });
  });

  describe('reset-password endpoint (TZ-257.A.1 §2)', () => {
    it('delegates to adminResetPassword with the DTO newPassword and returns redacted user', async () => {
      const { controller, adminResetPassword } = buildController({
        adminResetPassword: jest.fn().mockResolvedValue(clientUserDoc()),
      });
      const dto = new AdminResetPasswordDto();
      dto.newPassword = 'newpass123';
      const out = await controller.resetPassword('u1', dto);
      expect(adminResetPassword).toHaveBeenCalledWith('u1', 'newpass123');
      expect(out).not.toHaveProperty('passwordHash');
      expect(out).not.toHaveProperty('refreshTokenVersion');
    });

    it('never passes an oldPassword to the service (DTO has no oldPassword field)', () => {
      const dto = new AdminResetPasswordDto();
      expect(Object.keys(dto)).not.toContain('oldPassword');
      expect((dto as unknown as Record<string, unknown>)['oldPassword']).toBeUndefined();
    });
  });

  describe('paginated list', () => {
    function queryChain(docs: unknown[]) {
      return {
        skip: () => ({
          limit: () => ({
            sort: () => ({ lean: () => ({ exec: () => Promise.resolve(docs) }) }),
          }),
        }),
      };
    }

    it('uses safe defaults, returns total, and maps items', async () => {
      const { controller } = buildController({
        find: jest.fn().mockReturnValue(queryChain([clientUserDoc()])),
        countDocuments: jest.fn().mockReturnValue({ exec: () => Promise.resolve(3) }),
      });

      const out = await controller.list();
      expect(out).toMatchObject({ total: 3, page: 1, limit: 50 });
      expect(out.items).toHaveLength(1);
      expect(out.items[0]).not.toHaveProperty('passwordHash');
    });

    it('applies page, limit, search, and role filters before pagination', async () => {
      const find = jest.fn().mockReturnValue(queryChain([clientUserDoc()]));
      const countDocuments = jest.fn().mockReturnValue({ exec: () => Promise.resolve(1) });
      const { controller } = buildController({ find, countDocuments });

      const out = await controller.list('2', '5', undefined, 'ali', 'manager');
      expect(out).toMatchObject({ total: 1, page: 2, limit: 5 });
      expect(find).toHaveBeenCalledWith(expect.objectContaining({
        role: 'manager',
        $or: expect.any(Array),
      }));
      expect(countDocuments).toHaveBeenCalledWith(expect.objectContaining({ role: 'manager' }));
    });

    it('preserves a legacy offset as the exact skip while reporting its page', async () => {
      const skip = jest.fn().mockReturnValue({
        limit: () => ({
          sort: () => ({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
        }),
      });
      const { controller } = buildController({
        find: jest.fn().mockReturnValue({ skip }),
        countDocuments: jest.fn().mockReturnValue({ exec: () => Promise.resolve(11) }),
      });

      const out = await controller.list(undefined, '5', '10');
      expect(skip).toHaveBeenCalledWith(10);
      expect(out).toMatchObject({ items: [], total: 11, page: 3, limit: 5 });
    });

    it('returns an empty page with valid envelope metadata', async () => {
      const { controller } = buildController({
        find: jest.fn().mockReturnValue(queryChain([])),
        countDocuments: jest.fn().mockReturnValue({ exec: () => Promise.resolve(1) }),
      });

      await expect(controller.list('3', '1')).resolves.toEqual({
        items: [],
        total: 1,
        page: 3,
        limit: 1,
      });
    });
  });

  describe('TZ-AUTH-306 — owner hiding + admin-grant escalation', () => {
    function queryChain(docs: unknown[]) {
      return {
        skip: () => ({
          limit: () => ({
            sort: () => ({ lean: () => ({ exec: () => Promise.resolve(docs) }) }),
          }),
        }),
      };
    }

    it('hides the owner from a non-owner list (filter isOwner: {$ne: true})', async () => {
      const find = jest.fn().mockReturnValue(queryChain([]));
      const countDocuments = jest.fn().mockReturnValue({ exec: () => Promise.resolve(0) });
      const { controller } = buildController({ find, countDocuments });
      const actor: AuthenticatedUser = { id: 'a', username: 'a', role: 'admin', isOwner: false };
      await controller.list(undefined, undefined, undefined, undefined, undefined, actor);
      expect(find).toHaveBeenCalledWith(expect.objectContaining({ isOwner: { $ne: true } }));
      expect(countDocuments).toHaveBeenCalledWith(expect.objectContaining({ isOwner: { $ne: true } }));
    });

    it('does NOT hide the owner from the owner themselves', async () => {
      const find = jest.fn().mockReturnValue(queryChain([]));
      const countDocuments = jest.fn().mockReturnValue({ exec: () => Promise.resolve(0) });
      const { controller } = buildController({ find, countDocuments });
      const owner: AuthenticatedUser = { id: 'o', username: 'admin', role: 'admin', isOwner: true };
      await controller.list(undefined, undefined, undefined, undefined, undefined, owner);
      expect(find).toHaveBeenCalledWith(expect.not.objectContaining({ isOwner: expect.anything() }));
    });

    it('refuses a non-owner creating an admin account (OWNER_ONLY)', async () => {
      const { controller } = buildController({});
      const actor: AuthenticatedUser = { id: 'a', username: 'a', role: 'admin' };
      const dto = { username: 'bob', password: 'secret12', role: 'admin' } as any;
      await expect(controller.create(dto, actor)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(controller.create(dto, actor)).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'OWNER_ONLY' }),
      });
    });

    it('allows the owner to create an admin account', async () => {
      const create = jest.fn().mockResolvedValue(clientUserDoc({ role: 'admin' }));
      const { controller } = buildController({ create });
      const owner: AuthenticatedUser = { id: 'o', username: 'admin', role: 'admin', isOwner: true };
      const dto = { username: 'bob', password: 'secret12', role: 'admin' } as any;
      await controller.create(dto, owner);
      expect(create).toHaveBeenCalled();
    });

    it('returns 404 (not 403) when a non-owner reads the owner by id', async () => {
      const { controller } = buildController({
        findById: jest.fn().mockReturnValue({
          lean: () => ({ exec: () => Promise.resolve(clientUserDoc({ isOwner: true })) }),
        }),
      });
      const actor: AuthenticatedUser = { id: 'a', username: 'a', role: 'admin' };
      await expect(controller.getById('owner-id', actor)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('getById', () => {
    it('maps single-user reads through toClientUser (no passwordHash)', async () => {
      const { controller } = buildController({
        findById: jest.fn().mockReturnValue({
          lean: () => ({ exec: () => Promise.resolve(clientUserDoc()) }),
        }),
      });
      const out = await controller.getById('u1');
      expect(out).not.toHaveProperty('passwordHash');
      expect(out).toHaveProperty('username');
    });

    it('throws (non-ForbiddenException) for a missing target on the read path', async () => {
      const { controller } = buildController({
        findById: jest.fn().mockReturnValue({
          lean: () => ({ exec: () => Promise.resolve(null) }),
        }),
      });
      await expect(controller.getById('missing')).rejects.toBeInstanceOf(Error);
    });
  });
});
