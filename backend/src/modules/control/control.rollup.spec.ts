import { diskHistoryToMetrics, isDay, isMonth, monthOf, rollupMonth, ymd } from './control.rollup';

describe('CC-12: свёртка месяца', () => {
  it('min/max/avg/last/n; null не считается и не превращается в 0', () => {
    const r = rollupMonth([
      { _id: '2026-10-03', m: { a: 30, b: null } },
      { _id: '2026-10-01', m: { a: 10, b: null } },
      { _id: '2026-10-02', m: { a: null, b: null } },
    ]);
    expect(r.a).toEqual({ min: 10, max: 30, avg: 20, last: 30, n: 2 });
    expect(r.b).toBeUndefined();
  });

  it('last — значение самого позднего дня, даже если дни пришли вразброс', () => {
    const r = rollupMonth([{ _id: '2026-10-05', m: { a: 5 } }, { _id: '2026-10-02', m: { a: 9 } }]);
    expect(r.a.last).toBe(5);
  });

  it('даты: форматы и месяц', () => {
    expect(ymd(new Date(2026, 9, 5))).toBe('2026-10-05');
    expect(monthOf('2026-10-05')).toBe('2026-10');
    expect(isDay('2026-10-05')).toBe(true);
    expect(isDay('2026-10')).toBe(false);
    expect(isMonth('2026-10')).toBe(true);
    expect(isMonth('26-10')).toBe(false);
  });

  it('disk_usage_history → процент и байты; пустое/нулевой том → ничего', () => {
    expect(diskHistoryToMetrics({ usedBytes: 50, totalBytes: 200 })).toEqual({ 'storage.disk_used_bytes': 50, 'storage.disk_used_pct': 25 });
    expect(diskHistoryToMetrics({ usedBytes: 5, totalBytes: 0 })).toEqual({});
    expect(diskHistoryToMetrics({})).toEqual({});
  });
});
