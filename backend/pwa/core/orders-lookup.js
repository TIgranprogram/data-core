import { api, writeHooks } from './api.js';

/**
 * SK-8d: короткий список заказов для соседних разделов (выдача «под заказ», заявка «под заказ», паспорт «№ заказа»):
 * GET /salesorders/lookup?filter=active|all&lines=1 → [{ id, orderNo, customer, title, stage, shipDate, lines?: [{ id, lineNo, title, qty, productId }] }],
 * без денег; открыт для «Заказов», «Склада», «Заявок», «Паспортов». Полный /salesorders — только в разделе «Заказы».
 * Сервер ещё без lookup (404) — прежние запросы (/salesorders + /incomes для позиций). Кэш на 1 минуту, сбой — не кэшируется.
 */
const TTL = 60000;
const cache = new Map(); // ключ filter|lines → { p, at }

export function ordersLookup({ filter = 'active', lines = false } = {}) {
  const key = filter + '|' + (lines ? 1 : 0);
  const c = cache.get(key);
  if (c && Date.now() - c.at < TTL) return c.p;
  const p = api('/salesorders/lookup', { query: { filter, lines: lines ? 1 : undefined } })
    .then((r) => r.items || [], (e) => { if (e?.status === 404) return fallback(filter, lines); throw e; });
  cache.set(key, { p, at: Date.now() });
  p.catch(() => { if (cache.get(key)?.p === p) cache.delete(key); });
  return p;
}

/** Сбросить кэш (после правки заказа). */
export const resetOrdersLookup = () => cache.clear();
writeHooks.push((path) => { if (/^\/(salesorders|incomes)(\/|$)/.test(path)) resetOrdersLookup(); });

async function fallback(filter, lines) {
  const query = filter === 'active' ? { filter: 'active', limit: 500, sort: 'orderNo' } : { limit: 500, sort: '-createdAt' };
  const [orders, rows] = await Promise.all([
    api('/salesorders', { query }).then((r) => r.items || []),
    lines ? api('/incomes', { query: { limit: 3000, sort: 'lineNo' } }).then((r) => r.items || []).catch(() => []) : [],
  ]);
  if (!lines) return orders;
  const byOrder = new Map();
  for (const l of rows) if (l.orderId) { const k = String(l.orderId); if (!byOrder.has(k)) byOrder.set(k, []); byOrder.get(k).push({ id: l.id, lineNo: l.lineNo, title: l.title, qty: l.qty, productId: l.productId }); }
  return orders.map((o) => ({ ...o, lines: byOrder.get(String(o.id)) || [] }));
}
