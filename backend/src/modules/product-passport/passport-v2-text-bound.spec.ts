import { buildV2Text } from './passport-v2-text';
import { DEFAULT_PASSPORT_TEMPLATE } from './passport-template.default';
import { resolveChoices, type PhraseTreeNode } from '../../common/passport/phrase-tree';

/** C028 B2: тексты, привязанные к признакам / группам изделия, попадают в PDF сами; к чужим — никогда. */
describe('тексты по признакам и группам изделия', () => {
  const hex = (n: number) => String(n).padStart(24, '0');
  const mk = (o: Record<string, unknown>) => ({ id: hex(1), name: '', parentId: null, section: 'x', text: '', categories: '', allCategories: true, order: 0, required: false, isDefault: false, installTypeId: null, slot: 1, children: [], ...o }) as PhraseTreeNode;
  const root = (id: number, name: string, text: string, link: Record<string, unknown>, slot: number) =>
    mk({ id: hex(id), name, section: 'cargo' + id, slot, children: [mk({ id: hex(id + 1), name: 'Текст', text, ...link })] });
  const base = { all: { ...DEFAULT_PASSPORT_TEMPLATE, version: 0 } };
  const FACET_LOAD = hex(900), GROUP_STANDS = hex(901), GROUP_BINS = hex(902);

  const trn = [root(10, 'Грузовой блок', 'Грузовой блок рассчитан на изменяемую нагрузку.', { facetValueIds: [FACET_LOAD] }, 1)];
  const blg = [
    root(20, 'Трибуны', 'Правила пользования трибунами.', { groupIds: [GROUP_STANDS] }, 1),
    root(30, 'Урны', 'Правила пользования урнами.', { groupIds: [GROUP_BINS] }, 2),
  ];
  const pdf = (forest: PhraseTreeNode[], product?: { facetValueIds: string[]; groupIds: string[] }, choices?: Record<string, string>) =>
    JSON.stringify(buildV2Text({ ...base, passport: { passportCategory: 'X' }, funnel: { forest, choices, product: product && { facetValueIds: new Set(product.facetValueIds), groupIds: new Set(product.groupIds) } } }).sections);

  it('TRN с «Изменяемой нагрузкой» — абзац грузового блока есть, без неё — нет', () => {
    expect(pdf(trn, { facetValueIds: [FACET_LOAD], groupIds: [] })).toContain('изменяемую нагрузку');
    expect(pdf(trn, { facetValueIds: [hex(777)], groupIds: [] })).not.toContain('изменяемую нагрузку');
    expect(pdf(trn)).not.toContain('изменяемую нагрузку'); // изделие неизвестно
  });

  it('BLG «Трибуны» — правила трибун есть, «Урны» — нет', () => {
    const t = pdf(blg, { facetValueIds: [], groupIds: [GROUP_STANDS] });
    expect(t).toContain('трибунами');
    expect(t).not.toContain('урнами');
  });

  it('явный выбор менеджера сильнее привязки; чужой лист сам не выбирается даже единственным', () => {
    const forest = [mk({ id: hex(40), name: 'Правила', section: 'rules', slot: 1, children: [
      mk({ id: hex(41), name: 'Общие', text: 'Общие правила.', isDefault: true }),
      mk({ id: hex(42), name: 'Трибуны', text: 'Правила трибун.', groupIds: [GROUP_STANDS] }),
    ] })];
    const stands = { facetValueIds: new Set<string>(), groupIds: new Set([GROUP_STANDS]) };
    expect(resolveChoices(forest, null, stands).leaves.get(hex(40))?.leaf.id).toBe(hex(42));
    expect(resolveChoices(forest, { [hex(40)]: hex(41) }, stands).leaves.get(hex(40))?.leaf.id).toBe(hex(41));
    expect(resolveChoices(forest, null, { facetValueIds: new Set(), groupIds: new Set([GROUP_BINS]) }).leaves.get(hex(40))?.leaf.id).toBe(hex(41));
  });
});
