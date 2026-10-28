import { accrued, dueDate, monthsBetween, payoutDays } from './payroll-calc';

describe('ФОТ: расчёты (В-3)', () => {
  it('почасовая = ставка × часы; без часов 0', () => {
    expect(accrued('hour', 350.5, { hours: 160 })).toBe(56080);
    expect(accrued('hour', 350, null)).toBe(0);
  });
  it('оклад: без табеля — полный; дни/норма — пропорционально; переработка не больше оклада', () => {
    expect(accrued('month', 60000, null)).toBe(60000);
    expect(accrued('month', 60000, { days: 10, normDays: 20 })).toBe(30000);
    expect(accrued('month', 60000, { days: 25, normDays: 20 })).toBe(60000);
  });
  it('нет ставки — 0', () => {
    expect(accrued('month', null, { days: 5, normDays: 20 })).toBe(0);
  });
  it('график выплат: числа, дата расчёта (последний день выплат, не позже конца месяца)', () => {
    expect(payoutDays('10, 25 числа')).toEqual([10, 25]);
    expect(dueDate('2026-10', [10, 25])).toBe('2026-10-25');
    expect(dueDate('2026-02', [31])).toBe('2026-02-28');
    expect(dueDate('2026-10', [])).toBe('2026-10-31');
  });
  it('месяцы между', () => {
    expect(monthsBetween('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
  });
});
