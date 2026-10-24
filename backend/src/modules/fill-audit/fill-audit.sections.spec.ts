import { onlyOpenGroups, type FillGroup } from './fill-audit.service';

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
