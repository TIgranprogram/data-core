import type { Connection, Types } from 'mongoose';

/** Коллекции действующего каталога, в чьих `composition[]` может стоять ссылка на запись справочника. */
export const COMPOSITION_OWNER_COLLECTIONS = ['products', 'productmodules'] as const;

/**
 * Защита удаления (T1): используется ли запись в составе изделий/модулей.
 * Смотрит только действующие коллекции каталога; legacy-коллекции удалённого CRM-домена
 * (orders, quotations, costcalculations, purchaseorders, boms, workers) намеренно не проверяются.
 * `extra` — дополнительные условия по старым полям связи (напр. `productModuleIds`) для конкретной коллекции.
 */
export async function isUsedInComposition(
  db: Connection,
  lineType: 'module' | 'material' | 'product',
  refId: Types.ObjectId,
  extra: Partial<Record<(typeof COMPOSITION_OWNER_COLLECTIONS)[number], Record<string, unknown>[]>> = {},
): Promise<boolean> {
  const hits = await Promise.all(
    COMPOSITION_OWNER_COLLECTIONS.map((name) =>
      db.collection(name).findOne(
        { $or: [{ composition: { $elemMatch: { lineType, refId } } }, ...(extra[name] ?? [])] },
        { projection: { _id: 1 } },
      ),
    ),
  );
  return hits.some(Boolean);
}
