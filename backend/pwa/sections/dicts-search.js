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
