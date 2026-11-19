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
  it('C163: критерии дают только живые элементы, своё не меняется и в изделие ничего не записывается', async () => {
    const value = new Types.ObjectId(), parent = new Types.ObjectId(), element = new Types.ObjectId(), dead = new Types.ObjectId(), own = new Types.ObjectId();
    const find = jest.fn((q: { dict: string }) => ({ toArray: async () => q.dict === 'productFacetValues'
      ? [{ _id: value, parentId: parent, elementIds: [element, dead, element, 'bad'] }] : q.dict === 'productFacets'
        ? [{ _id: parent }] : q.dict === 'passportElements' ? [{ _id: element }] : [] }));
    const d = { collection: () => ({ find, findOne: async () => null }) } as never;
    const product = { facetValueIds: [value], passportDefaults: { passportCategory: 'TRN' } };
    const before = JSON.stringify(product);
    expect((await productPatch(d, product, { presentation: true })).elements).toEqual([element]);
    expect(JSON.stringify(product)).toBe(before);
    expect((await productPatch(d, { ...product, passportDefaults: { ...product.passportDefaults, elements: [own] } })).elements).toEqual([own]);
    expect(find).toHaveBeenCalledTimes(3);
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ dict: 'productFacets', deletedAt: null, category: { $in: ['TRN'] } }), expect.anything());
  });
  it('C148: новый черновик получает источники и ручные формулировки таблицы без пересборки старого снимка', async () => {
    const source = { kind: 'part', refId: String(new Types.ObjectId()), name: 'Стойка', code: 'СТ.1' };
    const spec = { rows: [{ materialId: new Types.ObjectId(), sizes: ['89×3'], partIds: [], sourceRefs: [{ ...source, path: [source] }], passportText: 'Ручной паспорт', techText: 'Ручная техника' }], coatingIds: [] };
    const snapshot = JSON.parse(JSON.stringify(spec));
    const patch = await productPatch(db, { materialsSpec: spec });
    expect(patch.materialsSpec).toEqual(spec);
    spec.rows[0].sourceRefs[0].name = 'Новая стойка';
    expect(snapshot.rows[0].sourceRefs[0].name).toBe('Стойка');
    expect(followsProduct({ status: 'issued', productId: 'x' })).toBe(false);
  });
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

  it('черновик собирает лист: модуль и под ним деталь; нет имени — обозначение', async () => {
    const mod = new Types.ObjectId();
    const part = new Types.ObjectId();
    const pipe = new Types.ObjectId();
    const d = fakeDb({
      productmodules: [{ _id: mod, sku: 'М-1', composition: [{ lineType: 'material', refId: part, quantity: 2 }] }],
      materials: [
        { _id: part, name: 'Стойка', materialKind: 'part', composition: [{ lineType: 'material', refId: pipe, quantity: 1 }] },
        { _id: pipe, name: 'Труба 89х3', materialKind: 'raw' },
      ],
    });
    const patch = await productPatch(d, { name: 'Горка', composition: [{ lineType: 'module', refId: mod, quantity: 1, unit: 'шт' }] });
    expect(patch.compositionSheet).toEqual([{
      kind: 'module', word: 'Модуль', label: 'М-1', qty: 1, unit: 'шт',
      children: [{ kind: 'part', word: 'Деталь', label: 'Стойка', qty: 2, unit: 'шт' }],
    }]);
  });

  it('выпущенный снимок состава не пересобирается вместе с изделием', async () => {
    const issued = { status: 'issued', productId: 'x', compositionSheet: [{ word: 'Модуль', label: 'Старая', qty: 1, unit: 'шт' }] };
    expect(followsProduct(issued)).toBe(false);
    expect((await productPatch(db, { name: 'Новая', composition: [] })).compositionSheet).toBeNull();
    expect(issued.compositionSheet).toEqual([{ word: 'Модуль', label: 'Старая', qty: 1, unit: 'шт' }]);
    expect(diffPatch({}, { compositionSheet: null })).toEqual({});
    expect(diffPatch({ compositionSheet: issued.compositionSheet }, { compositionSheet: null })).toEqual({ compositionSheet: null });
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
  it('C148: ручное имя экземпляра переживает повторную синхронизацию и manualText изделия', () => {
    const own = { name: 'Название договора', manualText: ['name'] };
    const patch = { name: 'Название модели', manualText: ['purpose'] };
    const first = diffPatch(own, patch);
    expect(first).toEqual({ manualText: ['purpose', 'name'] });
    expect(diffPatch({ ...own, ...first }, patch)).toEqual({});
    expect(diffPatch({ name: 'Старая модель' }, patch)).toMatchObject({ name: 'Название модели' });
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

describe('C163 P1: применимость производных элементов', () => {
  const trn = new Types.ObjectId(), blg = new Types.ObjectId(), dead = new Types.ObjectId(), absent = new Types.ObjectId();
  const trnElement = new Types.ObjectId(), blgElement = new Types.ObjectId(), badElement = new Types.ObjectId();
  const values = [
    { _id: new Types.ObjectId(), parentId: trn, elementIds: [trnElement] },
    { _id: new Types.ObjectId(), parentId: blg, elementIds: [blgElement] },
    { _id: new Types.ObjectId(), parentId: dead, elementIds: [badElement] },
    { _id: new Types.ObjectId(), parentId: absent, elementIds: [badElement] },
    { _id: new Types.ObjectId(), elementIds: [badElement] },
    { _id: new Types.ObjectId(), parentId: 'broken', elementIds: [badElement] },
  ].map((v) => ({ ...v, dict: 'productFacetValues', deletedAt: null }));
  const rows: Record<string, unknown>[] = [
    ...values,
    { _id: trn, dict: 'productFacets', category: 'TRN', deletedAt: null },
    { _id: blg, dict: 'productFacets', category: 'BLG', deletedAt: null },
    { _id: dead, dict: 'productFacets', category: 'TRN', deletedAt: new Date() },
    ...[trnElement, blgElement, badElement].map((_id) => ({ _id, dict: 'passportElements', deletedAt: null })),
  ];
  const match = (row: Record<string, unknown>, query: Record<string, unknown>) => Object.entries(query).every(([key, value]) => {
    if (value && typeof value === 'object' && '$in' in value) return (value as { $in: unknown[] }).$in.some((v) => String(v) === String(row[key]));
    return value === null ? row[key] == null : String(value) === String(row[key]);
  });
  const db = { collection: () => ({ findOne: async () => null,
    find: (query: Record<string, unknown>) => ({ toArray: async () => rows.filter((r) => match(r, query)) }),
  }) } as never;

  it('смена категории меняет только вычисленные элементы, чужие сохранённые ответы остаются', async () => {
    const product = { facetValueIds: values.slice(0, 2).map((v) => v._id), passportDefaults: { passportCategory: 'TRN' } };
    const selected = [...product.facetValueIds];
    expect((await productPatch(db, product)).elements).toEqual([trnElement]);
    product.passportDefaults.passportCategory = 'BLG';
    expect((await productPatch(db, product)).elements).toEqual([blgElement]);
    expect(product.facetValueIds).toEqual(selected);
    product.passportDefaults.passportCategory = 'MAF';
    expect((await productPatch(db, product)).elements).toEqual([blgElement]);
  });

  it('удалённый, неизвестный, отсутствующий и повреждённый родитель не даёт элементов', async () => {
    const product = { facetValueIds: values.slice(2).map((v) => v._id), passportDefaults: { passportCategory: 'TRN' } };
    expect(await productPatch(db, product)).not.toHaveProperty('elements');
    expect(product.facetValueIds).toHaveLength(4);
    expect(await productPatch(db, { facetValueIds: [values[0]._id] })).not.toHaveProperty('elements');
  });

  it('собственные элементы приоритетны при наличии чужих и повреждённых критериев', async () => {
    const product = { facetValueIds: values.map((v) => v._id), passportDefaults: { passportCategory: 'TRN', elements: [badElement] } };
    const before = JSON.stringify(product);
    expect((await productPatch(db, product)).elements).toEqual([badElement]);
    expect(JSON.stringify(product)).toBe(before);
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
