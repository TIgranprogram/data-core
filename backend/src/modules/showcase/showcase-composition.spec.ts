import { Types } from 'mongoose';
import { ShowcaseComposition } from './showcase-composition';

/** Похожие изделия (СИ, ПР-1): расчёт идёт через кэш версий данных, соседей — не больше 500 последних. */
describe('ShowcaseComposition.similar', () => {
  const cat = new Types.ObjectId(), mat = new Types.ObjectId(), me = new Types.ObjectId();
  const calls: Array<{ coll: string; limit?: number; sort?: unknown }> = [];
  const db = {
    collection: (coll: string) => ({
      findOne: async () => ({ _id: me, categoryId: cat, composition: [] }),
      find: () => {
        const rec: { coll: string; limit?: number; sort?: unknown } = { coll }; calls.push(rec);
        const cur = { sort: (s: unknown) => { rec.sort = s; return cur; }, limit: (n: number) => { rec.limit = n; return cur; },
          toArray: async () => (coll === 'products' && rec.limit ? [{ composition: [{ lineType: 'material', refId: mat }] }] : coll === 'materials' ? [{ _id: mat, name: 'Труба', unit: 'м' }] : []) };
        return cur;
      },
    }),
  };

  it('берёт не больше 500 последних соседей и считает через кэш с ключом по id', async () => {
    const cached = jest.fn((_scope: string, _colls: readonly string[], _extra: string, fn: () => Promise<unknown>) => fn());
    const svc = new ShowcaseComposition(() => db as never, { cached } as never);
    const r = await svc.similar(String(me));
    expect(cached).toHaveBeenCalledWith('showcase.similar', ['products', 'materials'], String(me), expect.any(Function));
    expect(calls.find((c) => c.coll === 'products' && c.limit)).toMatchObject({ limit: 500, sort: { _id: -1 } });
    expect(r.items).toEqual([{ lineType: 'material', refId: String(mat), n: 1, name: 'Труба', unit: 'м' }]);
  });
});
