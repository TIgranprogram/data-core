import { narrowCategories, setRoleStockScope, setRoleStockScopeAll, stockScopeFor } from './stock-scope';

describe('Склад по роли (СМ.4)', () => {
  beforeEach(() => setRoleStockScopeAll([{ name: 'r-pipe', stockCategoryIds: ['a', 'b'] }, { name: 'r-all', stockCategoryIds: [] }]));
  afterAll(() => setRoleStockScopeAll([]));

  it('роль с категориями видит только их', () => expect(stockScopeFor({ role: 'r-pipe' })).toEqual(['a', 'b']));
  it('без категорий, владелец, admin, нет пользователя — весь склад', () => {
    expect(stockScopeFor({ role: 'r-all' })).toBeNull();
    expect(stockScopeFor({ role: 'r-pipe', isOwner: true })).toBeNull();
    expect(stockScopeFor({ role: 'admin' })).toBeNull();
    expect(stockScopeFor(undefined)).toBeNull();
  });
  it('admin не ограничивается даже с категориями', () => {
    setRoleStockScope('admin', ['a']);
    expect(stockScopeFor({ role: 'admin' })).toBeNull();
  });
  it('снятие категорий убирает ограничение', () => {
    setRoleStockScope('r-pipe', []);
    expect(stockScopeFor({ role: 'r-pipe' })).toBeNull();
  });
  it('чужая категория в фильтре отбрасывается', () => {
    expect(narrowCategories('a', ['a', 'b'])).toBe('a');
    expect(narrowCategories('a,x', ['a', 'b'])).toBe('a');
    expect(narrowCategories('x', ['a', 'b'])).toBe('a,b');
    expect(narrowCategories(undefined, ['a', 'b'])).toBe('a,b');
  });
});
