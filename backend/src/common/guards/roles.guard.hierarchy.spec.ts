import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

/** RolesGuard: иерархия ролей и формулировка 403 (дополняет roles.guard.spec.ts). */
function ctx(user: Record<string, unknown> | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => () => undefined,
    getClass: () => class Fake {},
  } as unknown as ExecutionContext;
}

function guard(required: string[] | undefined): RolesGuard {
  return new RolesGuard({
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector);
}

describe('RolesGuard — иерархия и 403', () => {
  it('пустой список @Roles() не ограничивает доступ', () => {
    expect(guard([]).canActivate(ctx({ role: 'user' }))).toBe(true);
  });

  it('@Roles("admin","manager"): user получает 403', () => {
    expect(() => guard(['admin', 'manager']).canActivate(ctx({ role: 'user' }))).toThrow(
      ForbiddenException,
    );
  });

  it.each(['admin', 'manager', 'director', 'accountant'])(
    '@Roles("manager"): роль %s проходит (старшие включают менеджера)',
    (role) => {
      expect(guard(['manager']).canActivate(ctx({ role }))).toBe(true);
    },
  );

  it('@Roles("director"): менеджер и бухгалтер получают 403', () => {
    expect(() => guard(['director']).canActivate(ctx({ role: 'manager' }))).toThrow(
      ForbiddenException,
    );
    expect(() => guard(['director']).canActivate(ctx({ role: 'accountant' }))).toThrow(
      ForbiddenException,
    );
  });

  it('@Roles("admin"): director получает 403 (admin выше директора)', () => {
    expect(() => guard(['admin']).canActivate(ctx({ role: 'director' }))).toThrow(
      ForbiddenException,
    );
  });

  it('@Roles("accountant"): директор проходит, менеджер нет', () => {
    expect(guard(['accountant']).canActivate(ctx({ role: 'director' }))).toBe(true);
    expect(() => guard(['accountant']).canActivate(ctx({ role: 'manager' }))).toThrow(
      ForbiddenException,
    );
  });

  it('без пользователя -> 403 с "got: none"', () => {
    expect(() => guard(['admin']).canActivate(ctx(undefined))).toThrow(/got: none/);
  });

  it('пользователь без роли -> 403', () => {
    expect(() => guard(['user']).canActivate(ctx({}))).toThrow(ForbiddenException);
  });

  it('неизвестная роль не проходит на защищённый маршрут', () => {
    expect(() => guard(['user']).canActivate(ctx({ role: 'guest' }))).toThrow(
      ForbiddenException,
    );
  });

  it('сообщение 403 перечисляет требуемые роли и фактическую', () => {
    expect(() => guard(['admin', 'manager']).canActivate(ctx({ role: 'user' }))).toThrow(
      'Required role: admin | manager, got: user',
    );
  });

  it('владелец проходит даже при пустой роли', () => {
    expect(guard(['admin']).canActivate(ctx({ isOwner: true }))).toBe(true);
  });
});
