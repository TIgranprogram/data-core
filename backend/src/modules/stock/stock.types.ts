import type { Types } from 'mongoose';
import type { Dims } from './metal';
import type { ByWeight } from './weight';

export type MoveType = 'in' | 'out' | 'adjust' | 'reserve' | 'unreserve' | 'count';

export interface StockItemInput {
  name?: string;
  unit?: string;
  article?: string;
  categoryId?: string;
  categoryName?: string;
  minQuantity?: number;
  weightKg?: number;
  /** Вес 1 шт., г (НО): пишется в weightKg (кг) с пометкой weightUnit 'kg'; null — стереть. */
  weightG?: number | null;
  notes?: string;
  fullName?: string; // ДМ.2
  invoiceName?: string;
  /** Металл (СМ.1): сортамент / сечение, марка стали, размеры в мм (null — стереть). */
  assortment?: string | null;
  washed?: boolean | null;
  materialGrade?: string | null;
  dims?: Dims;
}

export interface MoveInput {
  type: MoveType;
  /** Количество (> 0); для adjust — изменение со знаком. */
  qty: number;
  note?: string;
  clientUid?: string;
  documentRef?: string;
  /** Служебное: это движение отменяет движение с этим id. */
  cancelOf?: Types.ObjectId;
  /** Списание: кому выдано (TASKS Л.3) — сотрудник и/или текстом. */
  personId?: string;
  issuedTo?: string;
  /** Выдача под заказ / позицию заказа (SK-5): позиция без заказа — заказ берёт сервер. */
  salesOrderId?: string;
  salesOrderLineId?: string;
  /** Списание (SK-5): причина из справочника «Причины списания»; writeOff — это списание, причина обязательна. */
  reason?: string;
  writeOff?: boolean;
  /** Возврат со сборки (SK-5): приход под позицию заказа. */
  isReturn?: boolean;
  /** Пересчёт (ФИ.4): остаток, который видел человек, — разошёлся с сервером → 409 «обновите». */
  expected?: number;
  /** Пересчёт / корректировка ниже брони — только с явным подтверждением. */
  force?: boolean;
  /** Количество по весу (НО): приход / пересчёт; штуки считает сервер, вес 1 шт. может сохранить в позицию. */
  byWeight?: ByWeight & { saveUnitWeight?: boolean };
}

/**
 * Пересчёт (TASKS ФИ.4): проверки до записи. «Сколько лежит» — ВСЕГО, вместе с бронью (бронь лежит на складе).
 * Меньше 0 — нельзя; меньше брони — только с force (иначе свободно станет минусом).
 */
export function countGuard(target: number, current: number, reserved: number, force?: boolean): string | null {
  if (!Number.isFinite(target) || target < 0) return 'Остаток не может быть меньше 0';
  if (target < reserved && !force) return `Меньше, чем в брони (${reserved}): свободно станет ${Math.round((target - reserved) * 1000) / 1000}. Сначала снимите или выдайте бронь — или подтвердите`;
  return null;
}

/** Поля, по которым можно сортировать позиции склада. */
export const ITEM_SORT = ['name', 'categoryName', 'unit', 'article', 'quantity', 'reservedQty', 'free', 'minQuantity', 'status', 'updatedAt', 'deletedAt', 'lastCountedAt'];
export const MOVE_LABEL: Record<string, string> = { in: 'Приход', out: 'Списание', adjust: 'Корректировка', transfer: 'Перемещение' };
