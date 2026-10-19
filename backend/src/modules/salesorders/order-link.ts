import { Types, type Connection } from 'mongoose';
import { orderKey } from './order-key';

type Doc = Record<string, unknown>;

/** Поля шапки, которые продублированы в позициях (incomes) как кэш. */
export const ORDER_CACHE_FIELDS = ['orderNo', 'customer', 'companyId', 'paymentForm', 'shipDate'] as const;

/**
 * Найти шапку заказа по ключу «компания|номер» или создать (TASKS З.2: лист «Заказы»).
 * Атомарно (upsert по уникальному importKey) — повторный прогон не создаёт дублей.
 * Существующую шапку не меняет: её поля — истина, лист только дописывает позиции.
 */
export async function findOrCreateOrder(
  connection: Connection,
  p: { company: string; orderNo: string; companyId?: Types.ObjectId; customer?: string; paymentForm?: string; shipDate?: Date; source: string },
): Promise<Doc> {
  const importKey = orderKey(p.company, p.orderNo);
  const now = new Date();
  const insert: Doc = {
    orderNo: p.orderNo, companyId: p.companyId, customer: p.customer, paymentForm: p.paymentForm, shipDate: p.shipDate,
    stage: 'new', importKey, source: p.source, deletedAt: null, createdAt: now, updatedAt: now,
  };
  for (const k of Object.keys(insert)) if (insert[k] === undefined) delete insert[k];
  const coll = connection.db!.collection('salesorders');
  try {
    const r = await coll.findOneAndUpdate({ importKey }, { $setOnInsert: insert }, { upsert: true, returnDocument: 'after', includeResultMetadata: false });
    return r as Doc;
  } catch (e) {
    // гонка двух вставок с одним ключом: уникальный индекс отбил вторую — берём первую
    if ((e as { code?: number }).code === 11000) return (await coll.findOne({ importKey })) as Doc;
    throw e;
  }
}
