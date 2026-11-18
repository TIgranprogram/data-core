import { setRoleStockScopeAll } from '../../common/stock-scope';
import { DictsService } from './dicts.service';
import { DictsController } from './dicts.controller';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';

describe('Справочники и роли склада', () => {
  const svc = Object.create(DictsService.prototype) as DictsService;
  beforeAll(() => setRoleStockScopeAll([{ name: 'r-pipe', stockCategoryIds: ['a'] }]));
  afterAll(() => setRoleStockScopeAll([]));

  it('роль склада не правит справочники, даже с правами менеджера', () => {
    expect(() => svc.assertCanEdit('colors', { role: 'r-pipe' })).toThrow('Справочники для вашей роли закрыты');
  });

  it('список сообщает интерфейсу запрет правки для складской роли', async () => {
    const result = { items: [], dict: { key: 'moduleCategories' } };
    const service = { list: jest.fn().mockResolvedValue(result) } as unknown as DictsService;
    const controller = new DictsController(service);
    const user = { role: 'r-pipe' } as AuthenticatedUser;
    expect(await controller.list('moduleCategories', undefined, user)).toMatchObject({ dict: { readOnly: true } });
    expect(await controller.list('moduleCategories', undefined, { role: 'admin' } as AuthenticatedUser)).toBe(result);
  });
});
