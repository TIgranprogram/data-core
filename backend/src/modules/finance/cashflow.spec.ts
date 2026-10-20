import { buildCashflow, buildSummary, daysBetween, type Op } from './cashflow';
import { incomeDerived } from '../incomes/income.schema';

const op = (type: Op['type'], date: string, amount: number, company = 'СИЮ', extra: Partial<Op> = {}): Op => ({ type, id: date + amount, date, amount, company, title: 'x', ...extra });

describe('Платёжный календарь (ОДР)', () => {
  it('дни периода включительно, со сменой месяца', () => {
    expect(daysBetween('2026-09-29', '2026-10-02')).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('остаток переносится между днями: closing = opening + income − expense', () => {
    const { days, totals } = buildCashflow([op('income', '2026-10-01', 1000), op('expense', '2026-10-01', 300), op('expense', '2026-10-03', 900.5)], '2026-10-01', '2026-10-04', 500, ['СИЮ', 'ССЮ']);
    expect(days.map((d) => [d.date, d.opening, d.income, d.expense, d.closing])).toEqual([
      ['2026-10-01', 500, 1000, 300, 1200],
      ['2026-10-02', 1200, 0, 0, 1200],
      ['2026-10-03', 1200, 0, 900.5, 299.5],
      ['2026-10-04', 299.5, 0, 0, 299.5],
    ]);
    expect(totals).toMatchObject({ opening: 500, income: 1000, expense: 1200.5, closing: 299.5 });
  });

  it('разбивка по компаниям', () => {
    const { days, totals } = buildCashflow([op('expense', '2026-10-01', 100, 'СИЮ'), op('expense', '2026-10-01', 40, 'ССЮ'), op('income', '2026-10-01', 70, 'ССЮ')], '2026-10-01', '2026-10-01', 0, ['СИЮ', 'ССЮ']);
    expect(days[0]).toMatchObject({ expense: 140, income: 70, expenseBy: { СИЮ: 100, ССЮ: 40 }, incomeBy: { СИЮ: 0, ССЮ: 70 }, closing: -70 });
    expect(totals.expenseBy).toEqual({ СИЮ: 100, ССЮ: 40 });
  });

  it('без суммы и вне периода — не считается; копейки не теряются', () => {
    const { totals, days } = buildCashflow([op('expense', '2026-10-01', 0), op('expense', '2026-09-30', 50), op('expense', '2026-10-02', 0.1), op('expense', '2026-10-02', 0.2)], '2026-10-01', '2026-10-02', 0, ['СИЮ']);
    expect(totals.expense).toBe(0.3);
    expect(days[0].ops).toHaveLength(0);
  });

  it('доход: «доход вручную» важнее кол-во × цена; дата в отчёт = оплата, иначе отгрузка', () => {
    const ship = new Date('2026-10-10'), paid = new Date('2026-10-15');
    expect(incomeDerived({ qty: 3, unitPrice: 1000, amountManual: 2500, shipDate: ship })).toEqual({ amount: 2500, reportDate: ship });
    expect(incomeDerived({ qty: 3, unitPrice: 1000.333, shipDate: ship, paidDate: paid })).toEqual({ amount: 3001, reportDate: paid });
    expect(incomeDerived({ qty: 3 })).toEqual({ amount: 0, reportDate: undefined });
    expect(incomeDerived({ amountManual: 0, qty: 2, unitPrice: 5 }).amount).toBe(0); // 0 вручную — тоже «вручную»
  });

  it('сводка: месяцы, прибыль по компаниям, расходы по категориям', () => {
    const s = buildSummary([
      op('expense', '2026-09-05', 100, 'СИЮ', { category: 'Метизы' }), op('expense', '2026-10-05', 40, 'ССЮ', { category: 'Метизы' }),
      op('income', '2026-10-06', 500, 'СИЮ'), op('expense', '2026-10-07', 10, 'СИЮ'),
    ], '2026-09-01', '2026-10-31', ['СИЮ', 'ССЮ']);
    expect(s.months.map((m) => m.month)).toEqual(['2026-09', '2026-10']);
    expect(s.months[1].byCompany.СИЮ).toEqual({ income: 500, expense: 10, profit: 490 });
    expect(s.total.СИЮ).toEqual({ income: 500, expense: 110, profit: 390 });
    expect(s.expensesByCategory).toEqual([
      { category: 'Без категории', byCompany: { СИЮ: 10, ССЮ: 0 }, total: 10 },
      { category: 'Метизы', byCompany: { СИЮ: 100, ССЮ: 40 }, total: 140 },
    ]);
  });
});
