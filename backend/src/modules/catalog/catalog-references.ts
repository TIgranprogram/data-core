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

/**
 * Единая база (2026-10-18): CRM kppdf пишет в ту же БД, поэтому ссылки из его таблиц
 * (заказы, КП, калькуляции, BOM, закупки, работники) снова блокируют удаление справочника.
 * Фильтры — те же, что были в kppdf до чистки T1.
 */
export type CrmRefKind = 'material' | 'product' | 'module' | 'workType';

export const CRM_REFERENCES: Record<CrmRefKind, Array<[string, (id: Types.ObjectId) => Record<string, unknown>]>> = {
  material: [
    ['costcalculations', (id) => ({ 'materials.materialId': id })],
    ['purchaseorders', (id) => ({ 'items.materialId': id })],
  ],
  product: [
    ['orders', (id) => ({ 'items.productId': id })],
    ['quotations', (id) => ({ 'items.productId': id })],
    ['costcalculations', (id) => ({ productId: id })],
    ['boms', (id) => ({ productId: id })],
  ],
  module: [['boms', (id) => ({ 'components.productComponentId': id })]],
  workType: [
    ['costcalculations', (id) => ({ 'labor.workTypeId': id })],
    ['workers', (id) => ({ workTypeIds: id })],
  ],
};

export async function isUsedByCrm(db: Connection, kind: CrmRefKind, refId: Types.ObjectId): Promise<boolean> {
  const hits = await Promise.all(
    CRM_REFERENCES[kind].map(([name, filter]) => db.collection(name).findOne(filter(refId), { projection: { _id: 1 } })),
  );
  return hits.some(Boolean);
}
