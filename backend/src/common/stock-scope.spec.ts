import { Types } from 'mongoose';
import { inScope, narrowCategories, narrowToZone, scopeMatch, scopeOfZones, setCategoryTree, setRoleStockScope, setRoleStockScopeAll, setStockZones, stockScopeFor, zonesFor } from './stock-scope';

const id = () => String(new Types.ObjectId());
const [root, kid, grandKid, other, pipe, m1, m2, m3] = Array.from({ length: 8 }, id);
const [zMain, zPipe] = [id(), id()];

describe('Склады-зоны: доступ (WZ)', () => {
  beforeEach(() => {
    setCategoryTree([{ id: root }, { id: kid, parentId: root }, { id: grandKid, parentId: kid }, { id: other }, { id: pipe }]);
    setStockZones([
      { id: zMain, name: 'Основной', categoryIds: [root, other], excludeIds: [m3], isDefault: true },
      { id: zPipe, name: 'Профильная труба', categoryIds: [pipe], includeIds: [m3] },
    ]);
    setRoleStockScopeAll([{ name: 'r-main', warehouseIds: [zMain] }, { name: 'r-both', warehouseIds: [zMain, zPipe] }, { name: 'r-old', stockCategoryIds: [root] }, { name: 'r-all' }]);
  });
  afterAll(() => { setRoleStockScopeAll([]); setStockZones([]); setCategoryTree([]); });

  it('роль со складом: категории с потомками; без склада, владелец, admin, нет пользователя — весь склад', () => {
    expect([...stockScopeFor({ role: 'r-main' })!.categoryIds].sort()).toEqual([root, kid, grandKid, other].sort());
    expect(stockScopeFor({ role: 'r-all' })).toBeNull();
    expect(stockScopeFor({ role: 'r-main', isOwner: true })).toBeNull();
    expect(stockScopeFor({ role: 'admin' })).toBeNull();
    expect(stockScopeFor(undefined)).toBeNull();
  });

  it('admin не ограничивается даже с настройкой', () => {
    setRoleStockScope('admin', { warehouseIds: [zMain] });
    expect(stockScopeFor({ role: 'admin' })).toBeNull();
  });

  it('inScope: своя категория, подкатегория, чужая, без категории', () => {
    const s = stockScopeFor({ role: 'r-main' });
    expect(inScope(s, { id: m1, categoryId: grandKid })).toBe(true);
    expect(inScope(s, { id: m1, categoryId: pipe })).toBe(false);
    expect(inScope(s, { id: m1, categoryId: null })).toBe(true); // «Основной» — isDefault
    expect(inScope(stockScopeFor({ role: 'r-old' }), { id: m1, categoryId: null })).toBe(false); // запасной путь: без категории — нет
    expect(inScope(null, { id: m1, categoryId: pipe })).toBe(true);
  });

  it('исключение поштучно убирает позицию, добавка — приносит; склад другой зоны возвращает её', () => {
    const main = stockScopeFor({ role: 'r-main' });
    expect(inScope(main, { id: m3, categoryId: kid })).toBe(false); // исключена из «Основного»
    expect(inScope(main, { id: m1, categoryId: kid })).toBe(true);
    const both = stockScopeFor({ role: 'r-both' });
    expect(inScope(both, { id: m3, categoryId: kid })).toBe(true); // добавлена в «Трубу»
    expect(inScope(stockScopeFor({ role: 'r-old' }), { id: m3, categoryId: kid })).toBe(true); // старый путь исключений не знает
  });

  it('склад удалён из справочника — роль не видит ничего (а не весь склад)', () => {
    setStockZones([]);
    const s = stockScopeFor({ role: 'r-main' })!;
    expect(s.zones).toHaveLength(0);
    expect(inScope(s, { id: m1, categoryId: kid })).toBe(false);
    expect(scopeMatch(s)).toEqual({ _id: { $in: [] } });
  });

  it('снятие складов у роли убирает ограничение', () => {
    setRoleStockScope('r-main', { warehouseIds: [] });
    expect(stockScopeFor({ role: 'r-main' })).toBeNull();
  });

  it('scopeMatch: без ограничения пусто; по складу — категории обоих видов id, добавки, исключения, «без категории»', () => {
    expect(scopeMatch(null)).toEqual({});
    const q = scopeMatch(stockScopeFor({ role: 'r-main' })) as { $and: Array<Record<string, unknown>> };
    const own = q.$and[0] as { $or: Array<Record<string, unknown>> };
    const cats = (own.$or[0].categoryId as { $in: unknown[] }).$in;
    expect(cats).toHaveLength(8); // 4 категории × (ObjectId + строка)
    expect(own.$or).toContainEqual({ categoryId: null });
    expect(q.$and[1]).toEqual({ _id: { $nin: [new Types.ObjectId(m3)] } });
    const two = scopeMatch(stockScopeFor({ role: 'r-both' })) as { $or: unknown[] };
    expect(two.$or).toHaveLength(2);
  });

  it('zonesFor: склады роли для переключателя; без склада — null', () => {
    expect(zonesFor({ role: 'r-both' })!.map((z) => z.name)).toEqual(['Основной', 'Профильная труба']);
    expect(zonesFor({ role: 'r-all' })).toBeNull();
    expect(zonesFor({ role: 'r-old' })).toEqual([]);
  });

  it('narrowToZone: свой склад сужает, чужой — 403, admin — любой, пусто — как есть', () => {
    const both = stockScopeFor({ role: 'r-both' });
    expect(narrowToZone(both, undefined)).toBe(both);
    const one = narrowToZone(both, zPipe)!;
    expect(one.zones.map((z) => z.id)).toEqual([zPipe]);
    expect(inScope(one, { id: m1, categoryId: root })).toBe(false);
    expect(() => narrowToZone(stockScopeFor({ role: 'r-main' }), zPipe)).toThrow('недоступен');
    expect(inScope(narrowToZone(null, zPipe), { id: m2, categoryId: pipe })).toBe(true);
    expect(() => narrowToZone(null, id())).toThrow('нет');
  });

  it('чужая категория в фильтре отбрасывается', () => {
    const s = scopeOfZones([{ id: 'x', categoryIds: [other] }]);
    expect(narrowCategories(other, s)).toBe(other);
    expect(narrowCategories(`${other},${pipe}`, s)).toBe(other);
    expect(narrowCategories(pipe, s)).toBe(other);
    expect(narrowCategories(undefined, s)).toBe(other);
  });
});
