import { api } from '../core/api.js';

/*
 * Ленивые варианты из справочников для полей `type: 'combo'` с `load` (ui/form.js): грузятся при первом фокусе, кэш 60 с и сброс после правки справочника.
 * Сбой сети список не закрепляет — следующий фокус повторит.
 */
const cache = {};
// Кэш живёт 60 с: новое значение, добавленное другим человеком (или в другой вкладке), появится без перезагрузки.
const TTL = 60000;
let born = Date.now();
const fresh = () => { if (Date.now() - born > TTL) { for (const k of Object.keys(cache)) delete cache[k]; born = Date.now(); } return cache; };
/** Сбросить кэш вариантов — после правки справочника (вызывает lookups.reset). */
export function resetDictOptions() { for (const k of Object.keys(cache)) delete cache[k]; born = Date.now(); lsClear(); }

/*
 * Кэш в браузере (localStorage, ключи dca_dict:<key>): открытие экрана — сразу из него; старше 60 с — в фоне обновляется
 * (виден при следующем открытии); старше 10 мин — не используется. Сброс: resetDictOptions (после правки справочника) и выход (session.clear).
 */
const LS = 'dca_dict:'; const LS_MAX = 10 * 60000;
function lsClear() { try { Object.keys(localStorage).filter((k) => k.startsWith(LS)).forEach((k) => localStorage.removeItem(k)); } catch { /* приватный режим */ } }
function lsGet(key) { try { const v = JSON.parse(localStorage.getItem(LS + key) || 'null'); return v && Date.now() - v.t < LS_MAX ? v : null; } catch { return null; } }
function lsSet(key, items) { try { localStorage.setItem(LS + key, JSON.stringify({ t: Date.now(), items })); } catch { /* квота */ } }
async function dictItems(key) {
  const hit = lsGet(key);
  const load = () => api('/dicts/' + key).then((r) => { const items = r.items || []; lsSet(key, items); return items; });
  if (!hit) return load();
  if (Date.now() - hit.t > TTL) load().catch(() => {});
  return hit.items;
}
const byRu = (p, q) => p.localeCompare(q, 'ru', { numeric: true });

/** Названия значений справочника `key` (/dicts/<key>), по алфавиту; `filter(item)` — отсеять строки. */
export const dictNames = (key, { filter } = {}) => () => (fresh()[key + (filter ? ':f' : '')] ||= dictItems(key)
  .then((items) => items.filter((x) => !filter || filter(x)).map((x) => x.name).filter(Boolean).sort(byRu))
  .catch(() => { delete cache[key + (filter ? ':f' : '')]; return []; }));

/** Сотрудники без уволенных: «Фамилия Имя Отчество»; значение — та же строка (подрядчика можно вписать своим). */
export const personNames = () => (fresh().persons ||= dictItems('persons')
  .then((items) => items.filter((p) => p.status !== 'fired')
    .map((p) => ({ value: [p.lastName, p.firstName, p.patronymic].filter(Boolean).join(' ') || p.name, sub: p.position || '' }))
    .filter((p) => p.value).sort((p, q) => byRu(p.value, q.value)).map((p) => ({ value: p.value, label: p.value, sub: p.sub })))
  .catch(() => { delete cache.persons; return []; }));
