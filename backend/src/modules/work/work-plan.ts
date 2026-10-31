import type { WorkStep } from './work-task.schema';

const DAY = 86_400_000;
const dayStart = (d: Date) => new Date(Math.floor(d.getTime() / DAY) * DAY);

export interface PlanStep { stepIndex: number; workType: string; start: Date; end: Date; days: number; manual: boolean }

/**
 * План шагов для Ганта: шаги идут цепочкой от якоря (запуск или сегодня).
 * Длительность по умолчанию = дни вида работ × количество (вверх, минимум 1); ручной `route[i].plan` главнее, цепочка идёт после него.
 */
export function computePlan(route: WorkStep[], qty: number | null, daysByType: Map<string, number>, anchor: Date): PlanStep[] {
  const q = qty && qty > 0 ? qty : 1;
  let cursor = dayStart(anchor);
  return route.map((s, i) => {
    const manual = !!s.plan;
    const base = Math.max(1, Math.ceil((daysByType.get(String(s.workTypeId)) ?? 1) * q));
    const days = s.plan?.days ?? base;
    const start = s.plan?.start ? dayStart(new Date(s.plan.start)) : cursor;
    const end = new Date(start.getTime() + days * DAY);
    cursor = end;
    return { stepIndex: i, workType: s.name, start, end, days, manual };
  });
}
