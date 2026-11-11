import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AppSectionGuard } from '../../common/guards/app-section.guard';
import { setRoleSectionsAll } from '../../common/app-sections';
import { ProductPassportController } from './product-passport.controller';
import { ShowcaseController } from '../showcase/showcase.controller';

const work = ['createForProduct', 'createReady', 'check', 'preview', 'orderPlan', 'orderIssue', 'orderPdf', 'pdf', 'draftAll', 'create', 'editSnapshotItem', 'snapshot', 'issue', 'copy', 'update', 'savePrintFile', 'removePrintFile', 'bulk', 'bulkRestore'];
const settings = ['saveTemplate', 'saveTexts', 'setNextNumber', 'promoteSnapshotItem'];
function ctx(controller: typeof ProductPassportController | typeof ShowcaseController, method: string, role: string): ExecutionContext {
  return { getHandler: () => (controller.prototype as unknown as Record<string, unknown>)[method], getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) } as ExecutionContext;
}
const roles = new RolesGuard(new Reflector());
const sections = new AppSectionGuard(new Reflector());
describe('C086: менеджер работает с паспортом, общие настройки защищены', () => {
  afterEach(() => setRoleSectionsAll([]));
  it.each(work)('%s: разрешён менеджеру, запрещён наблюдателю', (method) => {
    expect(roles.canActivate(ctx(ProductPassportController, method, 'manager'))).toBe(true);
    expect(() => roles.canActivate(ctx(ProductPassportController, method, 'user'))).toThrow(ForbiddenException);
  });
  it.each(settings)('%s: настройки не открыты менеджеру', (method) => {
    for (const role of ['manager', 'user']) expect(() => roles.canActivate(ctx(ProductPassportController, method, role))).toThrow(ForbiddenException);
    expect(roles.canActivate(ctx(ProductPassportController, method, 'director'))).toBe(true);
  });
  it('умолчания и собственные тексты изделия доступны менеджеру', () => {
    expect(roles.canActivate(ctx(ShowcaseController, 'setPassportDefaults', 'manager'))).toBe(true);
    expect(() => roles.canActivate(ctx(ShowcaseController, 'setPassportDefaults', 'user'))).toThrow(ForbiddenException);
  });
  it.each(['orderPlan', 'orderIssue', 'orderPdf', 'preview', 'create', 'update'])('%s: закрытый раздел сохраняет запрет', (method) => {
    setRoleSectionsAll([{ name: 'manager', appSections: ['stock'] }]);
    expect(() => sections.canActivate(ctx(ProductPassportController, method, 'manager'))).toThrow(ForbiddenException);
    setRoleSectionsAll([{ name: 'manager', appSections: ['passports'] }]);
    expect(sections.canActivate(ctx(ProductPassportController, method, 'manager'))).toBe(true);
  });
});
