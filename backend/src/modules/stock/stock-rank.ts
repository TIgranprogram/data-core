/** Свободно к выдаче: остаток минус бронь, но не меньше нуля (брони больше остатка → 0, не минус). */
export function freeQty(quantity: number, reservedQty: number): number {
  return Math.max(0, (quantity || 0) - (reservedQty || 0));
}

/**
 * Очерёдность для режима `priority=1` («внимание сверху»): 0 — заканчивается, 1 — есть в брони, 2 — остальное.
 * «Заканчивается» — то же правило, что у статуса `low` в списке остатков (свободно меньше порога minQuantity).
 */
export function attentionRank(r: { status: string; reservedQty: number }): number {
  if (r.status === 'low') return 0;
  return r.reservedQty > 0 ? 1 : 2;
}
