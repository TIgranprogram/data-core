import type { Types } from 'mongoose';

/** Полученная заявка — то, что нужно для «у кого брали и почём». */
export interface ReceivedRow {
  materialId?: Types.ObjectId | null;
  qty?: number;
  priceHint?: number;
  supplierId?: Types.ObjectId | null;
  receivedAt?: Date | null;
  invoiceDate?: Date | null;
  requestDate?: Date | null;
}

export interface PurchaseSupplier {
  name: string;
  supplierId: Types.ObjectId | null;
  count: number;
  lastDate: Date | null;
  lastPrice: number | null;
  lastQty: number | null;
}

export const NO_SUPPLIER = 'Поставщик не указан';

/**
 * Поставщики материала по полученным заявкам (строки — от свежих к старым): сколько раз брали,
 * когда, сколько, почём за единицу (priceHint заявки — сумма). Порядок: чаще, затем свежее.
 * Один источник для «Заказано» позиции (`items/:id/ordered`) и заявок пачкой.
 */
export function foldPurchases(got: ReceivedRow[], nameOf: (id: Types.ObjectId) => string | undefined, canMoney = true): PurchaseSupplier[] {
  const sup = new Map<string, PurchaseSupplier>();
  for (const g of got) {
    const name = (g.supplierId && nameOf(g.supplierId)) || NO_SUPPLIER;
    const s = sup.get(name) ?? { name, supplierId: null, count: 0, lastDate: null, lastPrice: null, lastQty: null };
    s.count++;
    if (s.count === 1) {
      const qty = Number(g.qty), sum = Number(g.priceHint);
      s.supplierId = g.supplierId ?? null;
      s.lastDate = g.receivedAt ?? g.invoiceDate ?? g.requestDate ?? null;
      s.lastQty = qty > 0 ? qty : null;
      s.lastPrice = canMoney && sum > 0 && qty > 0 ? Math.round((sum / qty) * 100) / 100 : null;
    }
    sup.set(name, s);
  }
  return [...sup.values()].sort((a, b) => b.count - a.count || new Date(b.lastDate ?? 0).getTime() - new Date(a.lastDate ?? 0).getTime());
}

/** Поставщик для новой заявки: самый частый и свежий из настоящих (не «не указан»). */
export const topSupplier = (list: PurchaseSupplier[]): PurchaseSupplier | undefined => list.find((s) => s.supplierId);
