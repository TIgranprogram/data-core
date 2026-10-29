import { api } from '../core/api.js';

/*
 * Ленивые варианты из справочников для полей `type: 'combo'` с `load` (ui/form.js): грузятся при первом фокусе, кэш 60 с и сброс после правки справочника.
 * Сбой сети список не закрепляет — следующий фокус повторит.
 */
const cache = {};
// Кэш живёт 60 с: новое значение, добавленное другим человеком (или в другой вкладке), появится без перезагрузки.
const TTL = 60000;
let born = Date.now();
const fresh = () => { if (Date.now() - born > TTL) { resetDictOptions(); } return cache; };
/** Сбросить кэш вариантов — после правки справочника (вызывает lookups.reset). */
export function resetDictOptions() { for (const k of Object.keys(cache)) delete cache[k]; born = Date.now(); }
const byRu = (p, q) => p.localeCompare(q, 'ru', { numeric: true });

/** Названия значений справочника `key` (/dicts/<key>), по алфавиту; `filter(item)` — отсеять строки. */
export const dictNames = (key, { filter } = {}) => () => (fresh()[key + (filter ? ':f' : '')] ||= api('/dicts/' + key)
  .then((r) => (r.items || []).filter((x) => !filter || filter(x)).map((x) => x.name).filter(Boolean).sort(byRu))
  .catch(() => { delete cache[key + (filter ? ':f' : '')]; return []; }));

/** Сотрудники без уволенных: «Фамилия Имя Отчество»; значение — та же строка (подрядчика можно вписать своим). */
export const personNames = () => (fresh().persons ||= api('/dicts/persons')
  .then((r) => (r.items || []).filter((p) => p.status !== 'fired')
    .map((p) => ({ value: [p.lastName, p.firstName, p.patronymic].filter(Boolean).join(' ') || p.name, sub: p.position || '' }))
    .filter((p) => p.value).sort((p, q) => byRu(p.value, q.value)).map((p) => ({ value: p.value, label: p.value, sub: p.sub })))
  .catch(() => { delete cache.persons; return []; }));
