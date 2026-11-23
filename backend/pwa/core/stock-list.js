import { api, session, writeHooks } from './api.js';
import { loadZones, zoneNow } from './zone.js';

/**
 * Склад целиком (все позиции) — один общий список на всё приложение (ПР-1): один запрос, а не по запросу на каждый экран.
 * Вызывать ПО ДЕЙСТВИЮ (фокус поля выбора позиции, «Добавить строку», открытие «Фильтров»), а не при открытии экрана.
 * Кэш сбрасывается сам: любой не-GET запрос к /stock/ или /supply/ (приход, списание, правка позиции, заявка) и через 5 минут.
 */
const TTL = 5 * 60 * 1000;
let cached = null; let at = 0;
let owner = '', lookupOwner = '';
export const stockScopeKey = () => JSON.stringify(['id', 'role', 'baseRole', 'roleLabel', 'warehouseIds', 'stockCategoryIds', 'sections'].map(key => session.user?.[key]));

export function stockList() {
  if (owner !== stockScopeKey()) { owner = stockScopeKey(); cached = null; }
  if (!cached || Date.now() - at > TTL) {
    at = Date.now();
    const p = loadStockPages({ sort: 'name' });
    cached = p;
    p.catch(() => { if (cached === p) cached = null; }); // сбой сети — следующее действие попробует снова
  }
  return cached;
}

export const heldStockQuery = (zoneId) => ({ held: '1', ...(zoneId ? { zoneId } : {}) });
const heldLists = new Map();
export const resetHeldStock = () => heldLists.clear();

/** Та же выборка, что в «Остатках». Отдельный кэш для признаков и плиток каждой зоны. */
export const heldStockList = zoneId => scopedStockList(zoneId, true);
export const catalogueStockList = zoneId => scopedStockList(zoneId, false);
export const catalogueStockQuery = zoneId => ({ withParts: '0', ...(zoneId ? { zoneId } : {}) });
export async function loadStockPages(query = {}) {
  const items = [];
  for (let page = 1; ; page++) {
    const response = await api('/stock/items', { query: { ...query, limit: 1000, page } });
    items.push(...response.items);
    if (items.length >= response.total || !response.items.length) return items;
  }
}
async function scopedStockList(zoneId, held) {
  if (zoneId === undefined) {
    await loadZones().catch(() => []);
    zoneId = zoneNow();
  }
  const key = JSON.stringify([stockScopeKey(), zoneId, held]);
  const cached = heldLists.get(key);
  if (cached && Date.now() - cached.at <= TTL) return cached.promise;
  const promise = loadStockPages({ ...(held ? heldStockQuery(zoneId) : catalogueStockQuery(zoneId)), sort: 'name' });
  heldLists.set(key, { at: Date.now(), promise });
  promise.catch(() => { if (heldLists.get(key)?.promise === promise) heldLists.delete(key); });
  return promise;
}

/**
 * SK-8d: короткий список склада для поиска позиции из других разделов (заявка, состав изделия, «уже заказано»):
 * GET /stock/lookup — только id, materialId, name, article, unit, categoryName, quantity, free; открыт и для «Заявок», «Каталога».
 * Полный /stock/items — только в разделе «Склад» (stockList).
 */
let cachedLookup = null; let atLookup = 0;
export function stockLookup() {
  if (lookupOwner !== stockScopeKey()) { lookupOwner = stockScopeKey(); cachedLookup = null; }
  if (!cachedLookup || Date.now() - atLookup > TTL) {
    atLookup = Date.now();
    const p = api('/stock/lookup').then((r) => r.items || []);
    cachedLookup = p;
    p.catch(() => { if (cachedLookup === p) cachedLookup = null; });
  }
  return cachedLookup;
}

/** Сбросить кэш (после правок склада из других мест). */
export const resetStock = () => { cached = null; cachedLookup = null; resetHeldStock(); };

writeHooks.push((path) => { if (/^\/(stock|supply)\//.test(path)) resetStock(); });
writeHooks.push((path) => { if (/^\/(materials|stockzones|categories)(\/|$)/.test(path)) resetHeldStock(); });
// C022: data-changed больше не сбрасывает кэш — иначе ftLoad и смена склада снова качают 10 000 позиций.
// Свежесть после записи — writeHooks выше; принудительно: resetStock().
