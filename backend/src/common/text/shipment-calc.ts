import type { OrderStage } from './order-key';

/** Расчёты по отгрузкам (чистые функции): остаток позиции и этап заказа. Склад не списывается. */
export interface ShipLine { incomeId: string; qty: number }
export interface RemainRow { incomeId: string; qty: number; shipped: number; left: number }

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Остаток по позициям: qty позиции − сумма отгруженного (отгрузки — только неудалённые). Позиции без qty остатка не имеют (left = 0). */
export function remaining(incomes: Array<{ id: string; qty?: number | null }>, shipments: Array<{ lines: ShipLine[] }>): RemainRow[] {
  const sent = new Map<string, number>();
  for (const s of shipments) for (const l of s.lines) sent.set(l.incomeId, (sent.get(l.incomeId) ?? 0) + Number(l.qty || 0));
  return incomes.map((i) => {
    const qty = Number(i.qty) > 0 ? Number(i.qty) : 0;
    const shipped = r3(sent.get(i.id) ?? 0);
    return { incomeId: i.id, qty, shipped, left: qty > 0 ? Math.max(0, r3(qty - shipped)) : 0 };
  });
}

/**
 * Этап заказа после изменения отгрузок. Закрытый и отменённый не трогаем. Нет отгрузок: «частично / отгружен» → «готов к отгрузке».
 * Есть отгрузки: остаток 0 по всем позициям с количеством → «отгружен», иначе «частично отгружен».
 */
export function stageAfterShipments(stage: OrderStage, rem: RemainRow[], shipmentCount: number): OrderStage {
  if (stage === 'closed' || stage === 'cancelled') return stage;
  if (shipmentCount === 0) return stage === 'partly' || stage === 'shipped' ? 'ready' : stage;
  const withQty = rem.filter((r) => r.qty > 0);
  return withQty.length > 0 && withQty.every((r) => r.left <= 0) ? 'shipped' : 'partly';
}
