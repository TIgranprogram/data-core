import { api, writeHooks } from './api.js';

/**
 * SK-8d: короткий список заказов для соседних разделов (выдача «под заказ», заявка «под заказ», паспорт «№ заказа»):
 * GET /salesorders/lookup?filter=active|all&lines=1 → [{ id, orderNo, customer, title, stage, shipDate, lines?: [{ id, lineNo, title, qty, productId }] }],
 * без денег; открыт для «Заказов», «Склада», «Заявок», «Паспортов». Полный /salesorders — только в разделе «Заказы».
 *
 */
const TTL = 60000;
const cache = new Map(); // ключ filter|lines → { p, at }

export function ordersLookup({ filter = 'active', lines = false } = {}) {
  const key = filter + '|' + (lines ? 1 : 0);
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.p;
  const p = api('/salesorders/lookup', { query: { filter, lines: lines ? 1 : undefined } })
    .then((r) => r.items || []);
  cache.set(key, { p, at: Date.now() });
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key); });
  return p;
}

/** Сбросить кэш (после правки заказа). */
export const resetOrdersLookup = () => cache.clear();
writeHooks.push((path) => { if (/^\/(salesorders|incomes)(\/|$)/.test(path)) resetOrdersLookup(); });
