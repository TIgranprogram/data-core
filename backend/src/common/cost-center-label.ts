/** Подпись направления затрат для сводки денег. Назначение при приёмке остаётся в supply. */
export const COST_CENTER_LABELS = { workshop: 'Цех', office: 'Офис', smr: 'СМР', order: 'Заказы' } as const;

/** Нет данных — «Не указано»; нет кода, но есть заказ — «Заказы». */
export function costCenterLabel(d: { costCenter?: unknown; salesOrderId?: unknown }): string {
  const k = String(d.costCenter ?? '') as keyof typeof COST_CENTER_LABELS;
  if (COST_CENTER_LABELS[k]) return COST_CENTER_LABELS[k];
  return d.salesOrderId ? COST_CENTER_LABELS.order : 'Не указано';
}
