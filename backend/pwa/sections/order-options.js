import { ordersLookup } from '../core/orders-lookup.js';

export const hasProductionNumber = (row) => Boolean(String(row?.productionNo ?? '').trim());
export const seq = (l, i) => l.seqNo ?? l.lineNo ?? i + 1;
export const prodNo = (r) => r?.productionNo || 'нет №';
export const heading = (r) => hasProductionNumber(r) ? `Заказ № ${r.productionNo}` : `Договор № ${r?.orderNos?.[0] || r?.orderNo || '—'}`;

/** Выбор заказа и позиции (для заявок и списаний, З.6): заказы в работе. Кэш на 1 минуту (core/orders-lookup.js). */
// SK-8d: короткий список (/salesorders/lookup) — открыт и для «Склада», «Заявок»; кэш — в core/orders-lookup.js
export const activeOrders = () => ordersLookup({ filter: 'active' });
export const orderLabel = (o) => [hasProductionNumber(o) ? `№ ${prodNo(o)}` : heading(o), hasProductionNumber(o) && o.orderNo && `договор ${o.orderNo}`, o.customer].filter(Boolean).join(' · ');

/** Варианты «Заказ / позиция» для выпадающего списка (З.6): «id» — весь заказ, «id:lineId» — позиция. */
export async function orderOptions(keep) {
  // SK-8d: заказы в работе сразу с позициями — без /incomes?limit=3000 (раздел «Позиции и оплаты» может быть закрыт)
  const orders = await ordersLookup({ filter: 'active', lines: true });
  const opts = [];
  for (const o of orders) {
    opts.push({ value: o.id, label: orderLabel(o) + ' — весь заказ' });
    for (const l of o.lines || []) opts.push({ value: o.id + ':' + l.id, label: `   └ ${seq(l, -1) ? seq(l, -1) + '. ' : ''}${String(l.title || '').slice(0, 70)}` });
  }
  if (keep && !opts.some((x) => x.value === keep)) opts.unshift({ value: keep, label: 'Заказ (выполнен или удалён)' });
  return opts;
}
export const splitRef = (ref) => { const [o, l] = String(ref || '').split(':'); return { salesOrderId: o || '', salesOrderLineId: l || '' }; };
export const joinRef = (r) => (r.salesOrderId ? String(r.salesOrderId) + (r.salesOrderLineId ? ':' + String(r.salesOrderLineId) : '') : '');
