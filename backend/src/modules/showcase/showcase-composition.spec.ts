import { Types } from 'mongoose';
import { ShowcaseComposition } from './showcase-composition';

/** C127: при сохранении состава _id строки не меняется, если клиент прислал прежний. */
describe('ShowcaseComposition.set — сохранение id строки', () => {
  it('оставляет прежний _id и выдаёт новый только новой строке', async () => {
    const me = new Types.ObjectId();
    const lineId = new Types.ObjectId();
    const mat = new Types.ObjectId();
    const mat2 = new Types.ObjectId();
    let saved: unknown;
    const db = {
      collection: (coll: string) => ({
        findOne: async () => coll === 'products' ? { _id: me, deletedAt: null, composition: [{ _id: lineId, lineType: 'material', refId: mat, quantity: 1 }] } : null,
        find: () => ({ toArray: async () => coll === 'materials' ? [{ _id: mat, unit: 'шт' }, { _id: mat2, unit: 'шт' }] : [] }),
        updateOne: async (_f: unknown, u: { $set: { composition: unknown } }) => { saved = u.$set.composition; },
      }),
    };
    const svc = new ShowcaseComposition(() => db as never);
    await svc.set(String(me), [
      { id: String(lineId), lineType: 'material', materialId: String(mat), quantity: 2 },
      { lineType: 'material', materialId: String(mat2), quantity: 1 },
    ], ['material']);
    const rows = saved as Array<{ _id: Types.ObjectId; quantity: number }>;
    expect(String(rows[0]._id)).toBe(String(lineId));
    expect(rows[0].quantity).toBe(2);
    expect(String(rows[1]._id)).not.toBe(String(lineId));
  });

  it('C142: при сохранении не затирает overrideDimensions / sourcePosition / isPurchased', async () => {
    const me = new Types.ObjectId();
    const lineId = new Types.ObjectId();
    const mat = new Types.ObjectId();
    let saved: unknown;
    const dims = { length: 100, unit: 'мм' };
    const db = {
      collection: (coll: string) => ({
        findOne: async () => coll === 'products' ? {
          _id: me, deletedAt: null,
          composition: [{ _id: lineId, lineType: 'material', refId: mat, quantity: 1, overrideDimensions: dims, isPurchased: true, sourcePosition: 'A1', sourceCode: 'PDM' }],
        } : null,
        find: () => ({ toArray: async () => coll === 'materials' ? [{ _id: mat, unit: 'шт' }] : [] }),
        updateOne: async (_f: unknown, u: { $set: { composition: unknown } }) => { saved = u.$set.composition; },
      }),
    };
    const svc = new ShowcaseComposition(() => db as never);
    await svc.set(String(me), [
      { id: String(lineId), lineType: 'material', materialId: String(mat), quantity: 3 },
    ], ['material']);
    const row = (saved as Array<Record<string, unknown>>)[0];
    expect(row.quantity).toBe(3);
    expect(row.overrideDimensions).toEqual(dims);
    expect(row.isPurchased).toBe(true);
    expect(row.sourcePosition).toBe('A1');
    expect(row.sourceCode).toBe('PDM');
  });
});

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
