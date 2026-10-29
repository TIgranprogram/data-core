import type { Connection, Types } from 'mongoose';
import { summarizeLines, type OrderMatch } from './matching-rules';

/** Сводка сопоставления по договорам (одним запросом): orderId → {total, matched, unmatched[]}. Договор без позиций → total 0. */
export async function loadOrderMatches(db: NonNullable<Connection['db']>, orderIds: unknown[]): Promise<Map<string, OrderMatch>> {
  const out = new Map<string, OrderMatch>();
  for (const id of orderIds) out.set(String(id), { total: 0, matched: 0, unmatched: [] });
  if (!orderIds.length) return out;
  const rows = await db.collection('incomes').find({ orderId: { $in: orderIds as Types.ObjectId[] }, deletedAt: null }, { projection: { orderId: 1, title: 1, productId: 1, matchStatus: 1, lineNo: 1 } }).sort({ lineNo: 1, _id: 1 }).toArray();
  const by = new Map<string, Array<Record<string, unknown>>>();
  for (const r of rows) by.set(String(r.orderId), [...(by.get(String(r.orderId)) ?? []), r]);
  for (const [k, ls] of by) out.set(k, summarizeLines(ls));
  return out;
}
