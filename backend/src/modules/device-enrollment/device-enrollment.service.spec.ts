import {
  ForbiddenException,
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DeviceEnrollmentService } from './device-enrollment.service';
import { sha256Hex } from './device-crypto';

type AnyModel = { [k: string]: jest.Mock };

/** Minimal Mongoose query shim: supports `.exec()`, `.lean().exec()`, `.session()`. */
function q<T>(value: T | null) {
  const query: { exec: jest.Mock; lean: jest.Mock; session: jest.Mock } = {
    exec: jest.fn().mockResolvedValue(value),
    lean: jest.fn(),
    session: jest.fn(),
  };
  query.lean.mockReturnValue(query);
  query.session.mockReturnValue(query);
  return query;
}

function makeService(overrides: Partial<{
  invite: AnyModel;
  grant: AnyModel;
  user: AnyModel;
  role: AnyModel;
  config: Record<string, unknown>;
}> = {}) {
  const invite = overrides.invite ?? { findOne: jest.fn(), create: jest.fn() };
  const grant = overrides.grant ?? {
    findOne: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };
  const user = overrides.user ?? {
    findOne: jest.fn(),
    findById: jest.fn(),
    create: jest.fn(),
    updateOne: jest.fn(),
  };
  const role = overrides.role ?? { findOne: jest.fn() };
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, unknown> = {
        'device.inviteTtlDays': 3,
        'device.grantTtlDays': 365,
        'device.ownerInviteTtlMinutes': 15,
        'device.deviceJwtTtlSeconds': 300,
        'device.inviteSecretBytes': 32,
        'device.grantSecretBytes': 32,
        'device.cookieName': '__Host-kppdf-device',
        'device.enrollBaseUrl': 'http://localhost:4200',
        'jwt.secret': 'test-secret-min-16-chars',
        ...overrides.config,
      };
      return values[key];
    }),
  };
  const jwt = { signAsync: jest.fn(async () => 'signed-jwt') };
  const audit = { log: jest.fn(async () => undefined) };
  const connection = { startSession: jest.fn() };
  const service = new DeviceEnrollmentService(
    invite as never,
    grant as never,
    user as never,
    role as never,
    connection as never,
    jwt as never,
    config as never,
    audit as never,
  );
  return { service, invite, grant, user, role, jwt, audit, config };
}

describe('DeviceEnrollmentService (TZ-AUTH-303)', () => {
  describe('issueRegularInvite', () => {
    it('rejects a missing/inactive role', async () => {
      const { service, role } = makeService();
      role.findOne.mockReturnValue(q(null));
      await expect(
        service.issueRegularInvite({ id: 'a'.repeat(24) }, { role: 'manager' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects admin role for a non-owner', async () => {
      const { service, role } = makeService();
      role.findOne.mockReturnValue(q({ name: 'admin', isActive: true }));
      await expect(
        service.issueRegularInvite(
          { id: 'a'.repeat(24), isOwner: false },
          { role: 'admin' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns a one-time secret + URL for a valid active role', async () => {
      const { service, invite, role } = makeService();
      role.findOne.mockReturnValue(q({ name: 'manager', isActive: true }));
      invite.create.mockResolvedValue({
        _id: 'b'.repeat(24),
        expiresAt: new Date(),
      });
      const out = await service.issueRegularInvite(
        { id: 'a'.repeat(24), isOwner: true },
        { role: 'manager' },
      );
      expect(out.secret).toBeTruthy();
      expect(out.url).toContain(`/enroll/${out.secret}`);
      // the stored record is the hash, not the plaintext
      expect(invite.create).toHaveBeenCalledWith(
        expect.objectContaining({ secretHash: sha256Hex(out.secret) }),
      );
    });
  });

  describe('statusFromCookie', () => {
    it('returns revoked with no cookie', async () => {
      const { service } = makeService();
      await expect(service.statusFromCookie(undefined)).resolves.toEqual({
        status: 'revoked',
      });
    });

    it('returns revoked for an unknown/revoked grant', async () => {
      const { service, grant } = makeService();
      grant.findOne.mockReturnValue(q(null));
      await expect(service.statusFromCookie('x'.repeat(32))).resolves.toEqual({
        status: 'revoked',
      });
    });

    it('returns expired for a past expiresAt', async () => {
      const { service, grant } = makeService();
      grant.findOne.mockReturnValue(
        q({
          status: 'active',
          expiresAt: new Date(Date.now() - 1000),
          deviceName: 'PC',
          userId: 'u'.repeat(24),
        }),
      );
      await expect(service.statusFromCookie('x'.repeat(32))).resolves.toEqual({
        status: 'expired',
      });
    });

    it('returns revoked for an inactive device user', async () => {
      const { service, grant, user } = makeService();
      grant.findOne.mockReturnValue(
        q({
          status: 'active',
          expiresAt: new Date(Date.now() + 86400000),
          deviceName: 'PC',
          userId: 'u'.repeat(24),
        }),
      );
      user.findById.mockReturnValue(q(null));
      await expect(service.statusFromCookie('x'.repeat(32))).resolves.toEqual({
        status: 'revoked',
      });
    });
  });

  describe('sessionFromCookie', () => {
    it('rejects a revoked grant', async () => {
      const { service, grant } = makeService();
      grant.findOne.mockReturnValue(q({ status: 'revoked', expiresAt: new Date() }));
      await expect(service.sessionFromCookie('x'.repeat(32))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an expired grant', async () => {
      const { service, grant } = makeService();
      grant.findOne.mockReturnValue(
        q({ status: 'active', expiresAt: new Date(Date.now() - 1000) }),
      );
      await expect(service.sessionFromCookie('x'.repeat(32))).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('issues a short JWT for an active grant', async () => {
      const { service, grant, user, role, jwt } = makeService();
      grant.findOne.mockReturnValue(
        q({
          _id: 'g'.repeat(24),
          status: 'active',
          expiresAt: new Date(Date.now() + 86400000),
          userId: 'u'.repeat(24),
        }),
      );
      grant.updateOne.mockReturnValue(q(null));
      user.findById.mockReturnValue(
        q({ _id: 'u'.repeat(24), role: 'manager', isActive: true }),
      );
      role.findOne.mockReturnValue(q({ name: 'manager', isActive: true }));
      const access = await service.sessionFromCookie('x'.repeat(32));
      expect(access).toBe('signed-jwt');
      expect(jwt.signAsync).toHaveBeenCalledWith(
        expect.objectContaining({ sub: 'u'.repeat(24) }),
        expect.objectContaining({ expiresIn: '300s' }),
      );
    });
  });

  describe('consumeInvite (pre-checks)', () => {
    it('returns a generic 410 for an unknown secret', async () => {
      const { service, invite } = makeService();
      invite.findOne.mockReturnValue(q(null));
      await expect(
        service.consumeInvite('y'.repeat(32), 'PC'),
      ).rejects.toThrow(GoneException);
    });

    it('returns 409 for an already-consumed invite', async () => {
      const { service, invite } = makeService();
      invite.findOne.mockReturnValue(
        q({
          consumedAt: new Date(),
          expiresAt: new Date(Date.now() + 86400000),
        }),
      );
      await expect(
        service.consumeInvite('y'.repeat(32), 'PC'),
      ).rejects.toThrow('Приглашение уже использовано');
    });
  });
});
