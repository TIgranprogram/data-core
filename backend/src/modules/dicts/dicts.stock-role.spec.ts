import { setRoleStockScopeAll } from '../../common/stock-scope';
import { DictsService } from './dicts.service';

describe('Справочники и роли склада', () => {
  const svc = Object.create(DictsService.prototype) as DictsService;
  beforeAll(() => setRoleStockScopeAll([{ name: 'r-pipe', stockCategoryIds: ['a'] }]));
  afterAll(() => setRoleStockScopeAll([]));

  it('роль склада не правит справочники, даже с правами менеджера', () => {
    expect(() => svc.assertCanEdit('colors', { role: 'r-pipe' })).toThrow('Справочники для вашей роли закрыты');
  });
});
