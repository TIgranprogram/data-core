import { api } from '../core/api.js';

/*
 * Ленивые варианты из справочников для полей `type: 'combo'` с `load` (ui/form.js): грузятся при первом фокусе, кэш на сессию.
 * Сбой сети список не закрепляет — следующий фокус повторит.
 */
const cache = {};
const byRu = (p, q) => p.localeCompare(q, 'ru', { numeric: true });

/** Названия значений справочника `key` (/dicts/<key>), по алфавиту; `filter(item)` — отсеять строки. */
export const dictNames = (key, { filter } = {}) => () => (cache[key + (filter ? ':f' : '')] ||= api('/dicts/' + key)
  .then((r) => (r.items || []).filter((x) => !filter || filter(x)).map((x) => x.name).filter(Boolean).sort(byRu))
  .catch(() => { delete cache[key + (filter ? ':f' : '')]; return []; }));

/** Сотрудники без уволенных: «Фамилия Имя Отчество»; значение — та же строка (подрядчика можно вписать своим). */
export const personNames = () => (cache.persons ||= api('/dicts/persons')
  .then((r) => (r.items || []).filter((p) => p.status !== 'fired')
    .map((p) => ({ value: [p.lastName, p.firstName, p.patronymic].filter(Boolean).join(' ') || p.name, sub: p.position || '' }))
    .filter((p) => p.value).sort((p, q) => byRu(p.value, q.value)).map((p) => ({ value: p.value, label: p.value, sub: p.sub })))
  .catch(() => { delete cache.persons; return []; }));
