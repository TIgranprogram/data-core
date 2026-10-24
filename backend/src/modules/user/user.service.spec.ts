import { NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { UserService } from './user.service';
import type { UserDocument } from './user.schema';
import { userActivityCache } from '../../common/guards/user-activity-cache';

/**
 * TZ-257.A.1 §3 — UserService.adminResetPassword unit spec.
 *
 * Verifies the admin reset-password contract:
 *   - no old-password comparison is performed (unlike changePassword);
 *   - the new password is bcrypt-hashed;
 *   - refreshTokenVersion is incremented (invalidates refresh tokens);
 *   - userActivityCache is invalidated.
 *
 * Manual mocks (repository convention — no live Mongo in unit suites).
 */
jest.mock('bcryptjs', () => ({
  hash: jest.fn().mockResolvedValue('$2b$10$HASHED_BY_MOCK'),
  compare: jest.fn().mockResolvedValue(true),
}));

describe('UserService.adminResetPassword (TZ-257.A.1 §2)', () => {
  function buildService(opts: {
    target?: Record<string, unknown> | null;
  }) {
    const saved = jest.fn();
    const target =
      opts.target === undefined
        ? {
            _id: new Types.ObjectId().toString(),
            username: 'alice',
            passwordHash: '$2b$10$OLD_HASH',
            refreshTokenVersion: 2,
            save: saved,
          }
        : opts.target;
    const findByIdExec = jest.fn().mockResolvedValue(target);
    const findById = jest.fn().mockReturnValue({ exec: findByIdExec });
    const model = { findById } as unknown as Model<UserDocument>;
    const service = new UserService(model);
    return { service, target, saved, findById };
  }

  it('loads the target by id and throws NotFoundException when missing', async () => {
    const { service } = buildService({ target: null });
    await expect(service.adminResetPassword('missing', 'newpass123')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('hashes the new password WITHOUT comparing an old password', async () => {
    const { service, target } = buildService({});
    const t = target!;
    const compare = bcrypt.compare as jest.Mock;
    await service.adminResetPassword(String(t._id), 'newpass123');
    expect(compare).not.toHaveBeenCalled();
    expect(bcrypt.hash).toHaveBeenCalledWith('newpass123', 10);
    expect(t.passwordHash).toBe('$2b$10$HASHED_BY_MOCK');
  });

  it('increments refreshTokenVersion and invalidates the activity cache', async () => {
    const { service, target, saved } = buildService({});
    const t = target!;
    const invalidateSpy = jest.spyOn(userActivityCache, 'invalidate');
    const id = String(t._id);
    await service.adminResetPassword(id, 'newpass123');
    expect(t.refreshTokenVersion).toBe(3);
    expect(saved).toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith(id);
    invalidateSpy.mockRestore();
  });
});

/** SK-8c: роль сотрудника — встроенная или существующая активная своя роль. */
describe('UserService — проверка роли (SK-8c)', () => {
  const ID = new Types.ObjectId().toString();
  function svc(roleDoc: Record<string, unknown> | null) {
    const rolesFind = jest.fn().mockResolvedValue(roleDoc);
    const target = { _id: ID, username: 'bob', role: 'manager', save: jest.fn() };
    const exec = { exec: jest.fn().mockResolvedValue(target) };
    const model = {
      db: { collection: jest.fn().mockReturnValue({ findOne: rolesFind }) },
      findById: jest.fn().mockReturnValue({ ...exec, select: jest.fn().mockReturnValue(exec) }),
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    } as unknown as Model<UserDocument>;
    return { service: new UserService(model), rolesFind, target };
  }

  it('неизвестная роль -> 400 по-русски', async () => {
    const { service } = svc(null);
    await expect(service.update(ID, { role: 'r-nope00' })).rejects.toThrow(/Такой роли нет/);
  });

  it('выключенная своя роль или своя без baseRole -> 400', async () => {
    await expect(svc({ isActive: false, baseRole: 'manager' }).service.update(ID, { role: 'r-x00001' })).rejects.toThrow(/Такой роли нет/);
    await expect(svc({ isActive: true }).service.update(ID, { role: 'warehouse' })).rejects.toThrow(/Такой роли нет/);
  });

  it('активная своя роль с baseRole — назначается', async () => {
    const { service, target } = svc({ isActive: true, baseRole: 'manager' });
    await service.update(ID, { role: 'r-sklad1' });
    expect(target.role).toBe('r-sklad1');
  });

  it('встроенная роль — без запроса к roles', async () => {
    const { service, rolesFind } = svc(null);
    await service.update(ID, { role: 'director' });
    expect(rolesFind).not.toHaveBeenCalled();
  });
});
