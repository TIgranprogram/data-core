import { parseSheetDate } from './date-parse';

const iso = (d: Date | undefined) => d?.toISOString().slice(0, 10);

describe('parseSheetDate — дата счёта из таблицы', () => {
  it('дд.мм.гггг и дд.мм.гг', () => {
    expect(iso(parseSheetDate('21.08.2026'))).toBe('2026-08-21');
    expect(iso(parseSheetDate('1.9.2026'))).toBe('2026-09-01');
    expect(iso(parseSheetDate('07.09.26'))).toBe('2026-09-07');
    expect(iso(parseSheetDate(' 07/09/2026 '))).toBe('2026-09-07');
  });
  it('ГГГГ-ММ-ДД и ISO со временем', () => {
    expect(iso(parseSheetDate('2026-08-21'))).toBe('2026-08-21');
    expect(iso(parseSheetDate('2026-10-19T15:30:00Z'))).toBe('2026-10-19');
  });
  it('число-дата Google (дни от 30.12.1899)', () => {
    expect(iso(parseSheetDate(46255))).toBe('2026-08-21');
    expect(iso(parseSheetDate('46255'))).toBe('2026-08-21');
  });
  it('Date', () => {
    expect(iso(parseSheetDate(new Date(Date.UTC(2026, 9, 19, 12))))).toBe('2026-10-19');
  });
  it('мусор, пустое и несуществующие даты → undefined', () => {
    for (const v of ['', null, undefined, 'вчера', 'счёт 105306', '31.02.2026', '2026-13-01', '00.00.0000', 12, 104770.89, NaN, new Date('x')]) {
      expect(parseSheetDate(v)).toBeUndefined();
    }
  });
});
