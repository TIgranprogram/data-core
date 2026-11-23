import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { LoginSoftlockService } from '../../common/login-softlock/login-softlock.service';
import { setCustomRoleBases, setRoleMoneyAll } from '../../common/roles-hierarchy';
import { setRoleSectionsAll } from '../../common/app-sections';
import { setRoleStockScopeAll } from '../../common/stock-scope';
import { RoleService } from '../role/role.service';
import { UserService } from '../user/user.service';
import { AuthService } from './auth.service';

function fixture(roleName: string, configured: Record<string, unknown> = {}) {
  const user = {
    id: 'c240-user', username: 'director', email: '', displayName: 'Директор', role: roleName,
    permissions: ['own.read'], isOwner: false, isActive: true, refreshTokenVersion: 0,
    save: jest.fn(async () => undefined),
  };
  const role = { name: roleName, label: 'Директор склада', permissions: ['role.read'], ...configured };
  const docs = { [roleName]: role, director: roleName === 'director' ? role : { name: 'director', permissions: ['role.read'] } };
  const roles = {
    findByName: jest.fn(async (name: string) => docs[name] ?? null),
    resolveForAuth(name: string) { return RoleService.prototype.resolveForAuth.call(this as never, name); },
  };
  const users = {
    findById: jest.fn(async () => user), findByUsername: jest.fn(async () => user),
    verifyPassword: jest.fn(async () => true),
  };
  const softlock = new LoginSoftlockService();
  softlock.__resetForTests();
  const service = new AuthService(users as unknown as UserService,
    { signAsync: async () => 'test-token' } as unknown as JwtService,
    { get: () => undefined } as unknown as ConfigService, softlock, roles as unknown as RoleService);
  return { service, role, user };
}

describe('C240 — свежая проекция дополнительных экранов в login.user и /auth/me', () => {
  afterEach(() => { setCustomRoleBases([]); setRoleSectionsAll([]); setRoleMoneyAll([]); setRoleStockScopeAll([]); });
  it.each(['director', 'r-director'])('унаследованный директор %s получает оба экрана в обоих ответах', async name => {
    const { service } = fixture(name, name === 'director' ? {} : { baseRole: 'director' });
    const me = await service.getMe('c240-user');
    const logged = await service.login({ username: 'director', password: 'test-password' }, { cookie: jest.fn() } as never);
    expect(me.stockViews).toEqual(['pipe', 'sheet']);
    expect(logged.user.stockViews).toEqual(me.stockViews);
    expect(logged.user.baseRole).toBe('director');
    expect(logged.user.permissions.sort()).toEqual(['own.read', 'role.read']);
  });
  it('повторный /me применяет только изменение экранов, не меняет деньги/sections/permissions и складские ограничения', async () => {
    const warehouse = '111111111111111111111111';
    const { service, role } = fixture('r-director', {
      baseRole: 'director', appSections: ['stock'], warehouseIds: [warehouse], stockCategoryIds: [warehouse], money: false,
    });
    const before = await service.getMe('c240-user');
    Object.assign(role, { stockViews: [] });
    const after = await service.getMe('c240-user');
    const { stockViews: beforeViews, ...beforeFields } = before;
    const { stockViews: afterViews, ...afterFields } = after;
    expect(beforeViews).toEqual(['pipe', 'sheet']);
    expect(afterViews).toEqual([]);
    expect(afterFields).toEqual(beforeFields);
    expect(role).toMatchObject({ warehouseIds: [warehouse], stockCategoryIds: [warehouse], money: false });
  });
  it.each(['user', 'manager', 'accountant'])('роль %s по умолчанию не получает новых экранов', async name => {
    expect((await fixture(name).service.getMe('c240-user')).stockViews).toEqual([]);
  });
  it('явный список и отсутствие stock в разделах передаются независимо, не расширяя разделы', async () => {
    const { service } = fixture('r-director', { baseRole: 'director', stockViews: ['sheet'], appSections: ['requests'] });
    expect(await service.getMe('c240-user')).toMatchObject({ stockViews: ['sheet'], sections: ['requests'] });
  });
});
