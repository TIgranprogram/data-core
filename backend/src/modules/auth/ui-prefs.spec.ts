import { BadRequestException, ExecutionContext, ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { APP_SECTION_KEY } from '../../common/decorators/app-section.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { setCustomRoleBase } from '../../common/roles-hierarchy';
import { LoginSoftlockService } from '../../common/login-softlock/login-softlock.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UiPrefsDto } from './dto/ui-prefs.dto';
import { UserService } from '../user/user.service';
import type { UiPrefs } from '../user/user.schema';

/**
 * ШП-1 — PATCH /api/auth/me/prefs: проверка тела, запрет kppd_-ключа,
 * запись по отдельным ключам, uiPrefs в профиле, доступ для любой роли.
 */

/** Тот же ValidationPipe, что в main.ts (без exceptionFactory — нам важен только 400). */
const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: UiPrefsDto });

describe('UiPrefsDto (ШП-1)', () => {
  it('lastChat: all или id пользователя — проходит; прочее — 400', async () => {
    await expect(validate({ lastChat: 'all' })).resolves.toBeDefined();
    await expect(validate({ lastChat: 'a'.repeat(24) })).resolves.toBeDefined();
    await expect(validate({ lastChat: 'xyz' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validate({ lastChat: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });
  it('границы включительно — проходят', async () => {
    await expect(validate({ sidebarW: 200, detailW: 360, filterW: 280 })).resolves.toBeDefined();
    await expect(validate({ sidebarW: 360, detailW: 1100, filterW: 700 })).resolves.toBeDefined();
    await expect(validate({})).resolves.toBeDefined();
  });

  it.each([
    [{ detailW: 5000 }],
    [{ detailW: 359 }],
    [{ sidebarW: 199 }],
    [{ sidebarW: 361 }],
    [{ filterW: 239 }],
    [{ filterW: 701 }],
    [{ detailW: 700.5 }],
    [{ detailW: '700' }],
    [{ foo: 1 }],
    [{ detailW: 700, theme: 'dark' }],
  ])('%j → 400', async (body) => {
    await expect(validate(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('AuthController.updatePrefs (ШП-1)', () => {
  const make = () => {
    const auth = { updateUiPrefs: jest.fn().mockResolvedValue({ uiPrefs: { detailW: 700 } }) };
    const ctrl = new AuthController(auth as unknown as AuthService, {} as UserService);
    return { ctrl, auth };
  };

  it('вход по kppd_-ключу (есть keyScope) → 403, ничего не пишет', async () => {
    const { ctrl, auth } = make();
    const me = { id: 'u1', username: 'k', role: 'admin', keyScope: { access: 'full' as const } };
    await expect(ctrl.updatePrefs(me, { detailW: 700 })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(ctrl.updatePrefs(me, { detailW: 700 })).rejects.toThrow(
      'Настройки интерфейса меняются только из входа в приложение',
    );
    expect(auth.updateUiPrefs).not.toHaveBeenCalled();
  });

  it('JWT-вход → пишет по id из входа, ответ { uiPrefs }', async () => {
    const { ctrl, auth } = make();
    const res = await ctrl.updatePrefs({ id: 'u1', username: 'a', role: 'user' }, { detailW: 700 });
    expect(auth.updateUiPrefs).toHaveBeenCalledWith('u1', { detailW: 700 });
    expect(res).toEqual({ uiPrefs: { detailW: 700 } });
  });

  it('маршрут без @AppSection — AppSectionGuard его не ограничивает', () => {
    const r = new Reflector();
    const h = AuthController.prototype.updatePrefs;
    expect(r.getAllAndOverride(APP_SECTION_KEY, [h, AuthController])).toBeUndefined();
  });

  it('RolesGuard пускает все встроенные роли и свою роль r-…', () => {
    setCustomRoleBase('r-uiprefs-test', 'user');
    const reflector = new Reflector();
    const roles = reflector.get<string[]>(ROLES_KEY, AuthController.prototype.updatePrefs);
    expect(roles).toEqual(['admin', 'manager', 'user']);
    const guard = new RolesGuard({ getAllAndOverride: () => roles } as unknown as Reflector);
    const ctx = (role: string) =>
      ({
        getHandler: () => null,
        getClass: () => null,
        switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u', role } }) }),
      }) as unknown as ExecutionContext;
    for (const role of ['admin', 'director', 'accountant', 'manager', 'user', 'r-uiprefs-test']) {
      expect(guard.canActivate(ctx(role))).toBe(true);
    }
    setCustomRoleBase('r-uiprefs-test', null);
  });
});

/** Модель-подделка: применяет $set с точечными путями так же, как Mongo. */
function fakeUserModel(initial: Record<string, unknown>) {
  const doc: Record<string, unknown> = { _id: 'u1', ...initial };
  const updates: Array<Record<string, unknown>> = [];
  const chain = () => ({
    select: () => ({ lean: () => ({ exec: async () => JSON.parse(JSON.stringify(doc)) }) }),
  });
  return {
    doc,
    updates,
    findOneAndUpdate: (_f: unknown, update: { $set?: Record<string, unknown>; $unset?: Record<string, unknown> }) => {
      updates.push(update);
      for (const [path, v] of Object.entries(update.$set ?? {})) {
        const [head, key] = path.split('.');
        const sub = (doc[head] as Record<string, unknown> | undefined) ?? {};
        sub[key] = v;
        doc[head] = sub;
      }
      for (const path of Object.keys(update.$unset ?? {})) {
        const [head, key] = path.split('.');
        delete ((doc[head] as Record<string, unknown> | undefined) ?? {})[key];
      }
      return chain();
    },
    findById: () => chain(),
  };
}

describe('UserService.setUiPrefs (ШП-1)', () => {
  const svcWith = (model: ReturnType<typeof fakeUserModel>) =>
    new UserService(model as never);

  it('пишет $set по отдельным ключам uiPrefs.<ключ>, не целым объектом', async () => {
    const model = fakeUserModel({});
    await svcWith(model).setUiPrefs('u1', { detailW: 700 });
    expect(model.updates).toEqual([{ $set: { 'uiPrefs.detailW': 700 } }]);
  });

  it('частичная запись не стирает другие ключи', async () => {
    const model = fakeUserModel({});
    const svc = svcWith(model);
    expect(await svc.setUiPrefs('u1', { detailW: 700 })).toEqual({ detailW: 700 });
    expect(await svc.setUiPrefs('u1', { sidebarW: 300 })).toEqual({ detailW: 700, sidebarW: 300 });
  });

  it('null — сброс ключа ($unset), другие ключи остаются', async () => {
    const model = fakeUserModel({ uiPrefs: { detailW: 700, sidebarW: 300 } });
    expect(await svcWith(model).setUiPrefs('u1', { detailW: null })).toEqual({ sidebarW: 300 });
    expect(model.updates).toEqual([{ $unset: { 'uiPrefs.detailW': '' } }]);
  });

  it('пустое тело — без записи, отдаёт текущие (нет поля → {})', async () => {
    const model = fakeUserModel({});
    expect(await svcWith(model).setUiPrefs('u1', {})).toEqual({});
    expect(model.updates).toHaveLength(0);
  });
});

describe('AuthService: uiPrefs в профиле (ШП-1)', () => {
  const make = (user: Record<string, unknown>) => {
    const users = {
      findById: async () => ({
        id: 'u1', username: 'a', email: '', displayName: 'A', role: 'user',
        permissions: [], isActive: true, refreshTokenVersion: 0, ...user,
      }),
      setUiPrefs: jest.fn(async (_id: string, p: UiPrefs) => p),
    };
    const softlock = new LoginSoftlockService();
    softlock.__resetForTests();
    const svc = new AuthService(
      users as unknown as UserService,
      { signAsync: async () => 't' } as unknown as JwtService,
      { get: () => undefined } as unknown as ConfigService,
      softlock,
      { resolveForAuth: async () => null } as never,
    );
    return { svc, users };
  };

  it('старая запись без uiPrefs → /auth/me отдаёт {}', async () => {
    expect((await make({}).svc.getMe('u1')).uiPrefs).toEqual({});
  });

  it('сохранённые uiPrefs попадают в /auth/me', async () => {
    const me = await make({ uiPrefs: { detailW: 700 } }).svc.getMe('u1');
    expect(me.uiPrefs).toEqual({ detailW: 700 });
  });

  it('неактивный пользователь не пишет', async () => {
    const { svc, users } = make({ isActive: false });
    await expect(svc.updateUiPrefs('u1', { detailW: 700 })).rejects.toThrow();
    expect(users.setUiPrefs).not.toHaveBeenCalled();
  });
});
