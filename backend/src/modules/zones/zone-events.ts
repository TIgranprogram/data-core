import type { Connection } from 'mongoose';
import { ACTIVE_STAGES } from '../../common/text/order-key';

/** СВ-11: события пустых зон. Окна защиты от повтора (дни) и порог срока. */
export const RESERVATION_DUE_DAYS = 1; // бронь: срок ≤ сегодня + 1 день (сегодня, завтра, просрочено)
export const RESERVATION_DEDUPE_DAYS = 1;
export const LOW_STOCK_DEDUPE_DAYS = 7;
export const PASSPORT_DUE_DAYS = 3; // заказ без паспорта: отгрузка в пределах 3 дней вперёд или просрочена
export const PASSPORT_DEDUPE_DAYS = 3;
export const INCOME_NO_CONTRACT_DEDUPE_DAYS = Infinity; // один раз на позицию

const DAY = 24 * 3600 * 1000;

export type Notify = (zone: string, n: { type: string; text: string; href?: string }, dedupeDays: number) => Promise<unknown>;
type Db = NonNullable<Connection['db']>;
type Doc = Record<string, unknown>;

const ddmm = (d: Date) => `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
/** Срок раньше начала сегодняшнего дня. */
const isLate = (d: Date, now: Date) => d < new Date(now.toISOString().slice(0, 10));
const num = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;

/** «Без договора»: у позиции нет заказа или у заказа пуст № договора. */
export function noContract(order: Doc | null | undefined): boolean {
  return !order || !String(order.contractNo ?? '').trim();
}

/** Текст события «поступление без договора». */
export function incomeNoContractText(amount: number, customer?: string): string {
  const sum = amount > 0 ? `${num(amount)} ₽` : 'без суммы';
  return `Поступление ${sum} от ${customer?.trim() || 'заказчик не указан'} без договора — привяжите к заказу или укажите № договора`;
}

/** 1. Склад: бронь к выдаче (срок = expiresAt, иначе shipDate активного заказа). */
export async function scanReservations(db: Db, notify: Notify, now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() + RESERVATION_DUE_DAYS * DAY);
  const rows = (await db.collection('reservations').find({ status: 'active', qty: { $gt: 0 }, deletedAt: null }).limit(2000).toArray()) as Doc[];
  const orderIds = [...new Set(rows.map((r) => r.salesOrderId).filter(Boolean).map(String))];
  const orders = orderIds.length ? ((await db.collection('salesorders').find({ _id: { $in: rows.map((r) => r.salesOrderId).filter(Boolean) as never[] }, deletedAt: null }).toArray()) as Doc[]) : [];
  const byId = new Map(orders.map((o) => [String(o._id), o]));
  let n = 0;
  for (const r of rows) {
    const order = r.salesOrderId ? byId.get(String(r.salesOrderId)) : undefined;
    if (order && !(ACTIVE_STAGES as string[]).includes(String(order.stage))) continue;
    const due = (r.expiresAt ?? order?.shipDate) as Date | undefined;
    if (!due || new Date(due).getTime() > limit.getTime()) continue;
    const late = isLate(new Date(due), now);
    const what = String(r.groupName ?? '').trim() || String(r.zoneName ?? '').trim() || 'материал';
    const ord = order ? ` — заказ ${String(order.orderNo ?? '')}` : '';
    const text = `${late ? 'Просрочена выдача по брони' : 'Пора выдать по брони'}: ${what}${ord}, срок ${ddmm(new Date(due))}`;
    await notify('stock', { type: 'reservation_due', text, href: order ? `#salesorders?open=${String(order._id)}` : '#stock' }, RESERVATION_DEDUPE_DAYS);
    n++;
  }
  return n;
}

/** 2. Склад: свободный остаток ≤ минимума (минимум задан; в открытой заявке снабжения — не шлём). */
export async function scanLowStock(db: Db, notify: Notify): Promise<number> {
  const items = (await db.collection('storageitems').find({ isActive: { $ne: false }, minQuantity: { $gt: 0 }, deletedAt: null }).limit(5000).toArray()) as Doc[];
  const low = items.filter((i) => num(i.quantity) - num(i.reservedQty) <= num(i.minQuantity));
  if (!low.length) return 0;
  const mids = low.map((i) => i.materialId).filter(Boolean) as never[];
  const open = mids.length ? ((await db.collection('supplyrequests').find({ materialId: { $in: mids }, status: { $nin: ['received', 'cancelled'] }, deletedAt: null }, { projection: { materialId: 1 } }).toArray()) as Doc[]) : [];
  const inRequest = new Set(open.map((x) => String(x.materialId)));
  const mats = mids.length ? ((await db.collection('materials').find({ _id: { $in: mids } }, { projection: { name: 1, unit: 1 } }).toArray()) as Doc[]) : [];
  const mat = new Map(mats.map((m) => [String(m._id), m]));
  let n = 0;
  for (const i of low) {
    if (i.materialId && inRequest.has(String(i.materialId))) continue;
    const m = i.materialId ? mat.get(String(i.materialId)) : undefined;
    const name = String(i.name ?? m?.name ?? 'позиция');
    const unit = String(m?.unit ?? 'шт.');
    const text = `Остаток ниже минимума: ${name} — свободно ${num(num(i.quantity) - num(i.reservedQty))} ${unit}, минимум ${num(i.minQuantity)}`;
    await notify('stock', { type: 'stock_below_min', text, href: `#stock?open=${String(i._id)}` }, LOW_STOCK_DEDUPE_DAYS);
    n++;
  }
  return n;
}

/** 4. Паспорта: заказ скоро в отгрузку (или просрочен), изделия есть, выпущенных паспортов нет. */
export async function scanPassports(db: Db, notify: Notify, now = new Date()): Promise<number> {
  const limit = new Date(now.getTime() + PASSPORT_DUE_DAYS * DAY);
  const orders = (await db.collection('salesorders').find({ deletedAt: null, stage: { $in: ACTIVE_STAGES }, shipDate: { $ne: null, $lte: limit } }).limit(2000).toArray()) as Doc[];
  let n = 0;
  for (const o of orders) {
    const hasItems = await db.collection('incomes').findOne({ orderId: o._id, deletedAt: null, productId: { $ne: null }, matchStatus: { $ne: 'none' } }, { projection: { _id: 1 } });
    if (!hasItems) continue;
    const issued = await db.collection('productpassports').findOne({ salesOrderId: o._id, status: 'issued', deletedAt: null }, { projection: { _id: 1 } });
    if (issued) continue;
    const ship = new Date(o.shipDate as Date);
    const late = isLate(ship, now);
    const no = String(o.orderNo ?? '');
    const text = late ? `Срок отгрузки заказа ${no} прошёл (${ddmm(ship)}), а паспортов нет — выпустите` : `Заказ ${no} уходит в отгрузку ${ddmm(ship)}, а паспортов нет — выпустите`;
    await notify('passports', { type: 'passport_missing', text, href: `#salesorders?open=${String(o._id)}` }, PASSPORT_DEDUPE_DAYS);
    n++;
  }
  return n;
}
