/**
 * Направление затрат заявки (решение пользователя 2026-10-20): куда пошла закупка — для аналитики денег.
 *   workshop — цех (производство), office — офис (в т.ч. другой город), smr — СМР (объект / субподряд, `costObject` — название),
 *   order — под заказ заказчика (`salesOrderId`).
 * Поле data-core (CRM его не читает). Не указано и есть заказ → «Заказы»; иначе при приёме по умолчанию — «Цех».
 */
export const COST_CENTERS = { workshop: 'Цех', office: 'Офис', smr: 'СМР', order: 'Заказы' } as const;
export type CostCenter = keyof typeof COST_CENTERS;
export const COST_CENTER_KEYS = Object.keys(COST_CENTERS) as CostCenter[];

export const DIRECT_COST_CENTERS = ['office', 'workshop', 'smr'] as const satisfies readonly CostCenter[];
export type DirectCostCenter = (typeof DIRECT_COST_CENTERS)[number];
export type DirectReceiptTarget =
  | { directOrderId: string; directCostCenter?: never; directCostObject?: never }
  | { directOrderId?: never; directCostCenter: DirectCostCenter; directCostObject?: string };

/** Подпись направления заявки (для сводки); нет данных — «Не указано». */
export function costCenterLabel(d: { costCenter?: unknown; salesOrderId?: unknown }): string {
  const k = String(d.costCenter ?? '') as CostCenter;
  if (COST_CENTERS[k]) return COST_CENTERS[k];
  return d.salesOrderId ? COST_CENTERS.order : 'Не указано';
}
