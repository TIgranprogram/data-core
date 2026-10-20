/**
 * Русские статусы (как в Google-таблице и в приложении «Склад · Снабжение») ↔ статусы CRM.
 * В CRM «оплачено» — отдельный флаг `paid`, а не статус.
 */
export type CrmSupplyStatus = 'in_progress' | 'requested' | 'ordered' | 'received' | 'cancelled';
export type CrmPriority = 'urgent' | 'normal' | 'low';

export const SUPPLY_STATUS_LABELS = ['⏳ Ожидает', '✅ Заказать', '⚙️ В работе', '💰 Оплачено', '☑️ Получено', '❌ Отменено'] as const;

/** Подпись → { status, paid }. Неизвестная подпись → undefined (статус не меняем). */
export function statusFromLabel(label: unknown): { status: CrmSupplyStatus; paid?: boolean } | undefined {
  const s = String(label ?? '').toLowerCase();
  if (!s.trim()) return undefined;
  if (s.includes('ожида')) return { status: 'in_progress' };
  if (s.includes('заказ')) return { status: 'requested' };
  if (s.includes('в работе')) return { status: 'ordered' };
  if (s.includes('оплач')) return { status: 'ordered', paid: true };
  if (s.includes('получ')) return { status: 'received' };
  if (s.includes('отмен')) return { status: 'cancelled' };
  return undefined;
}

/** { status, paid } → подпись для приложения/таблицы. */
export function labelFromStatus(status: string | undefined, paid?: boolean): string {
  switch (status) {
    case 'in_progress': return '⏳ Ожидает';
    case 'requested': return '✅ Заказать';
    case 'ordered': return paid ? '💰 Оплачено' : '⚙️ В работе';
    case 'received': return '☑️ Получено';
    case 'cancelled': return '❌ Отменено';
    default: return '✅ Заказать';
  }
}

export function priorityFromLabel(label: unknown): CrmPriority | undefined {
  const s = String(label ?? '').toLowerCase();
  if (!s.trim()) return undefined;
  if (s.includes('сроч')) return 'urgent';
  if (s.includes('низк')) return 'low';
  return 'normal';
}

export function labelFromPriority(p: string | undefined): string {
  return p === 'urgent' ? 'Срочно' : p === 'low' ? 'Низко' : 'Обычный';
}
