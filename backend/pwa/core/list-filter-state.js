import { parseFt } from './facets.js';

/** Выбранные фильтры и полный сброс: значение по умолчанию тоже считается отбором. */
export function listFilterState(L, P, view) {
  const filters = (L.filters || []).filter(f => !(view.gantt || view.board) || f.key !== 'status');
  const extraKeys = (L.extraKeys || []).filter(k => !(view.gallery && L.gallery.pathKeys?.includes(k)));
  const count = filters.filter(f => {
    const v = f.type === 'chips' ? (P[f.key] ?? f.defaultValue ?? '') : P[f.key];
    return v && v !== 'all';
  }).length + extraKeys.reduce((n, k) => n + (k === 'all' || !P[k] ? 0
    : k === 'ft' ? Object.values(parseFt(P.ft)).filter(Boolean).length : String(P[k]).split('|').filter(Boolean).length), 0);
  const clear = { q: undefined, page: undefined };
  for (const f of filters) clear[f.key] = f.type === 'chips' && f.defaultValue && f.defaultValue !== 'all' ? 'all' : undefined;
  for (const k of extraKeys) clear[k] = undefined;
  return { filters, count, clear };
}
