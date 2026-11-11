import { Types } from 'mongoose';
import { categoryFieldDefaults, gapKind, productGaps } from './passport-gaps';

describe('C070-П2: числа категории по умолчанию', () => {
  it('строки «ключ — значение», срок службы и гарантия; пустое и нули пропускаются', () => {
    expect(categoryFieldDefaults({ serviceLifeYears: '10', warrantyMonths: '12', fieldDefaults: 'heightMin — 1400\nweightMax - 120\r\nmaxUsers — 0\nбез значения\nsiteLength — 4,5' }))
      .toEqual({ heightMin: 1400, weightMax: 120, siteLength: 4.5, serviceLifeYears: 10, warrantyMonths: 12 });
    expect(categoryFieldDefaults(undefined)).toEqual({});
  });
});

const oid = () => new Types.ObjectId();
type Row = Record<string, unknown>;
const fv = [{ _id: oid(), dict: 'productFacets', code: 'trn.kind', name: 'Вид', category: 'TRN', order: 1, step: true, deletedAt: null }];
const kinds = [
  { _id: oid(), dict: 'productFacetValues', code: 'trn.kind.power', name: 'Силовой', parentId: fv[0]._id, order: 1, words: ['жим'], deletedAt: null },
  { _id: oid(), dict: 'productFacetValues', code: 'trn.kind.cardio', name: 'Кардио', parentId: fv[0]._id, order: 2, words: ['вело'], deletedAt: null },
];
const install = { _id: oid(), dict: 'passportInstall', code: 'EMBEDDED', name: 'Закладные', deletedAt: null };
const dictRows: Row[] = [...fv, ...kinds, install,
  { _id: oid(), dict: 'passportCategories', code: 'TRN', name: 'Уличный тренажёр', deletedAt: null }];

function fakeDb(product: Row | null) {
  return {
    collection: (name: string) => ({
      findOne: async () => (name === 'products' ? product : null),
      find: (q: Row) => ({ toArray: async () => (name === 'dict_values' ? dictRows.filter((r) => (q.dict && typeof q.dict === 'object' ? ((q.dict as { $in: string[] }).$in).includes(r.dict as string) : r.dict === q.dict)) : []) }),
    }),
  } as never;
}
const checker = (missing: Array<{ label: string; key: string }>) => ({
  check: async () => ({ missing }),
  categoryRules: async () => new Map([['TRN', { name: 'Уличный тренажёр', serviceLifeYears: '10' }], ['ALL', { name: 'Для всех' }]]),
});

describe('«Чего не хватает» изделию (A3)', () => {
  it('вид пункта по ключу поля', () => {
    expect([gapKind('img_overview'), gapKind('installationTypeId'), gapKind('elements'), gapKind('weight')]).toEqual(['image', 'install', 'elements', 'field']);
  });
  it('нет категории — один пункт «категория» со списком вариантов, без «Для всех»', async () => {
    const r = await productGaps(checker([]), fakeDb({ _id: oid(), name: 'Станок' }), String(oid()));
    expect(r.category).toEqual({ code: null, name: null, source: null });
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]).toMatchObject({ kind: 'category', required: true, options: [{ id: 'TRN', label: 'Уличный тренажёр' }] });
  });
  it('признак без значения: подсказка по словам; умолчания категории (установка, срок службы)', async () => {
    const prod = { _id: oid(), name: 'Жим ногами', passportDefaults: { passportCategory: 'TRN' } };
    const r = await productGaps(checker([{ label: 'Способ установки', key: 'installationTypeId' }, { label: 'Срок службы', key: 'serviceLifeYears' }, { label: 'Тексты', key: 'choice:1' }]), fakeDb(prod), String(prod._id));
    expect(r.category).toMatchObject({ code: 'TRN', source: 'own' });
    const kind = r.missing.find((m) => m.key === 'trn.kind')!;
    expect(kind).toMatchObject({ kind: 'facet', suggest: { label: 'Силовой', word: 'жим' } });
    expect(kind.options).toHaveLength(2);
    expect(r.missing.find((m) => m.key === 'installationTypeId')).toMatchObject({ kind: 'install', required: true, default: { label: 'Закладные' } });
    expect(r.missing.find((m) => m.key === 'serviceLifeYears')).toMatchObject({ kind: 'field', default: 10 });
    expect(r.missing.some((m) => m.key.startsWith('choice:'))).toBe(false);
  });
  it('признак уже указан — не в списке', async () => {
    const prod = { _id: oid(), name: 'Жим', passportDefaults: { passportCategory: 'TRN' }, facetValueIds: [kinds[0]._id] };
    const r = await productGaps(checker([]), fakeDb(prod), String(prod._id));
    expect(r.missing).toEqual([]);
  });
});

describe('«Чего не хватает»: элементы (C028)', () => {
  const el = (name: string, categories: string, kind?: string) => ({ _id: oid(), dict: 'passportElements', name, categories, ...(kind ? { kind } : {}), deletedAt: null });
  const bar = el('Турник', 'TRN, WRK'), bush = el('Втулка', 'TRN', 'part'), free = el('Без категории', ''), other = el('Горка', 'DIO');
  const withEl = (extra: Row[]) => { dictRows.push(...extra); return () => { for (const r of extra) dictRows.splice(dictRows.indexOf(r), 1); }; };
  const miss = [{ label: 'Элементы', key: 'elements' }];

  it('список элементов: строго по категории, без деталей и без пустых категорий', async () => {
    const undo = withEl([bar, bush, free, other]);
    const prod = { _id: oid(), name: 'Станок', passportDefaults: { passportCategory: 'TRN' } };
    const r = await productGaps(checker(miss), fakeDb(prod), String(prod._id));
    undo();
    expect(r.missing.find((m) => m.key === 'elements')!.options!.map((o) => o.label)).toEqual(['Турник']);
  });
  it('элементы есть у изделия — строки нет', async () => {
    const prod = { _id: oid(), name: 'Станок', passportDefaults: { passportCategory: 'TRN', elements: [oid()] } };
    expect((await productGaps(checker(miss), fakeDb(prod), String(prod._id))).missing.some((m) => m.key === 'elements')).toBe(false);
  });
  it('элементы приходят из признака — строки нет', async () => {
    const power = { ...kinds[0], elementIds: [oid()] };
    dictRows.push(power);
    const prod = { _id: oid(), name: 'Станок', passportDefaults: { passportCategory: 'TRN' }, facetValueIds: [power._id] };
    const r = await productGaps(checker(miss), fakeDb(prod), String(prod._id));
    dictRows.splice(dictRows.indexOf(power), 1);
    expect(r.missing.some((m) => m.key === 'elements')).toBe(false);
  });
});
