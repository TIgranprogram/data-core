import { Types } from 'mongoose';
import { diffPatch, followsProduct, productPatch, productCategories } from './passport-from-product';

/** Фальшивая БД: categories, dict_values, products. */
const fakeDb = (cols: Record<string, Array<Record<string, unknown>>>) => ({
  collection: (n: string) => ({
    findOne: async (f: { _id: unknown }) => (cols[n] ?? []).find((x) => String(x._id) === String(f._id)) ?? null,
    find: (f: { _id?: { $in: unknown[] } }) => ({ toArray: async () => (cols[n] ?? []).filter((x) => !f?._id?.$in || f._id.$in.some((i) => String(i) === String(x._id))) }),
  }),
}) as never;

const catId = new Types.ObjectId();
const db = fakeDb({
  categories: [{ _id: catId, name: 'Тренажёры', passportCategory: 'TRN' }],
  dict_values: [{ code: 'TRN', name: 'Тренажёры' }, { code: 'WRK', name: 'Воркаут' }],
});

describe('паспорт из изделия', () => {
  it('следует за изделием только черновик с productId', () => {
    expect(followsProduct({ status: 'draft', productId: 'x' })).toBe(true);
    expect(followsProduct({ status: 'issued', productId: 'x' })).toBe(false);
    expect(followsProduct({ status: 'draft' })).toBe(false);
  });

  it('категория изделия: своя главнее унаследованной', async () => {
    expect((await productPatch(db, { categoryId: catId, name: 'А' })).passportCategory).toBe('TRN');
    expect((await productPatch(db, { categoryId: catId, name: 'А', passportDefaults: { passportCategory: 'WRK' } })).passportCategory).toBe('WRK');
  });

  it('изделие без категории не задаёт её — остаётся выбор в паспорте', async () => {
    expect('passportCategory' in (await productPatch(db, { name: 'А' }))).toBe(false);
  });

  it('поля изделия: название, артикул, габариты, вес; пустые не попадают', async () => {
    const p = await productPatch(db, { name: ' Брусья ', sku: 'ART-1', dimensions: { length: 1200, width: 0, height: 900 }, weightKg: 35, purpose: '', installation: 'бетон' });
    expect(p).toMatchObject({ name: 'Брусья', article: 'ART-1', length: 1200, height: 900, weight: 35, installationMethod: 'бетон' });
    expect(p).not.toHaveProperty('width');
    expect(p).not.toHaveProperty('purpose');
  });

  it('diffPatch: только отличия; вручную набранный текст не перебивается', () => {
    const cur = { name: 'А', article: 'X', purpose: 'своё', manualText: ['purpose'] };
    expect(diffPatch(cur, { name: 'А', article: 'Y', purpose: 'из изделия' })).toEqual({ article: 'Y' });
  });

  it('diffPatch: ObjectId и массивы сравниваются по значению', () => {
    const id = new Types.ObjectId();
    expect(diffPatch({ elements: [id] }, { elements: [new Types.ObjectId(String(id))] })).toEqual({});
  });

  it('productCategories: пачкой по изделиям', async () => {
    const pid = new Types.ObjectId();
    const d = fakeDb({ products: [{ _id: pid, categoryId: catId }], categories: [{ _id: catId, name: 'Т', passportCategory: 'TRN' }], dict_values: [] });
    expect((await productCategories(d, [pid, String(pid)])).get(String(pid))).toBe('TRN');
  });
});
