import { Types } from 'mongoose';

type Doc = Record<string, unknown>;

/** Виды работ сотрудника: новое `workTypeIds[]`; нет — старое одиночное `workTypeId` как первое (и единственное) значение. */
export function personWorkTypeIds(p: Doc): Types.ObjectId[] {
  const many = (p.workTypeIds as Types.ObjectId[] | undefined) ?? [];
  if (many.length) return many;
  return p.workTypeId ? [p.workTypeId as Types.ObjectId] : [];
}

/**
 * Запись видов работ сотрудника из тела запроса: массив id (повторы и мусор отбрасываются).
 * Старое `workTypeId` пишется синхронно — первый вид работ (CRM читает его); пустой список очищает оба поля.
 */
export function workTypeFields(ids: unknown): { workTypeIds: Types.ObjectId[] | null; workTypeId: Types.ObjectId | null } {
  const list = (Array.isArray(ids) ? ids : String(ids ?? '').split(','))
    .map((v) => String(v).trim()).filter((v) => Types.ObjectId.isValid(v));
  const uniq = [...new Set(list)].map((v) => new Types.ObjectId(v));
  return uniq.length ? { workTypeIds: uniq, workTypeId: uniq[0] } : { workTypeIds: null, workTypeId: null };
}
