/**
 * C049-4 — страж прав: у каждого маршрута объявлено, кому он открыт.
 *
 * Глобальный JwtAuthGuard пускает любого вошедшего. Если у маршрута нет ни
 * `@Public`, ни `@Roles`, ни `@Permissions`, ни `@AppSection`, ни своего guard'а
 * (`@UseGuards`), — его видит любой сотрудник и любой ключ `kppd_`.
 * Такой маршрут допустим только осознанно — в белом списке ниже, с причиной.
 */
import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from './decorators/public.decorator';
import { ROLES_KEY } from './decorators/roles.decorator';
import { PERMISSIONS_KEY } from './decorators/permissions.decorator';
import { APP_SECTION_KEY } from './decorators/app-section.decorator';

const SRC = join(__dirname, '..');

/** «Любой вошедший» — осознанно. Ключ: `файл#метод`, значение — причина. */
const OPEN_TO_ANY_USER: Record<string, string> = {
  'modules/meta/meta.controller.ts#guide': 'описание API для подключения — любому вошедшему (C068)',
  'modules/meta/meta.controller.ts#openapi': 'контракт API — любому вошедшему (C068)',
  'modules/meta/meta.controller.ts#schema': 'схема таблиц — любому вошедшему (C068)',
  'modules/auth/auth.controller.ts#me': 'свой профиль',
  'modules/user/user.controller.ts#findOne': 'проверка внутри: себя или admin, иначе 403',
  'modules/attribute-definition/attribute-definition.controller.ts#findAll': 'справочник признаков, только чтение',
  'modules/attribute-definition/attribute-definition.controller.ts#findOne': 'справочник признаков, только чтение',
  'modules/entity-attribute-value/entity-attribute-value.controller.ts#getAttributes': 'значения признаков, только чтение; тип сущности проверяется',
};

function controllerFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...controllerFiles(p));
    else if (name.endsWith('.controller.ts')) out.push(p);
  }
  return out;
}

function declared(target: object): boolean {
  const roles = Reflect.getMetadata(ROLES_KEY, target) as string[] | undefined;
  const perms = Reflect.getMetadata(PERMISSIONS_KEY, target) as string[] | undefined;
  const guards = Reflect.getMetadata(GUARDS_METADATA, target) as unknown[] | undefined;
  return (
    Reflect.getMetadata(IS_PUBLIC_KEY, target) === true ||
    (Array.isArray(roles) && roles.length > 0) ||
    (Array.isArray(perms) && perms.length > 0) ||
    Reflect.getMetadata(APP_SECTION_KEY, target) !== undefined ||
    (Array.isArray(guards) && guards.length > 0)
  );
}

function openRoutes(): string[] {
  const open: string[] = [];
  for (const file of controllerFiles(SRC)) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require(file) as Record<string, unknown>;
    for (const exp of Object.values(mod)) {
      if (typeof exp !== 'function' || Reflect.getMetadata(PATH_METADATA, exp) === undefined) continue;
      const cls = exp as { prototype: Record<string, unknown> };
      const classOk = declared(cls);
      for (const key of Object.getOwnPropertyNames(cls.prototype)) {
        if (key === 'constructor') continue;
        const handler = cls.prototype[key];
        if (typeof handler !== 'function' || Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        if (classOk || declared(handler)) continue;
        open.push(`${relative(SRC, file).replace(/\\/g, '/')}#${key}`);
      }
    }
  }
  return open.sort();
}

describe('C049-4: у каждого маршрута объявлен доступ', () => {
  const open = openRoutes();

  it('нет маршрутов «любому вошедшему» вне белого списка', () => {
    expect(open.filter((r) => !(r in OPEN_TO_ANY_USER))).toEqual([]);
  });

  it('белый список не устарел (каждая запись — живой открытый маршрут)', () => {
    expect(Object.keys(OPEN_TO_ANY_USER).filter((r) => !open.includes(r))).toEqual([]);
  });
});
