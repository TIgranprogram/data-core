import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import { RolesGuard } from './guards/roles.guard';
import { MoneyMaskInterceptor } from './interceptors/money-mask.interceptor';
import {
  baseRoleOf,
  canSeeMoney,
  effectiveRoles,
  roleLabelOf,
  setCustomRoleBase,
  setCustomRoleBases,
} from './roles-hierarchy';

/** SK-8c: своя роль (`r-…`) получает права своей baseRole — через guard, деньги и иерархию. */
function ctx(user: Record<string, unknown>, body?: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user, body }) }),
    getHandler: () => () => undefined,
    getClass: () => class Fake {},
  } as unknown as ExecutionContext;
}
const guard = (required: string[]) =>
  new RolesGuard({ getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector);

describe('Свои роли (SK-8c)', () => {
  beforeEach(() =>
    setCustomRoleBases([
      { name: 'r-sklad1', baseRole: 'manager' },
      { name: 'r-obs001', baseRole: 'user' },
      { name: 'r-buh001', baseRole: 'accountant' },
      { name: 'r-bad001', baseRole: 'admin' },
    ]),
  );
  afterAll(() => setCustomRoleBases([]));

  it('baseRole=manager: проходит @Roles("admin","manager"), не проходит @Roles("director") и видит деньги, но не ФОТ', () => {
    expect(guard(['admin', 'manager']).canActivate(ctx({ role: 'r-sklad1' }))).toBe(true);
    expect(guard(['user']).canActivate(ctx({ role: 'r-sklad1' }))).toBe(true);
    expect(() => guard(['director']).canActivate(ctx({ role: 'r-sklad1' }))).toThrow(ForbiddenException);
    expect(() => guard(['admin']).canActivate(ctx({ role: 'r-sklad1' }))).toThrow(ForbiddenException);
    expect(canSeeMoney({ role: 'r-sklad1' })).toBe(true);
    expect(canSeeMoney({ role: 'r-obs001' })).toBe(false);
  });

  it('baseRole=accountant: видит деньги, проходит @Roles("manager")', () => {
    expect(canSeeMoney({ role: 'r-buh001' })).toBe(true);
    expect(guard(['manager']).canActivate(ctx({ role: 'r-buh001' }))).toBe(true);
  });

  it('MoneyMask: своей роли как у наблюдателя суммы в ответе и в запросе скрываются', async () => {
    const body = { amount: 5, note: 'x' };
    const out = await lastValueFrom(
      new MoneyMaskInterceptor().intercept(ctx({ role: 'r-obs001' }, body), { handle: () => of({ amount: 10, name: 'a' }) }) as never,
    );
    expect(out).toEqual({ name: 'a' });
    expect(body).toEqual({ note: 'x' });
  });

  it('baseRole=admin в кэш не попадает — роль без прав', () => {
    expect(effectiveRoles('r-bad001')).toEqual(['r-bad001']);
    expect(() => guard(['manager']).canActivate(ctx({ role: 'r-bad001' }))).toThrow(ForbiddenException);
  });

  it('встроенные роли не меняются и в кэш не попадают', () => {
    setCustomRoleBase('manager', 'director');
    expect(effectiveRoles('manager')).toEqual(['manager', 'user']);
    expect(baseRoleOf('director')).toBe('director');
    expect(effectiveRoles('admin')).toEqual(['admin', 'director', 'accountant', 'manager', 'user']);
  });

  it('незнакомая роль — как раньше: только она сама', () => {
    expect(baseRoleOf('r-nope00')).toBe('r-nope00');
    expect(effectiveRoles('r-nope00')).toEqual(['r-nope00']);
  });

  it('roleLabelOf: русское название как есть, английское из сида — по-русски', () => {
    expect(roleLabelOf('r-sklad1', 'Кладовщик')).toBe('Кладовщик');
    expect(roleLabelOf('manager', 'Manager')).toBe('Менеджер');
    expect(roleLabelOf('manager', 'Менеджер склада')).toBe('Менеджер склада');
  });
});
