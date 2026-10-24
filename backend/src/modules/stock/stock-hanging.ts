import type { mongo } from 'mongoose';
import { Types } from 'mongoose';

/** Этапы заказа, после которых бронь под него уже не нужна (SK-6, СК-6). */
const DONE_STAGES: Record<string, string> = { shipped: 'Заказ отгружен', closed: 'Заказ закрыт', cancelled: 'Заказ аннулирован' };

/**
 * «Висящая» бронь (СК-6): заказ отгружен, закрыт, аннулирован или удалён. Вычисляется при чтении, в БД не хранится;
 * бронь сама не снимается — снимает человек. Возвращает причину по-русски или null.
 */
export function hangingReason(order: Record<string, unknown> | null | undefined, orderId?: unknown): string | null {
  if (!orderId) return null; // бронь без заказа не бывает «висящей»
  if (!order || order.deletedAt) return 'Заказ удалён';
  return DONE_STAGES[String(order.stage ?? '')] ?? null;
}

/** Причины «висящих» броней по заказам: один запрос на все заказы. orderId (строкой) → причина; живые заказы в карту не попадают. */
export async function loadHanging(db: mongo.Db, orderIds: Types.ObjectId[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Map(orderIds.filter(Boolean).map((i) => [String(i), i])).values()];
  if (!ids.length) return out;
  const orders = await db.collection('salesorders').find({ _id: { $in: ids } }, { projection: { stage: 1, deletedAt: 1 } }).toArray();
  const byId = new Map(orders.map((o) => [String(o._id), o]));
  for (const id of ids) {
    const why = hangingReason(byId.get(String(id)), id);
    if (why) out.set(String(id), why);
  }
  return out;
}

/** Сколько в «висящих» бронях по позициям склада (для «Остатков»): materialId → количество. Два запроса, только на переданные позиции. */
export async function hangingQtyByMaterial(db: mongo.Db, materialIds: Types.ObjectId[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!materialIds.length) return out;
  const rs = await db.collection('reservations').find({ materialId: { $in: materialIds }, status: 'active', deletedAt: null, salesOrderId: { $type: 'objectId' } },
    { projection: { materialId: 1, salesOrderId: 1, qty: 1 } }).toArray();
  const why = await loadHanging(db, rs.map((r) => r.salesOrderId as Types.ObjectId));
  for (const r of rs) if (why.has(String(r.salesOrderId))) out.set(String(r.materialId), Math.round(((out.get(String(r.materialId)) ?? 0) + (Number(r.qty) || 0)) * 1000) / 1000);
  return out;
}
