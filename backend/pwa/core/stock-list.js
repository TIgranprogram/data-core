import { api, writeHooks } from './api.js';

/**
 * Склад целиком (все позиции) — один общий список на всё приложение (ПР-1): один запрос, а не по запросу на каждый экран.
 * Вызывать ПО ДЕЙСТВИЮ (фокус поля выбора позиции, «Добавить строку», открытие «Фильтров»), а не при открытии экрана.
 * Кэш сбрасывается сам: любой не-GET запрос к /stock/ или /supply/ (приход, списание, правка позиции, заявка) и через 5 минут.
 */
const TTL = 5 * 60 * 1000;
let cached = null; let at = 0;

export function stockList() {
  if (!cached || Date.now() - at > TTL) {
    at = Date.now();
    const p = api('/stock/items', { query: { limit: 10000, sort: 'name' } }).then((r) => r.items || []);
    cached = p;
    p.catch(() => { if (cached === p) cached = null; }); // сбой сети — следующее действие попробует снова
  }
  return cached;
}

/**
 * SK-8d: короткий список склада для поиска позиции из других разделов (заявка, состав изделия, «уже заказано»):
 * GET /stock/lookup — только id, materialId, name, article, unit, categoryName, quantity, free; открыт и для «Заявок», «Каталога».
 * Полный /stock/items — только в разделе «Склад» (stockList).
 */
let cachedLookup = null; let atLookup = 0;
export function stockLookup() {
  if (!cachedLookup || Date.now() - atLookup > TTL) {
    atLookup = Date.now();
    const p = api('/stock/lookup').then((r) => r.items || []);
    cachedLookup = p;
    p.catch(() => { if (cachedLookup === p) cachedLookup = null; });
  }
  return cachedLookup;
}

/** Сбросить кэш (после правок склада из других мест). */
export const resetStock = () => { cached = null; cachedLookup = null; };

writeHooks.push((path) => { if (/^\/(stock|supply)\//.test(path)) resetStock(); });
window.addEventListener('data-changed', resetStock); // изменение из другого экрана — следующий вызов возьмёт свежий склад
