import { Types } from 'mongoose';
import { diffPatch, followsProduct, productPatch, productCategories } from './passport-from-product';
import { buildV2Text } from './passport-v2-text';
import { printableText } from './passport-blanks';

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
  it('переносит существующий текст материалов в сохраняемое поле паспорта', async () => {
    expect(await productPatch(db, { materialsText: ' Сосна, лак ' })).toEqual({ materials: 'Сосна, лак' });
    expect(await productPatch(db, { materialsText: '  ' })).not.toHaveProperty('materials');
  });
  it('повторная сборка печатного текста берёт материалы изделия; выпущенный снимок остаётся прежним', async () => {
    const prod = { name: 'Указатель', materialsText: 'Сосна, лак' };
    const render = async () => printableText(buildV2Text({ passport: await productPatch(db, prod), all: { sections: [] } }), { draft: true });
    const snapshot = await render();
    expect(snapshot.description).toBe('Указатель (далее — изделие). Материалы: Сосна, лак.');
    expect((await render()).description).toBe(snapshot.description);
    prod.materialsText = 'Берёза';
    expect((await render()).description).toContain('Берёза');
    expect(snapshot.description).toContain('Сосна, лак');
  });
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

describe('C100: вид изделия в паспорте из изделия', () => {
  const el = new Types.ObjectId();
  const root = { _id: new Types.ObjectId(), dict: 'passportPhrases', section: 'purpose', parentId: null, name: 'Назначение', deletedAt: null };
  const leaf = { _id: new Types.ObjectId(), dict: 'passportPhrases', section: 'purpose', parentId: root._id, name: 'Отдых', text: 'Для отдыха.', deletedAt: null };
  const kind = { _id: new Types.ObjectId(), dict: 'passportKinds', name: 'Скамья', passportCategory: 'BLG', elementIds: [el], purposeLeafId: leaf._id, deletedAt: null };
  const group = { _id: new Types.ObjectId(), name: 'Скамьи', parentId: new Types.ObjectId(), passportCategory: 'WRK', passportKindId: kind._id };
  const rows: Record<string, Array<Record<string, unknown>>> = { categories: [group], dict_values: [root, leaf, kind] };
  const match = (r: Record<string, unknown>, q: Record<string, unknown>) => Object.entries(q).every(([k, v]) => {
    if (v && typeof v === 'object' && '$in' in v) return (v as { $in: unknown[] }).$in.some((x) => String(x) === String(r[k]));
    return v === null ? r[k] == null : String(r[k]) === String(v);
  });
  const kdb = { collection: (n: string) => ({
    find: (q: Record<string, unknown>) => ({ toArray: async () => (rows[n] ?? []).filter((r) => match(r, q ?? {})) }),
    findOne: async (q: Record<string, unknown>) => (rows[n] ?? []).find((r) => match(r, q ?? {})) ?? null,
  }) } as never;

  it('элементы, назначение и категория берутся из вида группы', async () => {
    const p = await productPatch(kdb, { name: 'Скамья 1', categoryId: group._id });
    expect((p.elements as Types.ObjectId[]).map(String)).toEqual([String(el)]);
    expect(p.textChoices).toEqual({ [String(root._id)]: String(leaf._id) });
    expect(p.passportCategory).toBe('BLG'); // категория вида главнее категории группы
  });
  it('своё у изделия главнее вида', async () => {
    const mine = new Types.ObjectId(), other = new Types.ObjectId();
    const p = await productPatch(kdb, { name: 'Х', categoryId: group._id, passportDefaults: { passportCategory: 'DIO', elements: [mine], textChoices: { [String(root._id)]: String(other) } } });
    expect((p.elements as Types.ObjectId[]).map(String)).toEqual([String(mine)]);
    expect((p.textChoices as Record<string, string>)[String(root._id)]).toBe(String(other));
    expect(p.passportCategory).toBe('DIO');
  });
});
