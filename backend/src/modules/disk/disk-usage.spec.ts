import { diskLevel, diskState, gb } from './disk-usage';

const G = 1024 ** 3;

describe('disk-usage (ДИ.1)', () => {
  it('уровень: до 80% — норма, >80 — жёлтый, >90 — красный', () => {
    expect(diskLevel(80)).toBe('ok');
    expect(diskLevel(80.1)).toBe('warn');
    expect(diskLevel(90.5)).toBe('danger');
  });

  it('занято / свободно / % без истории — без прогноза', () => {
    const s = diskState(100 * G, 63 * G, [], '2026-10-21');
    expect(s).toMatchObject({ usedBytes: 37 * G, freeBytes: 63 * G, usedPct: 37, level: 'ok', growthPerDay: null, daysLeft: null });
  });

  it('прогноз по самому старому снимку за 30 дней: +1 ГБ в день → 63 дня', () => {
    const hist = [
      { date: '2026-09-01', usedBytes: 1 * G, totalBytes: 100 * G }, // старше 30 дней — не берём
      { date: '2026-10-01', usedBytes: 17 * G, totalBytes: 100 * G },
      { date: '2026-10-11', usedBytes: 27 * G, totalBytes: 100 * G },
    ];
    const s = diskState(100 * G, 63 * G, hist, '2026-10-21');
    expect(s.historyDays).toBe(20);
    expect(s.growthPerDay).toBe(G);
    expect(s.daysLeft).toBe(63);
  });

  it('меньше 3 дней истории или место не растёт — прогноза нет', () => {
    expect(diskState(100 * G, 63 * G, [{ date: '2026-10-20', usedBytes: 30 * G, totalBytes: 100 * G }], '2026-10-21').growthPerDay).toBeNull();
    const s = diskState(100 * G, 63 * G, [{ date: '2026-10-01', usedBytes: 40 * G, totalBytes: 100 * G }], '2026-10-21');
    expect(s.growthPerDay).toBeLessThan(0);
    expect(s.daysLeft).toBeNull();
  });

  it('gb: по-русски, одна цифра после запятой', () => {
    expect(gb(1.25 * G)).toBe('1,3 ГБ');
  });
});
