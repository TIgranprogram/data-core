import { api } from '../core/api.js';

/* Виды работ из справочника (кэш на минуту). Редактор «Части и работы» — sections/work-composition.js. */
let typesP = null, typesAt = 0;
/** Виды работ из справочника: [{ value, label }], один запрос на минуту. */
export const workTypes = () => {
  if (!typesP || Date.now() - typesAt > 60000) {
    typesAt = Date.now();
    typesP = api('/dicts/worktypes').then((r) => (r.items || []).map((x) => ({ value: String(x.id), label: x.name || '' })).filter((x) => x.label).sort((a, b) => a.label.localeCompare(b.label, 'ru'))).catch(() => { typesP = null; return []; });
  }
  return typesP;
};
