import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppSectionGuard } from './app-section.guard';
import { APP_SECTION_KEY } from '../decorators/app-section.decorator';
import { openSectionsFor, setRoleSections, setRoleSectionsAll } from '../app-sections';

/** SK-8d: AppSectionGuard — раздел закрыт для роли → 403 по-русски. */
function ctx(user: unknown, handlerMeta?: string[], classMeta?: string[]) {
  const handler = () => undefined;
  class Ctl {}
  if (handlerMeta) Reflect.defineMetadata(APP_SECTION_KEY, handlerMeta, handler);
  if (classMeta) Reflect.defineMetadata(APP_SECTION_KEY, classMeta, Ctl);
  return {
    getHandler: () => handler,
    getClass: () => Ctl,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as never;
}

describe('AppSectionGuard', () => {
  const guard = new AppSectionGuard(new Reflector());
  beforeEach(() => setRoleSectionsAll([{ name: 'r-kl', appSections: ['stock', 'requests'] }]));
  afterAll(() => setRoleSectionsAll([]));

  it('без пометки — пропуск', () => {
    expect(guard.canActivate(ctx({ role: 'r-kl' }))).toBe(true);
  });

  it('открытый раздел — пропуск, закрытый — 403 с названием раздела', () => {
    expect(guard.canActivate(ctx({ role: 'r-kl' }, undefined, ['stock']))).toBe(true);
    expect(() => guard.canActivate(ctx({ role: 'r-kl' }, undefined, ['salesorders']))).toThrow(
      new ForbiddenException('Раздел «Заказы» для вашей роли закрыт'),
    );
  });

  it('несколько разделов — достаточно одного открытого', () => {
    expect(guard.canActivate(ctx({ role: 'r-kl' }, ['salesorders', 'stock']))).toBe(true);
  });

  it('метод переопределяет класс; @AppSectionFree ([]) снимает пометку', () => {
    expect(guard.canActivate(ctx({ role: 'r-kl' }, ['stock'], ['salesorders']))).toBe(true);
    expect(guard.canActivate(ctx({ role: 'r-kl' }, [], ['salesorders']))).toBe(true);
  });

  it('без ограничений: роль без галочек, admin, владелец, нет пользователя', () => {
    expect(guard.canActivate(ctx({ role: 'manager' }, ['salesorders']))).toBe(true);
    setRoleSections('admin', ['stock']);
    expect(guard.canActivate(ctx({ role: 'admin' }, ['salesorders']))).toBe(true);
    expect(guard.canActivate(ctx({ role: 'r-kl', isOwner: true }, ['salesorders']))).toBe(true);
    expect(guard.canActivate(ctx(undefined, ['salesorders']))).toBe(true);
  });

  it('раздел docs открывает маршруты passports; обратно passports docs не открывает', () => {
    setRoleSectionsAll([{ name: 'r-d', appSections: ['docs'] }, { name: 'r-p', appSections: ['passports'] }]);
    expect(guard.canActivate(ctx({ role: 'r-d' }, ['products', 'passports']))).toBe(true);
    expect(guard.canActivate(ctx({ role: 'r-d' }, undefined, ['passports']))).toBe(true);
    expect(() => guard.canActivate(ctx({ role: 'r-p' }, ['docs']))).toThrow(ForbiddenException);
  });

  it('GET /partners открыт разделам requests/stock/…, запись — только partners', () => {
    setRoleSectionsAll([{ name: 'r-s', appSections: ['stock'] }]);
    const read = ['partners', 'requests', 'suppliercatalog', 'salesorders', 'passports', 'stock'];
    expect(guard.canActivate(ctx({ role: 'r-s' }, read))).toBe(true);
    expect(() => guard.canActivate(ctx({ role: 'r-s' }, undefined, ['partners']))).toThrow(ForbiddenException);
  });

  it('«Сегодня» без пометки раздела — видно роли с любыми галочками', () => {
    setRoleSectionsAll([{ name: 'r-s', appSections: ['stock'] }]);
    expect(guard.canActivate(ctx({ role: 'r-s' }))).toBe(true);
  });

  it('кэш: неизвестные разделы отбрасываются, пусто = без ограничений', () => {
    setRoleSections('r-x', ['hack']);
    expect(openSectionsFor({ role: 'r-x' })).toBeNull();
    setRoleSections('r-x', ['design', 'hack']);
    expect([...(openSectionsFor({ role: 'r-x' }) ?? [])]).toEqual(['design']);
  });
});
