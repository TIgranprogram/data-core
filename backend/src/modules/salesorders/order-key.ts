/**
 * Ключи заказа заказчика (TASKS З.1–З.3). Номера заказов уникальны только внутри нашей компании
 * (№2, 10, 12, 14 есть и у СИЮ, и у ССЮ), поэтому ключ — «компания|номер».
 * То же правило повторено в scripts/import-orders-xlsx.js (скрипт без сборки) — менять синхронно.
 */

/** Этапы заказа: Новый → В производстве → Готов к отгрузке → Отгружен → Закрыт (+ Отменён). */
export const ORDER_STAGES = ['new', 'production', 'ready', 'shipped', 'closed', 'cancelled'] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];
export const STAGE_LABELS: Record<OrderStage, string> = {
  new: 'Новый', production: 'В производстве', ready: 'Готов к отгрузке', shipped: 'Отгружен', closed: 'Закрыт', cancelled: 'Отменён',
};
/** «В работе» — до отгрузки; «выполненные» — отгружен или закрыт. Отменённые не входят ни туда, ни туда. */
export const ACTIVE_STAGES: OrderStage[] = ['new', 'production', 'ready'];
export const DONE_STAGES: OrderStage[] = ['shipped', 'closed'];

/** Номер заказа: без «№», пробелы схлопнуты, верхний регистр («№11 Крыловская» → «11 КРЫЛОВСКАЯ»). */
export function normOrderNo(v: unknown): string {
  return String(v ?? '').replace(/№/g, ' ').replace(/\s+/g, ' ').trim().toUpperCase();
}

/** Ключ заказа «СИЮ|34». Компания — короткое имя нашей компании (или как в файле, если компания не наша). */
export function orderKey(company: unknown, orderNo: unknown): string {
  return `${String(company ?? '').replace(/\s+/g, ' ').trim().toUpperCase()}|${normOrderNo(orderNo)}`;
}

/** Наименование позиции для сравнения: регистр и пробелы не важны. */
export function normTitle(v: unknown): string {
  return String(v ?? '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}
