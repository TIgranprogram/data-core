import { COST_CENTER_LABELS, costCenterLabel } from '../../common/cost-center-label';

/**
 * Направление затрат заявки (решение пользователя 2026-10-20): куда пошла закупка — для аналитики денег.
 *   workshop — цех (производство), office — офис (в т.ч. другой город), smr — СМР (объект / субподряд, `costObject` — название),
 *   order — под заказ заказчика (`salesOrderId`).
 * Поле data-core (CRM его не читает). Не указано и есть заказ → «Заказы»; иначе при приёме по умолчанию — «Цех».
 * Подпись для сводки — `common/cost-center-label`. Здесь остаются коды прямой приёмки.
 */
export { costCenterLabel };
export const COST_CENTERS = COST_CENTER_LABELS;
export type CostCenter = keyof typeof COST_CENTERS;
export const COST_CENTER_KEYS = Object.keys(COST_CENTERS) as CostCenter[];

export const DIRECT_COST_CENTERS = ['office', 'workshop', 'smr'] as const satisfies readonly CostCenter[];
export type DirectCostCenter = (typeof DIRECT_COST_CENTERS)[number];
export type DirectReceiptTarget =
  | { directOrderId: string; directCostCenter?: never; directCostObject?: never }
  | { directOrderId?: never; directCostCenter: DirectCostCenter; directCostObject?: string };
