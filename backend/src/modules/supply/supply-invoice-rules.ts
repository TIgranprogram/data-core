/**
 * Счета поставщиков: ворота этапов и деление суммы (чистые функции, без базы).
 * Таблица ворот совпадает с GATES в `backend/pwa/sections/request-step.js` — менять синхронно.
 */
const has = (v: unknown) => !!String(v ?? '').trim();

export interface GateField { key: string; label: string; ok: (r: Record<string, unknown>) => boolean }

/** Ворота «Заказал у поставщика» — по заявке. */
export const ORDERED_GATE: GateField[] = [
  { key: 'supplierName', label: 'Поставщик', ok: (r) => !!r.supplierId || has(r.supplierName) },
  { key: 'qty', label: 'Количество', ok: (r) => Number(r.qty) > 0 },
  { key: 'unit', label: 'Единица измерения', ok: (r) => has(r.unit) },
];

/** Ворота «Счёт выставлен» — по счёту. */
export const ISSUED_GATE: GateField[] = [
  { key: 'no', label: '№ счёта', ok: (i) => has(i.no) },
  { key: 'date', label: 'Дата счёта', ok: (i) => !!i.date },
  { key: 'amount', label: 'Сумма счёта', ok: (i) => Number(i.amount) > 0 },
];

/** Названия недостающих полей. */
export const missing = (gate: GateField[], obj: Record<string, unknown>) => gate.filter((f) => !f.ok(obj)).map((f) => f.label);

/**
 * Разделить сумму счёта по строкам пропорционально весам (lineTotal, иначе priceHint).
 * Считаем в копейках; остаток копеек уходит последней строке. Все веса нулевые — делим поровну.
 */
export function splitAmount(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (!n) return [];
  const cents = Math.round(total * 100);
  const w = weights.map((x) => (x > 0 ? x : 0));
  const sum = w.reduce((s, x) => s + x, 0);
  const eq = sum <= 0;
  const out: number[] = [];
  let used = 0;
  for (let i = 0; i < n - 1; i++) {
    const part = Math.floor(eq ? cents / n : (cents * w[i]) / sum);
    out.push(part); used += part;
  }
  out.push(cents - used);
  return out.map((c) => c / 100);
}

/** № счёта для сравнения: регистр, ё/е, «№», «No», пробелы. Копия в scripts/invoices-from-requests.js — менять синхронно. */
export const normInvoiceNo = (s: unknown): string =>
  String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[№#]|\bн[оo]\.?\s/g, '').replace(/\s+/g, '').trim();
