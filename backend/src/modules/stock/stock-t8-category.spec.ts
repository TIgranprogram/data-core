import { Types } from 'mongoose';
import { StockSearchService } from './stock-search.service';
import { scopeOfZones } from '../../common/stock-scope';

/**
 * T8 — «у категории число есть, а список пустой».
 * Причина: `categoryId` в materials хранится и ObjectId, и строкой (kppdf пишет мимо схемы).
 * `itemRows` раньше читал через модель Mongoose: `$in:[ObjectId, hex]` приводился к ObjectId,
 * и строковая категория не находилась. Теперь читает сырой коллекцией — оба вида находятся.
 */

const cat = new Types.ObjectId();
const catHex = String(cat);
const wh = new Types.ObjectId();
const mats = Array.from({ length: 37 }, () => ({
  _id: new Types.ObjectId(), name: 'Труба профильная 20х20', article: 'x', unit: 'м',
  categoryId: catHex, // СТРОКОЙ, как пишет kppdf
  materialKind: 'raw', dimensions: [], photoIds: [], sku: null,
}));

const matchMat = (m: Record<string, unknown>, f: Record<string, unknown>) => {
  if (f.deletedAt !== undefined && (m.deletedAt ?? null) !== f.deletedAt) return false;
  if ((f.categoryId as { $in?: unknown[] } | undefined)?.$in) {
    const ins = (f.categoryId as { $in: unknown[] }).$in.map(String);
    if (!ins.includes(String(m.categoryId))) return false;
  }
  if (f.offcutOf !== undefined && m.offcutOf !== f.offcutOf) return false;
  if ((f._id as { $in?: unknown[] } | undefined)?.$in) {
    const ins = (f._id as { $in: unknown[] }).$in.map(String);
    if (!ins.includes(String(m._id))) return false;
  }
  return true;
};

const coll = (rows: Record<string, unknown>[]) => ({
  find: (f: Record<string, unknown> = {}) => {
    const cur = { projection: () => cur, limit: () => cur, sort: () => cur, toArray: async () => rows.filter((r) => matchMat(r, f)) };
    return cur;
  },
  findOne: async (f: Record<string, unknown> = {}) => rows.find((r) => matchMat(r, f)) ?? null,
  countDocuments: async () => rows.length,
  aggregate: () => ({ toArray: async () => [] }),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const svc: any = Object.create(StockSearchService.prototype);
svc['connection'] = { db: { collection: (n: string) => (n === 'categories' ? coll([{ _id: cat, name: 'Круглая труба' }]) : n === 'materials' ? coll(mats) : coll([])) } };
// модель Mongoose здесь НЕ используется (itemRows читает сырой коллекцией); для полноты — пустая
svc['materials'] = { find: () => ({ setOptions: () => ({ lean: () => ({ exec: async () => [] }) }) }) };
svc['storage'] = { find: () => ({ setOptions: () => ({ lean: () => ({ exec: async () => [] }) }) }) };
svc['core'] = { defaultWarehouse: async () => ({ _id: wh, name: 'Главный' }) };
svc['versions'] = null;

describe('T8: фильтр списка по категории (строковая категория kppdf)', () => {
  it('список находит позиции со строковой категорией', async () => {
    const list = await svc.listItems({ categoryId: catHex }, null);
    expect(list.total).toBe(37);
    expect(list.counts.all).toBe(37);
    expect(list.items[0].categoryId).toBe(catHex);
  });

  it('счётчик категории равен числу строк списка (выбрана зона)', async () => {
    const scope = scopeOfZones([{ id: 'z', name: 'Трубы', categoryIds: [catHex], isDefault: false }]);
    const summary = await svc.categorySummary(scope);
    const catItem = summary.items.find((c: { id: string }) => c.id === catHex);
    const list = await svc.listItems({ categoryId: catHex }, scope);
    expect(catItem).toBeDefined();
    expect(catItem!.total).toBe(37);
    expect(catItem!.total).toBe(list.total);
    expect(list.counts.all).toBe(list.total);
  });
});
