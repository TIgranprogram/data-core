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
