import { buildFunnel, parseSelection, type FunnelInput, type FunnelProduct } from './funnel';

const P = (id: string, name: string, over: Partial<FunnelProduct> = {}): FunnelProduct => ({ id, sku: 'A' + id, name, cat: 'TRN', groupId: 'g1', group: 'Тренажеры', valueIds: [], photoId: null, ...over });
const facets = [{ id: 'f1', code: 'trn.kind', name: 'Вид', category: 'TRN', order: 1, step: true, multi: false, hint: '' }, { id: 'f2', code: 'trn.muscles', name: 'Мышцы', category: 'TRN', order: 2, step: true, multi: true, hint: '' }];
const values = [
  { id: 'v1', name: 'Силовой', parentId: 'f1', order: 1 }, { id: 'v2', name: 'Кардио', parentId: 'f1', order: 2 },
  { id: 'm1', name: 'Ноги', parentId: 'f2', order: 1 }, { id: 'm2', name: 'Спина', parentId: 'f2', order: 2 },
];
const base = (over: Partial<FunnelInput> = {}): FunnelInput => ({
  products: [P('1', 'Жим ногами', { valueIds: ['v1', 'm1'] }), P('2', 'Тяга верхняя', { valueIds: ['v1', 'm2'] }), P('3', 'Велотренажёр', { valueIds: ['v2'] }), P('4', 'Новый станок')],
  facets, values, categories: [{ code: 'TRN', name: 'Уличный тренажёр' }, { code: 'WRK', name: 'Воркаут' }], selected: [], none: [], ...over,
});

describe('воронка паспорта: шаги', () => {
  it('одна категория и одна группа — шаги пропускаются, категория выбирается сама', () => {
    const r = buildFunnel(base());
    expect(r.category).toBe('TRN');
    expect(r.steps.find((s) => s.key === 'category')).toMatchObject({ skip: true });
    expect(r.steps.find((s) => s.key === 'group')).toMatchObject({ skip: true, values: [{ id: 'g1', count: 4 }] });
  });
  it('две категории — шаг не пропускается, признаков пока нет', () => {
    const r = buildFunnel(base({ products: [...base().products, P('5', 'Турник', { cat: 'WRK', groupId: 'g2', group: 'Воркаут' })] }));
    expect(r.category).toBeNull();
    expect(r.steps.map((s) => s.key)).toEqual(['category', 'group']);
    expect(r.steps[0]).toMatchObject({ skip: false, none: 0 });
  });
  it('признак: счётчики и «не указан» (none) считаются на срезе', () => {
    const r = buildFunnel(base());
    const kind = r.steps.find((s) => s.key === 'trn.kind')!;
    expect(kind.values.map((v) => [v.id, v.count])).toEqual([['v1', 2], ['v2', 1]]);
    expect(kind.none).toBe(1);
    expect(kind.skip).toBe(false);
  });
  it('выбор значения сужает следующие шаги; у признака с одним значением шаг пропускается', () => {
    const r = buildFunnel(base({ selected: ['v1'] }));
    expect(r.matched.map((p) => p.id).sort()).toEqual(['1', '2']);
    expect(r.steps.find((s) => s.key === 'trn.muscles')!.values.map((v) => v.id)).toEqual(['m1', 'm2']);
    const r2 = buildFunnel(base({ selected: ['v2'] }));
    expect(r2.steps.find((s) => s.key === 'trn.muscles')).toMatchObject({ skip: true, values: [], none: 1 });
  });
  it('несколько значений многозначного признака — изделие должно иметь все', () => {
    const products = [P('1', 'Комбо', { valueIds: ['v1', 'm1', 'm2'] }), P('2', 'Ноги', { valueIds: ['v1', 'm1'] })];
    expect(buildFunnel(base({ products, selected: ['m1', 'm2'] })).matched.map((p) => p.id)).toEqual(['1']);
    expect(buildFunnel(base({ products, selected: ['m1'] })).total).toBe(2);
  });
  it('«признак не указан» оставляет изделия без значений признака', () => {
    expect(buildFunnel(base({ none: ['f1'] })).matched.map((p) => p.id)).toEqual(['4']);
  });
  it('поиск идёт по всем изделиям и не сужается шагами', () => {
    const r = buildFunnel(base({ selected: ['v2'], q: 'тяга' }));
    expect(r.matched.map((p) => p.id)).toEqual(['2']);
    expect(buildFunnel(base({ q: 'a3' })).matched.map((p) => p.id)).toEqual(['3']);
  });
  it('группа сужает изделия; миниатюра группы — фото первого изделия', () => {
    const products = [P('1', 'А', { photoId: 'ph1' }), P('2', 'Б', { groupId: 'g2', group: 'Другая' })];
    const r = buildFunnel(base({ products, group: 'g2' }));
    expect(r.matched.map((p) => p.id)).toEqual(['2']);
    expect(r.steps.find((s) => s.key === 'group')!.values.find((v) => v.id === 'g1')).toMatchObject({ thumb: 'ph1' });
  });
});

describe('воронка паспорта: разбор', () => {
  it('f: значения и none:', () => {
    expect(parseSelection('a, b,none:f1')).toEqual({ selected: ['a', 'b'], none: ['f1'] });
    expect(parseSelection(undefined)).toEqual({ selected: [], none: [] });
  });
});
