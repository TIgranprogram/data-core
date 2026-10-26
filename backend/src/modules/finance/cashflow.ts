/**
 * Расчёт платёжного календаря (ОДР) — чистые функции без базы, покрыты юнит-тестами (cashflow.spec.ts).
 * Правило: closing = opening + income − expense; opening следующего дня = closing предыдущего;
 * opening первого дня = начальный остаток.
 */
export interface Op {
  type: 'income' | 'expense';
  id: string;
  /** День операции, ГГГГ-ММ-ДД. */
  date: string;
  amount: number;
  /** Название нашей компании (СИЮ / ССЮ). */
  company: string;
  title: string;
  /** Направление затрат (Цех / Офис / СМР / Заказы / Не указано) — только у расходов. */
  costCenter?: string;
  /** № счёта / № заказа. */
  doc?: string;
  category?: string;
  counterparty?: string;
  /** URL миниатюры (первое фото заявки/изделия; БЗ-17). */
  thumb?: string;
}

export interface Day {
  date: string;
  /** 0 — вс … 6 — сб */
  weekday: number;
  opening: number;
  income: number;
  expense: number;
  closing: number;
  incomeBy: Record<string, number>;
  expenseBy: Record<string, number>;
  ops: Op[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Все дни периода включительно (ГГГГ-ММ-ДД, по UTC). */
export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  const end = Date.parse(to + 'T00:00:00Z');
  for (let t = Date.parse(from + 'T00:00:00Z'); t <= end; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function buildCashflow(ops: Op[], from: string, to: string, opening: number, companies: string[]) {
  const byDay = new Map<string, Op[]>();
  for (const op of ops) {
    if (!(op.amount > 0) || op.date < from || op.date > to) continue; // без суммы / вне периода — не считается
    (byDay.get(op.date) ?? byDay.set(op.date, []).get(op.date)!).push(op);
  }
  const zero = () => Object.fromEntries(companies.map((c) => [c, 0])) as Record<string, number>;
  const totals = { income: 0, expense: 0, incomeBy: zero(), expenseBy: zero() };
  let balance = r2(opening);
  const days: Day[] = daysBetween(from, to).map((date) => {
    const dayOps = byDay.get(date) ?? [];
    const incomeBy = zero(), expenseBy = zero();
    let income = 0, expense = 0;
    for (const op of dayOps) {
      const by = op.type === 'income' ? incomeBy : expenseBy;
      by[op.company] = r2((by[op.company] ?? 0) + op.amount);
      if (op.type === 'income') income += op.amount; else expense += op.amount;
    }
    income = r2(income); expense = r2(expense);
    const day: Day = { date, weekday: new Date(date + 'T00:00:00Z').getUTCDay(), opening: balance, income, expense, closing: r2(balance + income - expense), incomeBy, expenseBy, ops: dayOps };
    balance = day.closing;
    totals.income = r2(totals.income + income); totals.expense = r2(totals.expense + expense);
    for (const c of Object.keys(incomeBy)) totals.incomeBy[c] = r2((totals.incomeBy[c] ?? 0) + incomeBy[c]);
    for (const c of Object.keys(expenseBy)) totals.expenseBy[c] = r2((totals.expenseBy[c] ?? 0) + expenseBy[c]);
    return day;
  });
  return { days, totals: { ...totals, opening: r2(opening), closing: balance } };
}

/** Итоги по месяцам (доход/расход/прибыль по компаниям) и расходы по категориям. */
export function buildSummary(ops: Op[], from: string, to: string, companies: string[]) {
  const months: string[] = [];
  for (let d = new Date(from.slice(0, 7) + '-01T00:00:00Z'); d.toISOString().slice(0, 7) <= to.slice(0, 7); d.setUTCMonth(d.getUTCMonth() + 1)) months.push(d.toISOString().slice(0, 7));
  const cell = () => Object.fromEntries(companies.map((c) => [c, { income: 0, expense: 0, profit: 0 }])) as Record<string, { income: number; expense: number; profit: number }>;
  const byMonth = new Map(months.map((m) => [m, cell()]));
  const categories = new Map<string, Record<string, number>>();
  const centers = new Map<string, Record<string, number>>();
  const suppliers = new Map<string, number>();
  for (const op of ops) {
    if (!(op.amount > 0) || op.date < from || op.date > to) continue;
    const m = byMonth.get(op.date.slice(0, 7));
    const c = m?.[op.company];
    if (c) { if (op.type === 'income') c.income = r2(c.income + op.amount); else c.expense = r2(c.expense + op.amount); c.profit = r2(c.income - c.expense); }
    if (op.type === 'expense') {
      const name = op.category || 'Без категории';
      const row = categories.get(name) ?? Object.fromEntries(companies.map((x) => [x, 0]));
      row[op.company] = r2((row[op.company] ?? 0) + op.amount);
      categories.set(name, row);
      const cc = op.costCenter || 'Не указано';
      const rc = centers.get(cc) ?? Object.fromEntries(companies.map((x) => [x, 0]));
      rc[op.company] = r2((rc[op.company] ?? 0) + op.amount);
      centers.set(cc, rc);
      const sp = op.counterparty || 'Поставщик не указан';
      suppliers.set(sp, r2((suppliers.get(sp) ?? 0) + op.amount));
    }
  }
  const total = cell();
  for (const m of byMonth.values()) for (const c of companies) { total[c].income = r2(total[c].income + m[c].income); total[c].expense = r2(total[c].expense + m[c].expense); total[c].profit = r2(total[c].income - total[c].expense); }
  return {
    months: months.map((month) => ({ month, byCompany: byMonth.get(month)! })),
    total,
    expensesByCategory: [...categories.entries()].map(([category, by]) => ({ category, byCompany: by, total: r2(Object.values(by).reduce((s, v) => s + v, 0)) }))
      .sort((a, b) => a.category.localeCompare(b.category, 'ru')),
    /** Кому платили больше всего (топ-15). */
    expensesBySupplier: [...suppliers.entries()].map(([supplier, total]) => ({ supplier, total })).sort((a, b) => b.total - a.total).slice(0, 15),
    /** Куда тратили: Цех / Офис / СМР / Заказы / Не указано. */
    expensesByCostCenter: [...centers.entries()].map(([center, by]) => ({ center, byCompany: by, total: r2(Object.values(by).reduce((s, v) => s + v, 0)) }))
      .sort((a, b) => b.total - a.total),
  };
}
