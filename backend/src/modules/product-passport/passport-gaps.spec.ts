import { Types } from 'mongoose';
import { gapKind, productGaps } from './passport-gaps';

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
