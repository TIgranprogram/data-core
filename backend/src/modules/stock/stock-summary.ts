import type { Types } from 'mongoose';
import { foldPurchases, NO_SUPPLIER, type ReceivedRow } from './purchase-history';

/** Чистые расчёты сводки позиции (`GET /materials/:id/summary`): без базы, всё в памяти — легко проверить. */

export interface RequestRow extends ReceivedRow {
  _id?: Types.ObjectId;
  num?: number | null;
  status?: string;
  paid?: boolean;
  createdAt?: Date | null;
}
export interface OfferRow {
  supplierId?: Types.ObjectId | null;
  priceHint?: number | null;
  priceDate?: Date | null;
  priceHistory?: { price?: number; date?: Date }[];
}
export interface OutRow { date?: Date | null; qty?: number; salesOrderId?: Types.ObjectId | null; salesOrderLineId?: Types.ObjectId | null }
export interface CustomerFact { orderId: string; customer: string; qty: number }

type NameOf = (id: Types.ObjectId) => string | undefined;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;
const time = (d?: Date | null) => (d ? new Date(d).getTime() : 0);

/** Дата закупки: получена → счёт → заявка (как в `foldPurchases`). */
export const purchaseDate = (g: ReceivedRow): Date | null => g.receivedAt ?? g.invoiceDate ?? g.requestDate ?? null;
/** Дата заявки: заявка → счёт → создана. */
export const requestDateOf = (r: RequestRow): Date | null => r.requestDate ?? r.invoiceDate ?? r.createdAt ?? null;

/** Цена за единицу из суммы заявки (priceHint — сумма); нет цены или количества — null. */
export function unitPriceOf(g: ReceivedRow, canMoney: boolean): number | null {
  const qty = Number(g.qty), sum = Number(g.priceHint);
  return canMoney && sum > 0 && qty > 0 ? round2(sum / qty) : null;
}

export interface SupplierStat {
  supplierId: string | null; name: string; count: number; totalQty: number;
  firstDate: Date | null; lastDate: Date | null; lastPrice: number | null; minPrice: number | null; maxPrice: number | null;
}

/** Все, кто поставлял (полученные заявки), и предложения каталога без закупок (count 0). Порядок: чаще, затем свежее. */
export function buildSuppliers(got: ReceivedRow[], offers: OfferRow[], nameOf: NameOf, canMoney: boolean): SupplierStat[] {
  const stat = new Map<string, { qty: number; first: Date | null; min: number | null; max: number | null }>();
  for (const g of got) {
    const name = (g.supplierId && nameOf(g.supplierId)) || NO_SUPPLIER;
    const s = stat.get(name) ?? { qty: 0, first: null, min: null, max: null };
    const d = purchaseDate(g), p = unitPriceOf(g, canMoney);
    s.qty += Number(g.qty) > 0 ? Number(g.qty) : 0;
    if (d && (!s.first || time(d) < time(s.first))) s.first = d;
    if (p != null) { s.min = s.min == null ? p : Math.min(s.min, p); s.max = s.max == null ? p : Math.max(s.max, p); }
    stat.set(name, s);
  }
  const out: SupplierStat[] = foldPurchases(got, nameOf, canMoney).map((f) => {
    const s = stat.get(f.name)!;
    return { supplierId: f.supplierId ? String(f.supplierId) : null, name: f.name, count: f.count, totalQty: round3(s.qty), firstDate: s.first, lastDate: f.lastDate,
      lastPrice: f.lastPrice, minPrice: s.min, maxPrice: s.max };
  });
  const have = new Set(out.map((s) => s.name));
  const fresh = new Map<string, SupplierStat>(); // предложения без закупок: по одному на поставщика, свежая цена
  for (const o of offers) {
    const name = o.supplierId && nameOf(o.supplierId);
    if (!name || have.has(name)) continue;
    const price = canMoney && Number(o.priceHint) > 0 ? round2(Number(o.priceHint)) : null;
    const cur = fresh.get(name);
    if (cur && time(cur.lastDate) >= time(o.priceDate)) continue;
    fresh.set(name, { supplierId: String(o.supplierId), name, count: 0, totalQty: 0, firstDate: null, lastDate: o.priceDate ?? null, lastPrice: price, minPrice: price, maxPrice: price });
  }
  return [...out, ...[...fresh.values()].sort((a, b) => time(b.lastDate) - time(a.lastDate) || a.name.localeCompare(b.name, 'ru'))];
}

export interface PricePoint { date: Date | null; price: number | null; supplierName: string | null; source: 'purchase' | 'catalog' }

/** История цен: закупки (цена за ед.) + записи каталога; по дате по возрастанию, последние `limit`. */
export function buildPrices(got: ReceivedRow[], offers: OfferRow[], nameOf: NameOf, canMoney: boolean, limit = 50): PricePoint[] {
  const nm = (id?: Types.ObjectId | null) => (id && nameOf(id)) || null;
  const rows: PricePoint[] = [];
  for (const g of got) {
    const price = unitPriceOf(g, canMoney);
    if (canMoney && price == null) continue; // без цены точка на графике не нужна
    rows.push({ date: purchaseDate(g), price, supplierName: nm(g.supplierId) ?? NO_SUPPLIER, source: 'purchase' });
  }
  for (const o of offers) {
    for (const h of o.priceHistory ?? []) {
      if (!(Number(h.price) > 0)) continue;
      rows.push({ date: h.date ?? null, price: canMoney ? round2(Number(h.price)) : null, supplierName: nm(o.supplierId), source: 'catalog' });
    }
  }
  rows.sort((a, b) => time(a.date) - time(b.date));
  return rows.slice(-limit);
}

/** Последние 12 месяцев (включая текущий), от старого к новому: 'YYYY-MM'. */
export function lastMonths(now: Date, n = 12): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
const monthOf = (d: Date) => { const x = new Date(d); return `${x.getUTCFullYear()}-${String(x.getUTCMonth() + 1).padStart(2, '0')}`; };

export interface MonthPoint { month: string; ordered: number; received: number; issued: number }

/** Помесячно: заказано (заявки, кроме отменённых), получено, выдано. Вне 12 месяцев — не считается. */
export function buildMonthly(now: Date, requests: RequestRow[], outs: OutRow[]): MonthPoint[] {
  const by = new Map(lastMonths(now).map((m) => [m, { month: m, ordered: 0, received: 0, issued: 0 }]));
  const add = (d: Date | null | undefined, key: 'ordered' | 'received' | 'issued', qty: unknown) => {
    const p = d ? by.get(monthOf(d)) : undefined;
    if (p && Number(qty) > 0) p[key] += Number(qty);
  };
  for (const r of requests) {
    if (r.status === 'cancelled') continue;
    add(requestDateOf(r), 'ordered', r.qty);
    if (r.status === 'received') add(purchaseDate(r), 'received', r.qty);
  }
  for (const o of outs) add(o.date, 'issued', o.qty);
  return [...by.values()].map((p) => ({ month: p.month, ordered: round3(p.ordered), received: round3(p.received), issued: round3(p.issued) }));
}

/** Топ заказчиков по выданному и зарезервированному количеству: имя, сколько, на скольких заказах. */
export function topCustomers(facts: CustomerFact[], limit = 10): { name: string; qty: number; orders: number }[] {
  const by = new Map<string, { qty: number; orders: Set<string> }>();
  for (const f of facts) {
    if (!(f.qty > 0)) continue;
    const c = by.get(f.customer) ?? { qty: 0, orders: new Set<string>() };
    c.qty += f.qty; c.orders.add(f.orderId);
    by.set(f.customer, c);
  }
  return [...by.entries()].map(([name, c]) => ({ name, qty: round3(c.qty), orders: c.orders.size }))
    .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name, 'ru')).slice(0, limit);
}

export const REQUEST_LABEL: Record<string, string> = { in_progress: 'Ожидает', requested: 'Заказать', ordered: 'В работе', received: 'Получено', cancelled: 'Отменено' };
export const requestLabel = (r: { status?: string; paid?: boolean }) => (r.status === 'ordered' && r.paid ? 'Оплачено' : REQUEST_LABEL[r.status ?? ''] ?? r.status ?? '');
