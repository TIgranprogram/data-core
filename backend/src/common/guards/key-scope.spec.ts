import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { isAdminRoute, keyScopeViolation, normalizeKeyScope } from './key-scope';

describe('key-scope (P2)', () => {
  describe('normalizeKeyScope', () => {
    it('нет scope / мусор → full', () => {
      expect(normalizeKeyScope(undefined)).toEqual({ access: 'full' });
      expect(normalizeKeyScope(null)).toEqual({ access: 'full' });
      expect(normalizeKeyScope({ access: 'root' })).toEqual({ access: 'full' });
    });
    it('сохраняет access и непустой apps', () => {
      expect(normalizeKeyScope({ access: 'read', apps: ['a', 'b'] })).toEqual({
        access: 'read',
        apps: ['a', 'b'],
      });
      expect(normalizeKeyScope({ access: 'write', apps: [] })).toEqual({ access: 'write' });
    });
  });

  describe('isAdminRoute', () => {
    it.each([
      ['GET', '/api/admin/users'],
      ['GET', '/api/admin/devices/123'],
      ['GET', '/api/admin'],
      ['GET', '/api/desktop/pairing-keys'],
      ['POST', '/api/desktop/pairing-keys'],
      ['POST', '/api/desktop/pairing-keys/abc/revoke'],
      ['POST', '/api/desktop/pairing'],
      ['GET', '/api/roles'],
      ['PATCH', '/api/roles/x'],
      ['POST', '/api/users'],
      ['PATCH', '/api/users/1'],
      ['DELETE', '/api/users/1'],
      ['PUT', '/api/users/1'],
      // обходы через регистр, двойные слэши, кодирование, хвостовой слэш
      ['GET', '/API/Admin/users'],
      ['GET', '/api//admin/users'],
      ['GET', '/api/%61dmin/users'],
      ['GET', '/api/roles/'],
      ['GET', '/api/admin/users?x=1'],
    ])('%s %s — админ', (m, u) => {
      expect(isAdminRoute(m, u)).toBe(true);
    });

    it.each([
      ['GET', '/api/users'],
      ['GET', '/api/users/1'],
      ['GET', '/api/materials'],
      ['POST', '/api/materials'],
      ['GET', '/api/desktop/compat'],
      ['GET', '/api/administrators'],
      ['GET', '/api/rolesx'],
      ['GET', '/api/auth/me'],
    ])('%s %s — не админ', (m, u) => {
      expect(isAdminRoute(m, u)).toBe(false);
    });
  });

  describe('keyScopeViolation', () => {
    it('нет scope или full → всё можно', () => {
      expect(keyScopeViolation(undefined, 'POST', '/api/admin/users')).toBeNull();
      expect(keyScopeViolation({ access: 'full' }, 'DELETE', '/api/roles/1')).toBeNull();
    });
    it('read: только GET/HEAD/OPTIONS', () => {
      const s = { access: 'read' as const };
      expect(keyScopeViolation(s, 'GET', '/api/materials')).toBeNull();
      expect(keyScopeViolation(s, 'head', '/api/materials')).toBeNull();
      expect(keyScopeViolation(s, 'OPTIONS', '/api/materials')).toBeNull();
      expect(keyScopeViolation(s, 'POST', '/api/materials')).toMatch(/только для чтения/);
      expect(keyScopeViolation(s, 'PATCH', '/api/materials/1')).toMatch(/только для чтения/);
      expect(keyScopeViolation(s, 'DELETE', '/api/materials/1')).toMatch(/только для чтения/);
      expect(keyScopeViolation(s, 'GET', '/api/admin/users')).toMatch(/администрированию/);
    });
    it('write: запись можно, админку нельзя', () => {
      const s = { access: 'write' as const, apps: ['inv'] };
      expect(keyScopeViolation(s, 'POST', '/api/materials')).toBeNull();
      expect(keyScopeViolation(s, 'DELETE', '/api/materials/1')).toBeNull();
      expect(keyScopeViolation(s, 'GET', '/api/users')).toBeNull();
      expect(keyScopeViolation(s, 'POST', '/api/users')).toMatch(/администрированию/);
      expect(keyScopeViolation(s, 'POST', '/api/desktop/pairing-keys')).toMatch(/администрированию/);
      expect(keyScopeViolation(s, 'GET', '/api/admin/devices')).toMatch(/администрированию/);
    });
  });

  describe('JwtAuthGuard: принуждение scope для kppd_-ключа', () => {
    let seq = 0;
    function setup(keyScope: unknown) {
      seq += 1;
      // уникальный id — обходим общий кеш активности пользователей
      const userId = `65a0000000000000000000${String(seq).padStart(2, '0')}`;
      const reflector = { getAllAndOverride: () => false } as unknown as Reflector;
      const lean = (v: unknown) => ({ lean: () => ({ exec: async () => v }) });
      const userModel = { findById: () => lean({ _id: userId, isActive: true, role: 'admin' }) };
      const roleModel = { findOne: () => lean({ name: 'admin', isActive: true }) };
      const pairingKeys = {
        authenticateBearer: jest.fn(async () => ({
          id: userId,
          username: 'admin',
          role: 'admin',
          keyScope,
        })),
      };
      const guard = new JwtAuthGuard(
        reflector,
        userModel as never,
        roleModel as never,
        pairingKeys as never,
      );
      const ctx = (method: string, url: string, headers: Record<string, string>) =>
        ({
          getHandler: () => undefined,
          getClass: () => undefined,
          switchToHttp: () => ({
            getRequest: () => ({ method, originalUrl: url, url, headers }),
          }),
        }) as unknown as ExecutionContext;
      return { guard, ctx };
    }
    const bearer = { authorization: 'Bearer kppd_test' };

    it('read-ключ: GET пропускает, POST → 403', async () => {
      const { guard, ctx } = setup({ access: 'read' });
      await expect(guard.canActivate(ctx('GET', '/api/materials', bearer))).resolves.toBe(true);
      await expect(guard.canActivate(ctx('POST', '/api/materials', bearer))).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('write-ключ через X-Access-Token: админка → 403', async () => {
      const { guard, ctx } = setup({ access: 'write' });
      await expect(
        guard.canActivate(ctx('POST', '/api/materials', { 'x-access-token': 'kppd_t' })),
      ).resolves.toBe(true);
      await expect(
        guard.canActivate(ctx('GET', '/api/admin/users', { 'x-access-token': 'kppd_t' })),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('full-ключ (старый, без scope) — как раньше', async () => {
      const { guard, ctx } = setup({ access: 'full' });
      await expect(guard.canActivate(ctx('DELETE', '/api/admin/users/1', bearer))).resolves.toBe(
        true,
      );
    });
  });
});
