import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginSoftlockService } from '../../common/login-softlock/login-softlock.service';
import { UserService } from '../user/user.service';

/**
 * TZ-249 unit tests for AuthService.
 *
 * Covers:
 *  - Generic 401 message identity (TZ-249 §2.3).
 *  - Production register role coerce (TZ-249 §2.2 — manager silently → 'user').
 *  - Dev register does NOT coerce (role respected as-is).
 *  - Softlock pre-check returns the SAME generic 401 message.
 *  - Softlock bucket is incremented on wrong-password only.
 *  - Softlock bucket is reset on successful login.
 *
 * Uses an in-memory UserService stub with a captured-input spy so the
 * production-coerce assertion is real (not a tautology).
 */

interface CapturedCreate {
  username?: unknown;
  email?: unknown;
  displayName?: unknown;
  password?: unknown;
  role?: unknown;
  permissions?: unknown;
  isActive?: unknown;
  phone?: unknown;
  fullName?: unknown;
}

class FakeUserService {
  /** Captured create() input — used by role-coerce tests. */
  public lastCreateArgs: CapturedCreate = {};

  async create(input: CapturedCreate) {
    this.lastCreateArgs = { ...input };
    return {
      id: 'mock-id',
      username: input.username,
      email: input.email,
      displayName: input.displayName,
      role: input.role,
      permissions: input.permissions,
      isActive: input.isActive,
      phone: input.phone,
      fullName: input.fullName,
      refreshTokenVersion: 0,
      lastLoginAt: null,
      save: async () => undefined,
    } as never;
  }
  async findByUsername(_username: string) {
    void _username;
    return null;
  }
  async findById(_id: string) {
    void _id;
    return null;
  }
  async verifyPassword(_user: never, _plain: string) {
    void _user;
    void _plain;
    return false;
  }
  async incrementRefreshVersion(_id: string) {
    void _id;
    return;
  }
}

interface BuildOpts {
  nodeEnv?: string;
  user?: Record<string, unknown> | null;
  verifyResult?: boolean;
}

function buildAuthService(opts: BuildOpts = {}): {
  svc: AuthService;
  users: FakeUserService;
  softlock: LoginSoftlockService;
} {
  const users = new FakeUserService();
  if (opts.user !== undefined) {
    users.findByUsername = async () => opts.user as never;
  }
  if (opts.verifyResult !== undefined) {
    users.verifyPassword = async () => opts.verifyResult as boolean;
  }
  const jwt = { signAsync: async () => 'mock-token' } as unknown as JwtService;
  const config = {
    get: (key: string) => {
      if (key === 'nodeEnv') return opts.nodeEnv ?? 'production';
      if (key === 'jwt.secret') return 'a-strong-test-jwt-secret-32-chars-x';
      if (key === 'jwt.refreshSecret') return 'a-strong-test-refresh-secret-32-chars';
      return undefined;
    },
  } as unknown as ConfigService;
  const softlock = new LoginSoftlockService();
  softlock.__resetForTests();
  const rolesMock = { findByName: jest.fn().mockResolvedValue(null) };
  const svc = new AuthService(
    users as unknown as UserService,
    jwt,
    config,
    softlock,
    rolesMock as any,
  );
  return { svc, users, softlock };
}

function mockRes() {
  return {
    cookie: () => undefined,
  } as never;
}

describe('AuthService (TZ-249 §2.2-2.4)', () => {
  describe('login() — generic credential messages (TZ-249 §2.3)', () => {
    it('throws the SAME generic 401 message for an unknown user', async () => {
      const { svc } = buildAuthService({ user: null });
      const dto = { username: 'ghost', password: 'anything' };
      await expect(svc.login(dto, mockRes(), '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(svc.login(dto, mockRes(), '127.0.0.1')).rejects.toMatchObject({
        message: 'Неверный логин или пароль',
      });
    });

    it('throws the SAME generic 401 message for a wrong password on a real user', async () => {
      const { svc } = buildAuthService({
        user: {
          id: 'u1',
          username: 'alice',
          email: 'a@example.com',
          displayName: 'A',
          role: 'user',
          permissions: [],
          isActive: true,
          refreshTokenVersion: 0,
          phone: null,
          fullName: null,
        },
        verifyResult: false,
      });
      const dto = { username: 'alice', password: 'wrong-password' };
      await expect(svc.login(dto, mockRes(), '127.0.0.1')).rejects.toThrow(
        UnauthorizedException,
      );
      await expect(svc.login(dto, mockRes(), '127.0.0.1')).rejects.toMatchObject({
        message: 'Неверный логин или пароль',
      });
    });

    it('does NOT leak whether the user exists by message shape', async () => {
      const { svc: svcNoUser } = buildAuthService({ user: null });
      const { svc: svcWrongPwd } = buildAuthService({
        user: {
          id: 'u1',
          username: 'alice',
          email: 'a@example.com',
          displayName: 'A',
          role: 'user',
          permissions: [],
          isActive: true,
          refreshTokenVersion: 0,
          phone: null,
          fullName: null,
        },
        verifyResult: false,
      });
      const dto1 = { username: 'ghost', password: 'x' };
      const dto2 = { username: 'alice', password: 'y' };
      let m1: string | undefined;
      let m2: string | undefined;
      try {
        await svcNoUser.login(dto1, mockRes(), '127.0.0.1');
      } catch (e) {
        m1 = (e as Error).message;
      }
      try {
        await svcWrongPwd.login(dto2, mockRes(), '127.0.0.1');
      } catch (e) {
        m2 = (e as Error).message;
      }
      expect(m1).toBe(m2);
    });
  });

  describe('login() — softlock (TZ-249 §2.4)', () => {
    it('returns the SAME generic 401 message when the username is locked', async () => {
      const { svc, softlock } = buildAuthService({ user: null });
      const username = 'locked-user';
      // Use the public API to reach the locked state (5 recordFailure calls).
      for (let i = 0; i < 5; i++) {
        softlock.recordFailure(username);
      }
      expect(softlock.isLocked(username)).toBe(true);
      await expect(
        svc.login({ username, password: 'whatever' }, mockRes(), '127.0.0.1'),
      ).rejects.toMatchObject({ message: 'Неверный логин или пароль' });
    });

    it('does NOT increment softlock bucket for the missing-user path', async () => {
      const { svc, softlock } = buildAuthService({ user: null });
      const sizeBefore = softlock['entries'].size;
      await expect(
        svc.login({ username: 'ghost', password: 'x' }, mockRes(), '127.0.0.1'),
      ).rejects.toThrow();
      // missing-user path performs bcrypt-dummy compare but does NOT mutate
      // the softlock (the user is unknown, so no escalation history exists).
      expect(softlock['entries'].size).toBe(sizeBefore);
    });

    it('DOES increment softlock bucket on a verified wrong-password attempt', async () => {
      const users = new FakeUserService();
      const verifyUser = {
        id: 'u1',
        username: 'alice',
        email: 'a@example.com',
        displayName: 'A',
        role: 'user',
        permissions: [],
        isActive: true,
        refreshTokenVersion: 0,
        phone: null,
        fullName: null,
      };
      users.findByUsername = async () => verifyUser as never;
      users.verifyPassword = async () => false;
      const jwt = { signAsync: async () => 'mock' } as unknown as JwtService;
      const config = {
        get: (k: string) =>
          k === 'nodeEnv'
            ? 'test'
            : k === 'jwt.secret'
              ? 'a-strong-test-jwt-secret-32-chars-x'
              : k === 'jwt.refreshSecret'
                ? 'a-strong-test-refresh-secret-32-chars'
                : undefined,
      } as unknown as ConfigService;
      const softlock = new LoginSoftlockService();
      softlock.__resetForTests();
      const rolesMock = { findByName: jest.fn().mockResolvedValue(null) };
      const svc = new AuthService(
        users as unknown as UserService,
        jwt,
        config,
        softlock,
        rolesMock as any,
      );
      const before = softlock['entries'].size;
      await expect(
        svc.login({ username: 'alice', password: 'wrong' }, mockRes(), '127.0.0.1'),
      ).rejects.toThrow();
      expect(softlock['entries'].size).toBe(before + 1);
      expect(softlock.isLocked('alice')).toBe(false); // only 1 failure so far
    });

    it('returns the SAME generic 401 message when softlock is triggered (TS-249 §2.4 parity)', async () => {
      const { svc, softlock } = buildAuthService({ user: null });
      const username = 'lockout-user';
      for (let i = 0; i < 5; i++) {
        softlock.recordFailure(username);
      }
      let capturedMessage: string | undefined;
      try {
        await svc.login(
          { username, password: 'correct-password' },
          mockRes(),
          '127.0.0.1',
        );
      } catch (e) {
        capturedMessage = (e as Error).message;
      }
      expect(capturedMessage).toBe('Неверный логин или пароль');
    });
  });

  describe('register() — production role coerce (TZ-249 §2.2)', () => {
    it('coerces manager role -> user when NODE_ENV=production (real assertion via spy)', async () => {
      const { users, svc } = buildAuthService({ nodeEnv: 'production' });
      const dto = {
        username: 'alice',
        email: 'a@example.com',
        displayName: 'A',
        password: 'a-strong-pass-12345',
        role: 'manager',
        permissions: [],
        isActive: true,
      };
      await svc.register(dto, mockRes());
      // The user.service.create() was called with role='user' despite the
      // DTO passing role='manager'. The captured arg is the proof.
      expect(users.lastCreateArgs.role).toBe('user');
    });

    it('preserves manager role when NODE_ENV=development', async () => {
      const { users, svc } = buildAuthService({ nodeEnv: 'development' });
      const dto = {
        username: 'bob',
        email: 'b@example.com',
        displayName: 'B',
        password: 'a-strong-pass-12345',
        role: 'manager',
        permissions: [],
        isActive: true,
      };
      await svc.register(dto, mockRes());
      expect(users.lastCreateArgs.role).toBe('manager');
    });

    it('preserves user role in production (no-op coerce for the default case)', async () => {
      const { users, svc } = buildAuthService({ nodeEnv: 'production' });
      const dto = {
        username: 'carol',
        email: 'c@example.com',
        displayName: 'C',
        password: 'a-strong-pass-12345',
        role: 'user',
        permissions: [],
        isActive: true,
      };
      await svc.register(dto, mockRes());
      expect(users.lastCreateArgs.role).toBe('user');
    });
  });

  describe('login() — refresh in JSON body (TZ-DEPLOY-301 variant A)', () => {
    it('returns access + refresh JWTs in the response body', async () => {
      const userDoc = {
        id: 'u1',
        username: 'alice',
        email: 'a@example.com',
        displayName: 'A',
        role: 'user',
        permissions: [] as string[],
        isActive: true,
        refreshTokenVersion: 0,
        phone: null,
        fullName: null,
        lastLoginAt: null,
        save: async () => undefined,
      };
      const { svc } = buildAuthService({
        user: userDoc,
        verifyResult: true,
      });
      const body = await svc.login(
        { username: 'alice', password: 'correct' },
        mockRes(),
        '127.0.0.1',
      );
      expect(body.access).toBe('mock-token');
      expect(body.refresh).toBe('mock-token');
      expect(body.user.username).toBe('alice');
    });
  });

  describe('getMe() — pages[] (TZ-RBAC-304)', () => {
    it('returns pages from the role projection and never leaks secrets', async () => {
      const userDoc = {
        id: 'u-me',
        username: 'alice',
        email: 'a@example.com',
        displayName: 'A',
        role: 'manager',
        permissions: ['product:read'],
        isActive: true,
        refreshTokenVersion: 7,
        passwordHash: 'secret-hash',
        phone: null,
        fullName: null,
        organizationId: null,
      };
      const users = new FakeUserService();
      users.findById = async () => userDoc as never;
      const jwt = { signAsync: async () => 'mock-token' } as unknown as JwtService;
      const config = {
        get: (key: string) => {
          if (key === 'nodeEnv') return 'production';
          if (key === 'jwt.secret') return 'a-strong-test-jwt-secret-32-chars-x';
          if (key === 'jwt.refreshSecret') return 'a-strong-test-refresh-secret-32-chars';
          return undefined;
        },
      } as unknown as ConfigService;
      const softlock = new LoginSoftlockService();
      softlock.__resetForTests();
      const rolesMock = {
        findByName: jest.fn().mockResolvedValue({
          name: 'manager',
          permissions: ['product:write'],
          pages: ['products', 'materials'],
        }),
      };
      const svc = new AuthService(
        users as unknown as UserService,
        jwt,
        config,
        softlock,
        rolesMock as any,
      );

      const me = await svc.getMe('u-me');
      expect(me.pages).toEqual(['products', 'materials']);
      expect(me.permissions).toEqual(['product:read', 'product:write']);
      expect(me).not.toHaveProperty('passwordHash');
      expect(me).not.toHaveProperty('refreshTokenVersion');
    });

    it('returns pages=[] when the role has no page ACL', async () => {
      const userDoc = {
        id: 'u-me-2',
        username: 'bob',
        email: 'b@example.com',
        displayName: 'B',
        role: 'user',
        permissions: [],
        isActive: true,
        refreshTokenVersion: 0,
        phone: null,
        fullName: null,
        organizationId: null,
      };
      const users = new FakeUserService();
      users.findById = async () => userDoc as never;
      const jwt = { signAsync: async () => 'mock-token' } as unknown as JwtService;
      const config = {
        get: () => undefined,
      } as unknown as ConfigService;
      const softlock = new LoginSoftlockService();
      softlock.__resetForTests();
      const rolesMock = { findByName: jest.fn().mockResolvedValue(null) };
      const svc = new AuthService(
        users as unknown as UserService,
        jwt,
        config,
        softlock,
        rolesMock as any,
      );

      const me = await svc.getMe('u-me-2');
      expect(me.pages).toEqual([]);
    });
  });

  describe('getMe() — owner surface (TZ-AUTH-306)', () => {
    function buildGetMeSvc(userDoc: Record<string, unknown>, rolePages: string[]) {
      const users = new FakeUserService();
      users.findById = async () => userDoc as never;
      const jwt = { signAsync: async () => 'mock-token' } as unknown as JwtService;
      const config = {
        get: () => undefined,
      } as unknown as ConfigService;
      const softlock = new LoginSoftlockService();
      softlock.__resetForTests();
      const rolesMock = {
        findByName: jest.fn().mockResolvedValue({ name: 'admin', pages: rolePages }),
      };
      return new AuthService(
        users as unknown as UserService,
        jwt,
        config,
        softlock,
        rolesMock as any,
      );
    }

    it('exposes isOwner: true only for the owner and keeps admin-roles page', async () => {
      const svc = buildGetMeSvc(
        {
          id: 'u-owner',
          username: 'admin',
          email: 'admin@kppdf.local',
          displayName: 'Owner',
          role: 'admin',
          permissions: [],
          isActive: true,
          refreshTokenVersion: 0,
          phone: null,
          fullName: null,
          organizationId: null,
          isOwner: true,
        },
        ['admin-users', 'admin-roles', 'products'],
      );
      const me = await svc.getMe('u-owner');
      expect(me.isOwner).toBe(true);
      expect(me.pages).toEqual(['admin-users', 'admin-roles', 'products']);
      expect(me.permissions).toContain('user:admin');
    });

    it('reports isOwner: false and strips the owner-only admin-roles page for non-owners', async () => {
      const svc = buildGetMeSvc(
        {
          id: 'u-admin',
          username: 'admin2',
          email: 'admin2@kppdf.local',
          displayName: 'Ordinary admin',
          role: 'admin',
          permissions: [],
          isActive: true,
          refreshTokenVersion: 0,
          phone: null,
          fullName: null,
          organizationId: null,
          isOwner: false,
        },
        ['admin-users', 'admin-roles', 'products'],
      );
      const me = await svc.getMe('u-admin');
      expect(me.isOwner).toBe(false);
      expect(me.pages).toEqual(['admin-users', 'products']);
      expect(me.pages).not.toContain('admin-roles');
    });
  });
});
