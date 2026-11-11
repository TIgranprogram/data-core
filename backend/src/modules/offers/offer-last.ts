import { Types } from 'mongoose';

/** Строка, из которой выбираем «последнее КП» заказчику (C073). */
export interface LastOfferRow {
  _id?: unknown;
  number?: string;
  date?: Date | string | null;
  createdAt?: Date | string | null;
  status?: string;
  deletedAt?: Date | string | null;
  customer?: string;
  counterpartyId?: unknown;
  objectName?: string | null;
  delivery?: string | null;
  terms?: string | null;
  prepaymentPercent?: number | null;
  productionDays?: number | null;
  deliveryDays?: number | null;
  vatMode?: string | null;
  vatRate?: number | null;
  items?: Array<{ productId?: unknown; unitPrice?: number | null }>;
}

/** Название заказчика: без краевых и повторных пробелов, нижний регистр. */
export function offerCustomerKey(v: unknown): string {
  return String(v ?? '').replace(/\s+/g, ' ').trim().toLocaleLowerCase('ru-RU');
}

const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Точное название: лишние пробелы не мешают.
 * Регистр кириллицы — обе буквы в классе: у Mongo 4.4 флаг i по-русски ненадёжен.
 */
export function customerNameRegex(v: unknown): RegExp | null {
  const key = offerCustomerKey(v);
  if (!key) return null;
  const body = key.split(' ').map((word) => [...word].map((ch) => {
    const lo = ch.toLocaleLowerCase('ru-RU');
    const up = ch.toLocaleUpperCase('ru-RU');
    return lo === up ? reEsc(ch) : `[${reEsc(lo)}${reEsc(up)}]`;
  }).join('')).join('\\s+');
  return new RegExp(`^\\s*${body}\\s*$`);
}

const time = (v: unknown) => {
  const t = new Date(v as string).getTime();
  return Number.isFinite(t) ? t : 0;
};

const newestFirst = <T extends LastOfferRow>(rows: T[]) => [...rows].sort((a, b) => {
  const byDate = time(b.date) - time(a.date);
  if (byDate) return byDate;
  const byCreated = time(b.createdAt) - time(a.createdAt);
  if (byCreated) return byCreated;
  return String(b._id ?? '').localeCompare(String(a._id ?? ''));
});

/**
 * Последнее не отменённое и не удалённое КП.
 * Сначала любое с этим counterpartyId (даже если название другое), иначе точное название.
 * Отклонённое остаётся: «отменённое» — только статус cancelled.
 */
export function pickLastOffer<T extends LastOfferRow>(rows: T[], q: { customer?: string; counterpartyId?: string }): T | null {
  const alive = (rows || []).filter((r) => !r.deletedAt && r.status !== 'cancelled');
  const cid = String(q.counterpartyId || '').trim();
  if (cid && Types.ObjectId.isValid(cid)) {
    const hit = newestFirst(alive.filter((r) => String(r.counterpartyId || '') === cid))[0];
    if (hit) return hit;
  }
  const key = offerCustomerKey(q.customer);
  if (!key) return null;
  return newestFirst(alive.filter((r) => offerCustomerKey(r.customer) === key))[0] ?? null;
}

/** Ответ GET /offers/last. Цены — по изделию, при повторе берём последнюю строку. */
export function presentLastOffer(o: LastOfferRow) {
  const byProduct = new Map<string, number>();
  for (const i of o.items || []) {
    const id = i.productId ? String(i.productId) : '';
    if (!id || typeof i.unitPrice !== 'number') continue;
    byProduct.set(id, i.unitPrice);
  }
  return {
    offerId: String(o._id ?? ''),
    number: o.number ?? '',
    date: o.date ?? null,
    objectName: o.objectName ?? null,
    delivery: o.delivery ?? null,
    terms: o.terms ?? null,
    prepaymentPercent: o.prepaymentPercent ?? null,
    productionDays: o.productionDays ?? null,
    deliveryDays: o.deliveryDays ?? null,
    vatMode: o.vatMode ?? null,
    vatRate: o.vatRate ?? null,
    prices: [...byProduct.entries()].map(([productId, unitPrice]) => ({ productId, unitPrice })),
  };
}
