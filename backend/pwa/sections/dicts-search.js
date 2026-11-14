import { searchTokens, normSearch } from '../core/facets.js';

/** Токены поиска справочника: «оцинк…» → ещё «цинк» (покрытия C055). */
export function dictSearchTokens(q) {
  return searchTokens(q).flatMap((w) => (w.startsWith('оцинк') || w.startsWith('цинк') ? [w, 'цинк'] : [w]));
}

/** Строка для поиска: название, код латиницей как есть (GALV), kind покрытие/материал. */
export function dictHaystack(x) {
  const kind = x.kind === 'coating' ? 'покрытие coating' : x.kind === 'material' ? 'материал material' : '';
  const code = String(x.code || '').toLowerCase();
  const rest = normSearch([x.name, x.madeOf, x.phrase, x.categories, x.genSingular, x.genPlural, kind, ...Object.values(x).filter((v) => typeof v === 'string')].filter(Boolean).join(' '));
  return `${rest} ${code}`.trim();
}

// Группы меню (решение DICT 2026-10-25): серверные названия → понятные; порядок фиксирован
export const GROUP_NAME = { 'Склад и позиции': 'Склад и продукция', 'Люди и ФОТ': 'Люди и работа', 'Заявки и счета': 'Заявки и оплата', 'Паспорта': 'Документы (паспорта)' };
export const GROUP_ORDER = ['Склад и продукция', 'Люди и работа', 'Заявки и оплата', 'Документы (паспорта)'];
export const PASS_GROUP = 'Документы (паспорта)';
// Справочников паспортов 14 — одной лентой их приходилось вычитывать (жалоба владельца 2026-11-12). Делим по смыслу: о чём справочник.
export const PASS_SUBS = [
  ['Паспорта · что за изделие', ['passportCategories', 'passportKinds', 'passportElements', 'productFacets', 'productFacetValues']],
  ['Паспорта · части и материалы', ['passportParts', 'passportMaterials', 'passportSortament']],
  ['Паспорта · тексты и правила', ['passportPhrases', '__texts', 'passportInstall', 'passportDefects', 'passportStandards']],
  ['Паспорта · вид документа', ['passportStyle']],
];

export function menuGroups(groups) {
    const m = new Map();
    for (const g of groups) { const n = GROUP_NAME[g.group] || g.group; if (!m.has(n)) m.set(n, []); m.get(n).push(...g.items); }
    const rank = (n) => { const i = GROUP_ORDER.indexOf(n); return i < 0 ? 99 : i; };
    return [...m].map(([name, items]) => ({ name, items })).sort((a, b) => rank(a.name) - rank(b.name));
  }
