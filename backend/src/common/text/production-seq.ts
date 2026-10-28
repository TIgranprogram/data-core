import { Types, type Connection } from 'mongoose';

type Db = NonNullable<Connection['db']>;

/**
 * Сквозной № позиции по заказу производства: договоры с одним `productionNo` — один заказ.
 * Договоры идут по дате входа в заказ (`productionAddedAt`, нет — `createdAt`), внутри — по `lineNo`.
 * В БД не хранится, считается на лету.
 */
type Ord = { _id?: unknown; createdAt?: Date | null; productionAddedAt?: Date | null };
type Ln = { _id?: unknown; lineNo?: number | null; createdAt?: Date | null };

const ts = (d?: Date | null) => (d ? new Date(d).getTime() : 0);

/** Договоры по порядку входа в заказ (новые — в конец); не меняет исходный массив. */
export function sortOrdersByEntry<T extends Ord>(orders: T[]): T[] {
  return [...orders].sort((a, b) => ts(a.productionAddedAt ?? a.createdAt) - ts(b.productionAddedAt ?? b.createdAt) || String(a._id).localeCompare(String(b._id)));
}

/** Позиции договора в порядке карточки: lineNo (без номера — в конце), createdAt, _id. */
export function sortLines<T extends Ln>(lines: T[]): T[] {
  return [...lines].sort((a, b) => (a.lineNo ?? 1e9) - (b.lineNo ?? 1e9) || ts(a.createdAt) - ts(b.createdAt) || String(a._id).localeCompare(String(b._id)));
}

/** id позиции → сквозной № (1..N) по списку договоров одного заказа. */
export function numberLines(orders: Ord[], linesOf: (orderId: string) => Ln[]): Map<string, number> {
  const res = new Map<string, number>();
  let n = 0;
  for (const o of sortOrdersByEntry(orders)) for (const l of sortLines(linesOf(String(o._id)))) res.set(String(l._id), ++n);
  return res;
}

/**
 * Сквозные № для позиций заказов (по id договоров): id позиции → { seqNo, productionNo }.
 * Договоры без `productionNo` в результат не попадают — у них код позиции «№ договора-lineNo».
 */
export async function loadSeq(db: Db, orderIds: unknown[]): Promise<Map<string, { seqNo: number; productionNo: string }>> {
  const res = new Map<string, { seqNo: number; productionNo: string }>();
  if (!orderIds.length) return res;
  const ids = orderIds.map((x) => (x instanceof Types.ObjectId ? x : new Types.ObjectId(String(x))));
  const mine = await db.collection('salesorders').find({ _id: { $in: ids }, deletedAt: null, productionNo: { $nin: [null, ''] } }, { projection: { productionNo: 1 } }).toArray();
  const nos = [...new Set(mine.map((o) => String(o.productionNo)))];
  if (!nos.length) return res;
  const orders = await db.collection('salesorders').find({ productionNo: { $in: nos }, deletedAt: null }, { projection: { productionNo: 1, createdAt: 1, productionAddedAt: 1 } }).toArray();
  const lines = await db.collection('incomes').find({ orderId: { $in: orders.map((o) => o._id) }, deletedAt: null }, { projection: { orderId: 1, lineNo: 1, createdAt: 1 } }).toArray();
  const byOrder = new Map<string, Ln[]>();
  for (const l of lines) { const k = String(l.orderId); byOrder.set(k, [...(byOrder.get(k) ?? []), l as Ln]); }
  for (const no of nos) {
    const group = orders.filter((o) => o.productionNo === no);
    for (const [lineId, seqNo] of numberLines(group as Ord[], (oid) => byOrder.get(oid) ?? [])) res.set(lineId, { seqNo, productionNo: no });
  }
  return res;
}
