/**
 * Строки оплаченного счёта для «Денег» (C084 B6): снимок на момент оплаты + корректировки после неё.
 * Снимок (`paymentSnapshot`) после оплаты не меняется, а правка суммы, добавление и снятие строки пишутся
 * в `paymentAdjustments` (с `requestIds`). Строка, затронутая корректировкой, берёт сумму из живой заявки;
 * убранная или отменённая — выпадает; добавленная после оплаты — входит. Чистая функция, без базы.
 */
export type SnapLine = Record<string, unknown>;
export interface Adjustment { at?: Date; requestIds?: unknown[] }
export interface LiveRequest { _id: unknown; invoiceId?: unknown; priceHint?: unknown; status?: unknown; deletedAt?: unknown; [k: string]: unknown }

/** Ids заявок, которые трогали корректировки после оплаты (до оплаты — не считаются: снимок их уже учёл). */
export function adjustedIds(snapshot: { paidAt?: Date } | undefined, adjustments: Adjustment[] | undefined): string[] {
  const paidAt = snapshot?.paidAt ? new Date(snapshot.paidAt).getTime() : 0;
  const ids = new Set<string>();
  for (const a of adjustments ?? []) {
    if (a.at && new Date(a.at).getTime() < paidAt) continue;
    for (const id of a.requestIds ?? []) ids.add(String(id));
  }
  return [...ids];
}

export function adjustedLines(invoiceId: unknown, snapshot: { paidAt?: Date; lines?: SnapLine[] } | undefined, adjustments: Adjustment[] | undefined, reqs: Map<string, LiveRequest>, invoiceNo?: unknown): SnapLine[] {
  const touched = new Set(adjustedIds(snapshot, adjustments));
  const live = (r: LiveRequest | undefined): r is LiveRequest => !!r && String(r.invoiceId) === String(invoiceId) && !r.deletedAt && r.status !== 'cancelled';
  const out: SnapLine[] = [];
  const seen = new Set<string>();
  for (const line of snapshot?.lines ?? []) {
    const id = String(line.requestId);
    seen.add(id);
    if (!touched.has(id)) { out.push(line); continue; }
    const r = reqs.get(id);
    if (live(r)) out.push({ ...line, lineAmount: Number(r.priceHint) || 0 });
  }
  for (const id of touched) {
    const r = reqs.get(id);
    if (seen.has(id) || !live(r)) continue;
    out.push({
      requestId: r._id, lineAmount: Number(r.priceHint) || 0,
      ...(r.companyId ? { companyId: r.companyId } : {}), ...(r.categoryId ? { categoryId: r.categoryId } : {}),
      ...(r.supplierId ? { supplierId: r.supplierId } : {}), ...(r.supplierName ? { supplierName: r.supplierName } : {}),
      ...(r.salesOrderId ? { salesOrderId: r.salesOrderId } : {}), ...(r.costCenter ? { costCenter: r.costCenter } : {}),
      ...(r.title ? { title: r.title } : {}), ...(r.num !== undefined ? { num: r.num } : {}),
      ...(invoiceNo ? { invoiceNo } : {}),
    });
  }
  return out;
}
