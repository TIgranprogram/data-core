import { durationDays, isoDay, lastDay, loadByDay, scheduleSteps, spreadHours } from './work-schedule';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (r: { start: Date; end: Date }) => `${isoDay(r.start)}..${isoDay(r.end)}`;

describe('work-schedule: сроки плана позиции', () => {
  it('длительность: часы ÷ 8 вверх, минимум 1 день', () => {
    expect(durationDays(0)).toBe(1);
    expect(durationDays(8)).toBe(1);
    expect(durationDays(8.5)).toBe(2);
    expect(durationDays(24)).toBe(3);
  });

  it('выходные пропускаются: 3 дня с четверга — до понедельника', () => {
    expect(isoDay(lastDay(d('2026-11-05'), 3))).toBe('2026-11-09'); // чт, пт, пн
    expect(isoDay(lastDay(d('2026-11-07'), 1))).toBe('2026-11-09'); // суббота → понедельник
  });

  it('шаги одной части идут по порядку', () => {
    const r = scheduleSteps([
      { id: 'a', part: 'p1', hours: 16 }, // 2 дня
      { id: 'b', part: 'p1', hours: 8 },
    ], d('2026-11-02')); // пн
    expect(iso(r[0])).toBe('2026-11-02..2026-11-03');
    expect(iso(r[1])).toBe('2026-11-04..2026-11-04');
  });

  it('части идут параллельно, «Изделие целиком» — после самой поздней', () => {
    const r = scheduleSteps([
      { id: 'a', part: 'p1', hours: 24 }, // пн–ср
      { id: 'b', part: 'p2', hours: 8 }, // пн
      { id: 'c', part: null, hours: 8 },
    ], d('2026-11-02'));
    expect(iso(r[0])).toBe('2026-11-02..2026-11-04');
    expect(iso(r[1])).toBe('2026-11-02..2026-11-02');
    expect(iso(r[2])).toBe('2026-11-05..2026-11-05');
  });

  it('«Изделие целиком» без частей начинается с якоря; якорь на выходной сдвигается', () => {
    const r = scheduleSteps([{ id: 'c', part: null, hours: 8 }], d('2026-11-08')); // воскресенье
    expect(iso(r[0])).toBe('2026-11-09..2026-11-09');
  });

  it('ручной срок главнее, следующий шаг цепочки идёт после него', () => {
    const r = scheduleSteps([
      { id: 'a', part: 'p1', hours: 8, plan: { start: d('2026-11-10'), end: d('2026-11-11') } },
      { id: 'b', part: 'p1', hours: 8 },
    ], d('2026-11-02'));
    expect(r[0].manual).toBe(true);
    expect(iso(r[0])).toBe('2026-11-10..2026-11-11');
    expect(iso(r[1])).toBe('2026-11-12..2026-11-12');
  });

  it('часы делятся по рабочим дням, загрузка людей суммируется', () => {
    expect(spreadHours(d('2026-11-06'), d('2026-11-10'), 24)).toEqual([
      { date: '2026-11-06', hours: 8 }, { date: '2026-11-09', hours: 8 }, { date: '2026-11-10', hours: 8 },
    ]);
    const load = loadByDay([
      { assigneeId: 'w1', startAt: d('2026-11-02'), endAt: d('2026-11-02'), hours: 6 },
      { assigneeId: 'w1', startAt: d('2026-11-02'), endAt: d('2026-11-03'), hours: 8 },
      { assigneeId: null, startAt: d('2026-11-02'), endAt: d('2026-11-02'), hours: 8 },
    ]);
    expect(load).toEqual([{ personId: 'w1', date: '2026-11-02', hours: 10 }, { personId: 'w1', date: '2026-11-03', hours: 4 }]);
  });
});
