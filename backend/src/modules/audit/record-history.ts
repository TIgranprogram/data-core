/**
 * История записи «было → стало» (TASKS И.1). Журнал пишет снимок записи ПОСЛЕ каждого изменения (`details.after`),
 * поэтому изменения поля считаем сравнением соседних снимков одной записи по времени. Первый снимок — «создано»
 * (или первое известное состояние) — без «было».
 */
export type Change = { field: string; from: unknown; to: unknown };

/** Служебные поля и вложенные списки — в истории не показываем. */
const IGNORE = new Set(['_id', 'id', '__v', 'updatedAt', 'updatedBy', 'createdAt', 'createdBy', 'editedInApp', 'syncHash', 'sheetKey', 'sheetSource',
  'photos', 'photoIds', 'photo', 'materialPhoto', 'lines', 'related', 'items', 'counts', 'stockMovements', 'supplyRequests', 'reservations', 'issues',
  'dictInfo', 'typeLabel', 'canCancel', 'deletedWithOrder', 'version', 'clientUid']);
/** Денежные поля — только деньги-ролям (как MoneyMaskInterceptor). */
export const MONEY_FIELDS = new Set(['priceHint', 'amount', 'amountManual', 'unitPrice', 'paidAmount', 'sum', 'salaryRate', 'price', 'total', 'paidDate', 'reportDate']);
/** Статусы позиций заказа, по которым видно оплату — в истории тоже только деньги-ролям (как MoneyMaskInterceptor). */
const PAY_STATUS = new Set(['paid', 'awaiting', 'noamount']);

/** Значение для показа: примитив, дата строкой, у объекта — его name/title; списки и прочие объекты — не сравниваем. */
export function simple(v: unknown): string | number | boolean | null | undefined {
  if (v === undefined || v === null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if (Array.isArray(v)) return undefined;
    const o = v as Record<string, unknown>;
    const n = o.name ?? o.title ?? o.label;
    return typeof n === 'string' ? n : undefined;
  }
  return v as string | number | boolean;
}

export function diffSnapshots(prev: Record<string, unknown> | null | undefined, next: Record<string, unknown> | null | undefined, canMoney = true): Change[] {
  if (!next) return [];
  const keys = new Set([...Object.keys(prev ?? {}), ...Object.keys(next)]);
  const out: Change[] = [];
  // есть русская подпись статуса — показываем её, а не код (requested → «Заказать»)
  const labelled = 'statusLabel' in next;
  for (const k of keys) {
    if (k === 'status' && labelled) continue;
    if (IGNORE.has(k) || (!canMoney && MONEY_FIELDS.has(k))) continue;
    const a = prev ? simple(prev[k]) : null, b = simple(next[k]);
    if (a === undefined || b === undefined) continue;
    if (!canMoney && k === 'status' && (PAY_STATUS.has(String(a)) || PAY_STATUS.has(String(b)))) continue;
    if (prev ? a !== b : b !== null && b !== false) out.push({ field: k, from: prev ? a : null, to: b });
  }
  return out;
}

/**
 * Записи журнала одной записи (сначала новые, как отдаёт журнал) → с `changes`; `first` — у самой ранней
 * (её `changes` — заполненные поля, «было» нет).
 */
export function withChanges<T extends { details?: unknown }>(itemsNewestFirst: T[], canMoney: boolean) {
  const asc = [...itemsNewestFirst].reverse();
  let prev: Record<string, unknown> | null = null;
  const res = asc.map((it, i) => {
    const det = it.details as { after?: Record<string, unknown>; before?: Record<string, unknown>; partial?: boolean } | undefined;
    const after = det?.after;
    const snap = after && typeof after === 'object' && !Array.isArray(after) ? after : null;
    // partial — запись только изменённых полей (чистка артикулов и т. п.): сравниваем эти поля, остальное берём из прошлого снимка
    const was = det?.partial ? Object.fromEntries(Object.keys(snap ?? {}).map((k) => [k, prev?.[k] ?? det.before?.[k] ?? null])) : prev;
    const changes = snap ? diffSnapshots(was, snap, canMoney) : [];
    if (snap) prev = det?.partial ? { ...(prev ?? {}), ...snap } : snap;
    return { ...it, changes, first: i === 0 };
  });
  return res.reverse();
}
