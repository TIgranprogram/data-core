import type { Op } from './cashflow';
import type { ArticleNode } from '../expense-articles/articles-tree';

/**
 * «Деньги → По статьям» (C027): чистая сборка таблицы «статья → подстатья × месяцы» из операций факта.
 * Без базы — покрыта юнит-тестами (by-articles.spec.ts). Только факт: будущие даты (позже `today`) не считаются.
 */
export interface ByArticlesOpts {
  mode: 'company' | 'object';
  salesOrderId?: string;
  orderNo?: string;
  title?: string;
  /** Цена контракта объекта (сумма позиций заказа) — от неё считаются проценты в режиме объекта. */
  contractPrice?: number;
}

export interface Leaf { name: string; level: 3; values: number[]; total: number }
export interface SubRow { id: string; code?: string; name: string; level: 2; values: number[]; total: number; pct: number; children?: Leaf[] }
export interface TopRow { id: string; code?: string; name: string; level: 1; values: number[]; total: number; pct: number; children: SubRow[] }

/** Статья, у которой третий уровень — подрядчики. */
export const SUBCONTRACT = 'Субподрядные работы';
export const NO_COUNTERPARTY = 'Контрагент не указан';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const zeros = () => Array.from({ length: 12 }, () => 0);
const sumOf = (v: number[]) => r2(v.reduce((s, x) => s + x, 0));
const add = (v: number[], i: number, x: number) => { v[i] = r2(v[i] + x); };

export const monthsOf = (year: number) => Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);

type Kind = 'income' | 'expense' | 'unallocated';

/** В какую часть таблицы идёт операция; null — в таблицу не входит (другой год, будущее, чужой объект). */
export function classify(o: Op, year: number, today: string, opts: ByArticlesOpts): Kind | null {
  if (!(o.amount > 0) || !o.date || o.date > today || o.date.slice(0, 4) !== String(year)) return null;
  if (opts.mode === 'object') {
    if (o.salesOrderId && o.salesOrderId === opts.salesOrderId) return o.type;
    // ФОТ не привязан к объекту: показываем отдельной строкой, чтобы расходы сошлись с общим итогом
    return o.type === 'expense' && o.source === 'payroll' && !o.salesOrderId ? 'unallocated' : null;
  }
  return o.type;
}

export function buildByArticles(ops: Op[], tree: ArticleNode[], year: number, today: string, opts: ByArticlesOpts) {
  const subOf = new Map<string, { top: ArticleNode; sub: ArticleNode['children'][number] }>();
  for (const top of tree) for (const sub of top.children) subOf.set(sub.id, { top, sub });

  const income = zeros(), expense = zeros(), unallocated = zeros(), unassigned = zeros();
  let unassignedCount = 0, unallocatedCount = 0;
  const bySub = new Map<string, number[]>();
  const leaves = new Map<string, Map<string, number[]>>(); // подстатья → контрагент → месяцы
  for (const o of ops) {
    const kind = classify(o, year, today, opts);
    if (!kind) continue;
    const m = Number(o.date.slice(5, 7)) - 1;
    if (kind === 'income') { add(income, m, o.amount); continue; }
    add(expense, m, o.amount);
    if (kind === 'unallocated') { add(unallocated, m, o.amount); unallocatedCount++; continue; }
    const hit = o.articleId ? subOf.get(o.articleId) : undefined;
    if (!hit) { add(unassigned, m, o.amount); unassignedCount++; continue; }
    add(bySub.get(hit.sub.id) ?? bySub.set(hit.sub.id, zeros()).get(hit.sub.id)!, m, o.amount);
    if (hit.top.name === SUBCONTRACT) {
      const byCp = leaves.get(hit.sub.id) ?? leaves.set(hit.sub.id, new Map()).get(hit.sub.id)!;
      const name = (o.counterparty || '').trim() || NO_COUNTERPARTY;
      add(byCp.get(name) ?? byCp.set(name, zeros()).get(name)!, m, o.amount);
    }
  }

  const totalExpense = sumOf(expense);
  const base = opts.mode === 'object' && (opts.contractPrice ?? 0) > 0 ? (opts.contractPrice as number) : totalExpense;
  const pct = (total: number) => (base > 0 ? r1((total / base) * 100) : 0);

  const rows: TopRow[] = [];
  for (const top of tree) {
    const children: SubRow[] = [];
    for (const sub of top.children) {
      const values = bySub.get(sub.id);
      if (!values) continue;
      const total = sumOf(values);
      if (total === 0) continue;
      const lv = leaves.get(sub.id);
      children.push({
        id: sub.id, ...(sub.code ? { code: sub.code } : {}), name: sub.name, level: 2, values, total, pct: pct(total),
        ...(lv ? { children: [...lv.entries()].map(([name, v]): Leaf => ({ name, level: 3, values: v, total: sumOf(v) })).filter((l) => l.total !== 0).sort((a, b) => b.total - a.total) } : {}),
      });
    }
    if (!children.length) continue;
    const values = zeros();
    for (const c of children) c.values.forEach((x, i) => add(values, i, x));
    const total = sumOf(values);
    rows.push({ id: top.id, ...(top.code ? { code: top.code } : {}), name: top.name, level: 1, values, total, pct: pct(total), children });
  }

  const profit = income.map((x, i) => r2(x - expense[i]));
  let acc = 0;
  const cumulative = profit.map((x) => (acc = r2(acc + x)));
  const incomeTotal = sumOf(income);
  return {
    year, months: monthsOf(year),
    scope: { mode: opts.mode, ...(opts.salesOrderId ? { salesOrderId: opts.salesOrderId } : {}), ...(opts.orderNo ? { orderNo: opts.orderNo } : {}), ...(opts.title ? { title: opts.title } : {}), ...(opts.contractPrice !== undefined ? { contractPrice: opts.contractPrice } : {}) },
    head: { income, expense, profit, totals: { income: incomeTotal, expense: totalExpense, profit: r2(incomeTotal - totalExpense) } },
    rows,
    unassigned: { values: unassigned, total: sumOf(unassigned), count: unassignedCount },
    ...(opts.mode === 'object' ? { unallocated: { values: unallocated, total: sumOf(unallocated), count: unallocatedCount } } : {}),
    result: { values: profit, cumulative, ratio: income.map((x, i) => (expense[i] > 0 ? r2(x / expense[i]) : null)) },
  };
}

/**
 * Операции одной ячейки: `articleId` — подстатья, статья (все её подстатьи), `none` («Без статьи»),
 * `income` (все доходы), `expense` (все расходы), `unallocated` (ФОТ без объекта). `month` — ГГГГ-ММ; пусто — весь год.
 */
export function opsOfCell(ops: Op[], tree: ArticleNode[], year: number, today: string, opts: ByArticlesOpts, articleId: string, month?: string): Op[] {
  const sub = new Set<string>();
  for (const top of tree) if (top.id === articleId) top.children.forEach((c) => sub.add(c.id)); else for (const c of top.children) if (c.id === articleId) sub.add(c.id);
  const known = new Set(tree.flatMap((t) => t.children.map((c) => c.id)));
  return ops.filter((o) => {
    const kind = classify(o, year, today, opts);
    if (!kind || (month && o.date.slice(0, 7) !== month)) return false;
    if (articleId === 'income') return kind === 'income';
    if (articleId === 'expense') return kind !== 'income';
    if (articleId === 'unallocated') return kind === 'unallocated';
    if (kind !== 'expense') return false;
    if (articleId === 'none') return !o.articleId || !known.has(o.articleId);
    return !!o.articleId && sub.has(o.articleId);
  }).sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}
