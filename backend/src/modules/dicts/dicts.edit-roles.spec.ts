import { ForbiddenException } from '@nestjs/common';
import { DictsService } from './dicts.service';

/** Правка справочников «Паспорта» — директор и админ; остальные справочники — как раньше (БЗ-6 Э2a). */
describe('справочники: кто правит (editRoles)', () => {
  const svc = Object.create(DictsService.prototype) as DictsService;
  it('«Паспорта»: менеджеру и бухгалтеру — 403, директору, админу и владельцу — можно', () => {
    for (const role of ['manager', 'accountant', 'user']) expect(() => svc.assertCanEdit('passportCategories', { role })).toThrow(ForbiddenException);
    for (const role of ['director', 'admin']) expect(() => svc.assertCanEdit('passportStandards', { role })).not.toThrow();
    expect(() => svc.assertCanEdit('passportCategories', { role: 'manager', isOwner: true })).not.toThrow();
  });
  it('остальные справочники не ограничены (роль проверяет @Roles контроллера)', () => {
    expect(() => svc.assertCanEdit('units', { role: 'manager' })).not.toThrow();
  });
});
