/**
 * ФОТ (В-3): чистые расчёты без базы, покрыты юнит-тестами (payroll-calc.spec.ts).
 * Режим «на руки», налоги не считаются. Начисление = ставка × табель:
 *   почасовая — ставка × часы; оклад — ставка (при заполненных «дни / норма дней» — пропорционально отработанным).
 */
export const r2 = (n: number) => Math.round(n * 100) / 100;

export const PAY_KINDS = ['advance', 'salary', 'bonus', 'other'] as const;
export type PayKind = (typeof PAY_KINDS)[number];
export const PAY_KIND_LABEL: Record<PayKind, string> = { advance: 'Аванс', salary: 'Зарплата', bonus: 'Премия', other: 'Другое' };

export interface Timesheet { hours?: number | null; days?: number | null; normDays?: number | null }

/** Начислено за месяц. Почасовая без часов = 0; оклад без табеля = полный оклад. */
export function accrued(kind: string | null | undefined, rate: number | null | undefined, ts?: Timesheet | null): number {
  const rt = Number(rate);
  if (!(rt > 0)) return 0;
  if (kind === 'hour') return r2(rt * Math.max(0, Number(ts?.hours) || 0));
  const days = Number(ts?.days), norm = Number(ts?.normDays);
  if (days >= 0 && norm > 0 && ts?.days != null) return r2((rt * Math.min(days, norm)) / norm);
  return r2(rt);
}

/** Числа месяца из графика выплат: «10, 25» → [10, 25]. */
export function payoutDays(text: unknown): number[] {
  return [...new Set((String(text ?? '').match(/\d{1,2}/g) ?? []).map(Number).filter((d) => d >= 1 && d <= 31))].sort((a, b) => a - b);
}

/** Месяц ГГГГ-ММ → последний день месяца (число). */
export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Дата расчёта за месяц: последний день выплат графика в этом месяце (иначе конец месяца), ГГГГ-ММ-ДД. */
export function dueDate(month: string, days: number[]): string {
  const last = daysInMonth(month);
  const d = days.length ? Math.min(days[days.length - 1], last) : last;
  return `${month}-${String(d).padStart(2, '0')}`;
}

/** Месяцы ГГГГ-ММ от from до to включительно. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = new Date(from + '-01T00:00:00Z'); d.toISOString().slice(0, 7) <= to; d.setUTCMonth(d.getUTCMonth() + 1)) out.push(d.toISOString().slice(0, 7));
  return out;
}

export const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
