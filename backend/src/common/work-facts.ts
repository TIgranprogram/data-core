import { DAY_HOURS } from './work-schedule';

/**
 * Чистые расчёты C041 Э3: нормы учатся сами, сроки и себестоимость считаются из факта.
 * Без базы — их проверяют юнитом (`common/work-facts.spec.ts`).
 */

/** Округление до копеек/сотых часов. */
export const r2 = (v: number) => Math.round(v * 100) / 100;

/** Медиана чисел; пусто — null. Чётное число значений — среднее двух средних (как «медиана последних 5»). */
export function median(values: number[]): number | null {
  const a = values.filter((v) => Number.isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return r2(a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2);
}

/** Часы на 1 шт: факт ÷ количество позиции (не меньше единицы, чтобы не делить на 0). */
export const perUnit = (hours: number, qty: number): number => r2(hours / Math.max(1, Number(qty) || 1));

/** Дни из часов: часов ÷ 8, одна десятая. */
export const daysFromHours = (hours: number): number => Math.round((hours / DAY_HOURS) * 10) / 10;

/** Итог нормы в изделии: сумма часов маршрута; пусто — null. */
export function normSum(values: Array<number | null | undefined>): number | null {
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  return nums.length ? r2(nums.reduce((s, v) => s + v, 0)) : null;
}

/** Ставка часа: у почасового сотрудника — своя; иначе ставка вида работ; нет обеих — null (Q4). */
export function hourRate(person: { salaryKind?: string | null; salaryRate?: number | null } | null | undefined, workTypeRate?: number | null): { rate: number | null; source: 'person' | 'worktype' | null } {
  if (person && person.salaryKind === 'hour' && Number(person.salaryRate) > 0) return { rate: Number(person.salaryRate), source: 'person' };
  if (Number(workTypeRate) > 0) return { rate: Number(workTypeRate), source: 'worktype' };
  return { rate: null, source: null };
}
