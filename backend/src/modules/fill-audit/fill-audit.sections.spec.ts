import { FillAuditService, onlyOpenGroups, type FillGroup } from './fill-audit.service';

/** Группа product-check: изделия с примечанием «⚠ Проверить…» (мок Mongo). */
describe('FillAuditService: product-check', () => {
  it('ищет изделия по префиксу «⚠ Проверить» в notes', async () => {
    const queries: Array<[string, Record<string, unknown>]> = [];
    const col = (name: string) => ({
      find: (q: Record<string, unknown>) => ({ sort: () => ({ limit: () => ({ toArray: async () => (name === 'products' ? [{ _id: 'p1', name: 'Горка', notes: '⚠ Проверить цену' }] : []) }) }), toArray: async () => [] }),
      countDocuments: async (q: Record<string, unknown>) => { queries.push([name, q]); return name === 'products' ? 1 : 0; },
      aggregate: () => ({ toArray: async () => [] }),
    });
    const svc = new FillAuditService({ db: { collection: col } } as never);
    const res = await svc.report({ role: 'admin', isOwner: true }, { only: 'product-check' });
    expect(res.groups).toHaveLength(1);
    expect(res.groups[0]).toMatchObject({ key: 'product-check', section: 'products', field: 'notes', count: 1 });
    expect(res.groups[0].items[0]).toMatchObject({ id: 'p1', title: 'Горка' });
    const q = queries.find(([n]) => n === 'products')![1];
    expect((q.notes as RegExp).test('⚠ Проверить цену')).toBe(true);
    expect((q.notes as RegExp).test('обычное')).toBe(false);
  });
});

/** SK-8d: «Требуют заполнения» — только группы открытых разделов, кэш (входной объект) не меняется. */
describe('onlyOpenGroups', () => {
  const g = (key: string, section: string, count: number) => ({ key, section, count, items: [] }) as unknown as FillGroup;
  const res = { total: 6, groups: [g('req-category', 'requests', 1), g('so-ship', 'salesorders', 2), g('mat-category', 'stock', 3)] };

  it('без ограничений — тот же ответ', () => {
    expect(onlyOpenGroups(res, null)).toBe(res);
  });

  it('кладовщик (stock+requests): без «Заказов», total пересчитан, исходник цел', () => {
    const r = onlyOpenGroups(res, new Set(['stock', 'requests']));
    expect(r.groups.map((x) => x.key)).toEqual(['req-category', 'mat-category']);
    expect(r.total).toBe(4);
    expect(res.groups).toHaveLength(3);
    expect(res.total).toBe(6);
  });

  it('only=<группа закрытого раздела> → пусто', () => {
    expect(onlyOpenGroups({ total: 2, groups: [g('so-ship', 'salesorders', 2)] }, new Set(['stock']))).toEqual({ total: 0, groups: [] });
  });
});
