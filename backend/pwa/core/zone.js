import { api, session } from './api.js';

/**
 * Выбранный склад (WAREHOUSE-ZONES): список доступных — GET /stock/zones; выбор запоминается на устройстве
 * (ключ dc-stock-zone-<id пользователя>, без «/»; в uiPrefs сервера нового ключа нет).
 * Один склад или ни одного — переключатель скрыт, zoneQuery() пуст (сервер сам ограничивает по роли).
 * zoneQuery() — готовая часть query для складских запросов экрана: GET /stock/items, lookup, categories, movements, reservations.
 */
const key = () => 'dc-stock-zone-' + (session.user?.id || 'u');
const read = () => { try { return localStorage.getItem(key()) || ''; } catch { return ''; } };
let list = null; let cur = ''; let promise = null; let owner = ''; let at = 0;
const TTL = 60000; // склады переименовали или поменяли категории — через минуту новый список без «Обновить страницу»

export function loadZones() {
  const me = String(session.user?.id || '');
  if (owner !== me) { owner = me; list = null; cur = ''; promise = null; }
  if (promise && Date.now() - at > TTL) promise = null;
  if (!promise) at = Date.now();
  promise ??= api('/stock/zones').then((r) => {
    list = r.items || [];
    if (list.length < 2) cur = '';
    else { const saved = read(); cur = (list.find((z) => z.id === saved) || list.find((z) => z.isDefault) || list[0]).id; }
    return list;
  }).catch((e) => { promise = null; throw e; });
  return promise;
}

/** Выбранный склад ('' — не ограничивать). До загрузки списка — последний запомненный. */
export const zoneNow = () => (list ? cur : read());
/** Категории выбранного склада (Set id) — для воронки признаков; основной — всё, что не отмечено у других; '' или список не загружен — null (без ограничения). */
export function zoneCats() {
  const id = zoneNow(); if (!id || !list) return null;
  const z = list.find((x) => x.id === id); if (!z) return null;
  if (!z.isDefault) return new Set(z.categoryIds || []);
  const others = new Set(list.filter((x) => x !== z).flatMap((x) => x.categoryIds || []));
  return { has: (c) => !others.has(c) };
}
export const zoneQuery = () => { const id = zoneNow(); return id ? { zoneId: id } : {}; };

export function setZone(id) {
  cur = String(id);
  try { localStorage.setItem(key(), cur); } catch { /* приватный режим — до перезагрузки */ }
}
