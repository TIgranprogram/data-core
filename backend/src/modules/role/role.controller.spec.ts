import 'reflect-metadata';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RoleController } from './role.controller';

/** Правила доступа к /roles: кто получает 403 (метаданные @Roles + реальный RolesGuard). */
function metaOf(method: keyof RoleController): string[] | undefined {
  return Reflect.getMetadata(ROLES_KEY, RoleController.prototype[method]);
}

function run(method: keyof RoleController, role: string | undefined): boolean {
  const guard = new RolesGuard(new Reflector());
  const context = {
    switchToHttp: () => ({ getRequest: () => ({ user: role ? { role } : undefined }) }),
    getHandler: () => RoleController.prototype[method],
    getClass: () => RoleController,
  } as unknown as ExecutionContext;
  return guard.canActivate(context);
}

describe('RoleController — права доступа', () => {
  it('чтение (список, по id): admin и manager', () => {
    expect(metaOf('findAll')).toEqual(['admin', 'manager']);
    expect(metaOf('findOne')).toEqual(['admin', 'manager']);
  });

  it('запись (create/update/remove): только admin', () => {
    expect(metaOf('create')).toEqual(['admin']);
    expect(metaOf('update')).toEqual(['admin']);
    expect(metaOf('remove')).toEqual(['admin']);
  });

  it.each(['findAll', 'findOne'] as const)('%s: user получает 403', (m) => {
    expect(() => run(m, 'user')).toThrow(ForbiddenException);
  });

  it.each(['findAll', 'findOne'] as const)('%s: manager и admin проходят', (m) => {
    expect(run(m, 'manager')).toBe(true);
    expect(run(m, 'admin')).toBe(true);
  });

  it.each(['create', 'update', 'remove'] as const)(
    '%s: manager, director, accountant, user получают 403',
    (m) => {
      for (const role of ['manager', 'director', 'accountant', 'user']) {
        expect(() => run(m, role)).toThrow(ForbiddenException);
      }
    },
  );

  it.each(['create', 'update', 'remove'] as const)('%s: admin проходит', (m) => {
    expect(run(m, 'admin')).toBe(true);
  });

  it('без пользователя -> 403', () => {
    expect(() => run('findAll', undefined)).toThrow(ForbiddenException);
  });
});
