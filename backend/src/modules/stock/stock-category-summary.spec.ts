import { StockSearchService } from './stock-search.service';

describe('StockSearchService.categorySummary', () => {
  it('считает по строкам из кэша версий, без listItems', async () => {
    const rows = [
      { categoryId: 'a', categoryName: 'Лист', status: 'ok', ordered: 0 },
      { categoryId: 'a', categoryName: 'Лист', status: 'low', ordered: 2 },
      { categoryId: null, categoryName: null, status: 'none', ordered: 0 },
    ];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc: any = Object.create(StockSearchService.prototype);
    svc['versions'] = { cached: jest.fn(async (_n: string, _c: unknown, _k: string, make: () => unknown) => make()) };
    svc['itemRows'] = jest.fn(async () => ({ wh: {}, rows }));
    svc['listItems'] = jest.fn();
    const r = await svc.categorySummary();
    expect(svc['listItems']).not.toHaveBeenCalled();
    expect(r.total).toBe(3);
    expect(r.items[0]).toEqual({ id: 'a', name: 'Лист', total: 2, low: 1, none: 0, ordered: 1 });
    expect(r.items[1]).toMatchObject({ id: 'none', name: 'Без категории', none: 1 });
  });
});
