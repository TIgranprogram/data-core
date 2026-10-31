import { Types } from 'mongoose';
import { computePlan } from './work-plan';
import type { WorkStep } from './work-task.schema';

const a = new Types.ObjectId(), b = new Types.ObjectId();
const days = new Map([[String(a), 2], [String(b), 0.5]]);
const anchor = new Date('2026-11-02T10:00:00Z');
const d = (s: string) => new Date(s + 'T00:00:00Z');

describe('computePlan', () => {
  it('цепочка: шаги идут друг за другом, дни × количество', () => {
    const r: WorkStep[] = [{ workTypeId: a, name: 'A' }, { workTypeId: b, name: 'B' }];
    const p = computePlan(r, 3, days, anchor);
    expect(p[0]).toMatchObject({ start: d('2026-11-02'), end: d('2026-11-08'), days: 6, manual: false });
    expect(p[1]).toMatchObject({ start: d('2026-11-08'), days: 2 });
  });
  it('нет дней у вида работ или количества — минимум 1 день', () => {
    const p = computePlan([{ workTypeId: null, name: 'Изготовление' }], null, days, anchor);
    expect(p[0].days).toBe(1);
  });
  it('ручной шаг главнее, следующие сдвигаются за ним', () => {
    const r: WorkStep[] = [{ workTypeId: a, name: 'A', plan: { start: d('2026-11-10'), days: 4 } }, { workTypeId: a, name: 'B' }];
    const p = computePlan(r, 1, days, anchor);
    expect(p[0]).toMatchObject({ start: d('2026-11-10'), end: d('2026-11-14'), manual: true });
    expect(p[1]).toMatchObject({ start: d('2026-11-14'), days: 2, manual: false });
  });
});
