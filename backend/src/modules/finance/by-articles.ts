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

export interface OrderRow { id: string; name: string; level: 2; values: number[]; total: number }
export interface IncomeRow { id: string; name: string; level: 1; values: number[]; total: number; pct: number; children: OrderRow[] }

export const NO_COUNTERPARTY = 'Контрагент не указан';
export const NO_CUSTOMER = 'Заказчик не указан';
export const NO_ORDER = 'Без заказа';
/** Статья верхнего уровня без подстатьи: расход привязан прямо к статье. */
export const SELF_NAME = 'Без подстатьи';
export const SELF_SUFFIX = ':self';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;
const nameOr = (v: string | undefined, empty: string) => (v || '').trim() || empty;
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
  const selfOf = new Map<string, ArticleNode['children'][number]>();
  for (const top of tree) {
    for (const sub of top.children) subOf.set(sub.id, { top, sub });
    const self = { id: top.id + SELF_SUFFIX, name: SELF_NAME, sortOrder: Number.MAX_SAFE_INTEGER, categoryIds: [] };
    selfOf.set(top.id, self);
    if (!subOf.has(top.id)) subOf.set(top.id, { top, sub: self });
  }

  const income = zeros(), expense = zeros(), unallocated = zeros(), unassigned = zeros();
  let unassignedCount = 0, unallocatedCount = 0;
  const bySub = new Map<string, number[]>();
  const leaves = new Map<string, Map<string, number[]>>(); // подстатья → контрагент → месяцы
  const customers = new Map<string, { values: number[]; orders: Map<string, number[]> }>(); // заказчик → заказ → месяцы
  for (const o of ops) {
    const kind = classify(o, year, today, opts);
    if (!kind) continue;
    const m = Number(o.date.slice(5, 7)) - 1;
    if (kind === 'income') {
      add(income, m, o.amount);
      const who = nameOr(o.counterparty, NO_CUSTOMER);
      const c = customers.get(who) ?? customers.set(who, { values: zeros(), orders: new Map() }).get(who)!;
      add(c.values, m, o.amount);
      const ord = (o.doc || '').trim();
      add(c.orders.get(ord) ?? c.orders.set(ord, zeros()).get(ord)!, m, o.amount);
      continue;
    }
    add(expense, m, o.amount);
    if (kind === 'unallocated') { add(unallocated, m, o.amount); unallocatedCount++; continue; }
    const hit = o.articleId ? subOf.get(o.articleId) : undefined;
    if (!hit) { add(unassigned, m, o.amount); unassignedCount++; continue; }
    add(bySub.get(hit.sub.id) ?? bySub.set(hit.sub.id, zeros()).get(hit.sub.id)!, m, o.amount);
    const byCp = leaves.get(hit.sub.id) ?? leaves.set(hit.sub.id, new Map()).get(hit.sub.id)!;
    const name = nameOr(o.counterparty, NO_COUNTERPARTY);
    add(byCp.get(name) ?? byCp.set(name, zeros()).get(name)!, m, o.amount);
  }

  const totalExpense = sumOf(expense);
  const base = opts.mode === 'object' && (opts.contractPrice ?? 0) > 0 ? (opts.contractPrice as number) : totalExpense;
  const pct = (total: number) => (base > 0 ? r1((total / base) * 100) : 0);

  const rows: TopRow[] = [];
  for (const top of tree) {
    const children: SubRow[] = [];
    for (const sub of [...top.children, selfOf.get(top.id)!]) {
      const values = bySub.get(sub.id);
      if (!values) continue;
      const total = sumOf(values);
      if (total === 0) continue;
      const lv = leaves.get(sub.id);
      // третий уровень — контрагенты: если их несколько или единственный назван
      const showLeaves = !!lv && (lv.size >= 2 || !lv.has(NO_COUNTERPARTY));
      children.push({
        id: sub.id, ...(sub.code ? { code: sub.code } : {}), name: sub.name, level: 2, values, total, pct: pct(total),
        ...(showLeaves ? { children: [...lv!.entries()].map(([name, v]): Leaf => ({ name, level: 3, values: v, total: sumOf(v) })).filter((l) => l.total !== 0).sort((a, b) => b.total - a.total) } : {}),
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
  const incomeRows: IncomeRow[] = [...customers.entries()].map(([name, c]): IncomeRow => {
    const total = sumOf(c.values);
    return {
      id: 'cp:' + name, name, level: 1, values: c.values, total, pct: incomeTotal > 0 ? r1((total / incomeTotal) * 100) : 0,
      children: [...c.orders.entries()].map(([doc, v]): OrderRow => ({ id: 'ord:' + doc, name: doc || NO_ORDER, level: 2, values: v, total: sumOf(v) })).sort((a, b) => b.total - a.total),
    };
  }).sort((a, b) => b.total - a.total);
  return {
    year, months: monthsOf(year),
    scope: { mode: opts.mode, ...(opts.salesOrderId ? { salesOrderId: opts.salesOrderId } : {}), ...(opts.orderNo ? { orderNo: opts.orderNo } : {}), ...(opts.title ? { title: opts.title } : {}), ...(opts.contractPrice !== undefined ? { contractPrice: opts.contractPrice } : {}) },
    head: { income, expense, profit, totals: { income: incomeTotal, expense: totalExpense, profit: r2(incomeTotal - totalExpense) } },
    rows, incomeRows,
    unassigned: { values: unassigned, total: sumOf(unassigned), count: unassignedCount },
    ...(opts.mode === 'object' ? { unallocated: { values: unallocated, total: sumOf(unallocated), count: unallocatedCount } } : {}),
    result: { values: profit, cumulative, ratio: income.map((x, i) => (expense[i] > 0 ? r2(x / expense[i]) : null)) },
  };
}

/**
 * Операции одной ячейки: `articleId` — подстатья, статья (все её подстатьи), `none` («Без статьи»),
 * `income` (все доходы), `expense` (все расходы), `unallocated` (ФОТ без объекта). `month` — ГГГГ-ММ; пусто — весь год.
 */
export function opsOfCell(ops: Op[], tree: ArticleNode[], year: number, today: string, opts: ByArticlesOpts, articleId: string, month?: string, extra: { counterparty?: string; doc?: string } = {}): Op[] {
  const sub = new Set<string>();
  for (const top of tree) {
    if (top.id === articleId) { top.children.forEach((c) => sub.add(c.id)); sub.add(top.id); }
    else if (articleId === top.id + SELF_SUFFIX) sub.add(top.id);
    else for (const c of top.children) if (c.id === articleId) sub.add(c.id);
  }
  const known = new Set(tree.flatMap((t) => [t.id, ...t.children.map((c) => c.id)]));
  // «не указан» — пустое имя в данных
  const wanted = (v: string | undefined, empty: string[]) => (v === undefined ? undefined : empty.includes(v) ? '' : v.trim());
  const cp = wanted(extra.counterparty, [NO_COUNTERPARTY, NO_CUSTOMER]);
  const doc = wanted(extra.doc, [NO_ORDER]);
  return ops.filter((o) => {
    const kind = classify(o, year, today, opts);
    if (!kind || (month && o.date.slice(0, 7) !== month)) return false;
    if (cp !== undefined && (o.counterparty || '').trim() !== cp) return false;
    if (doc !== undefined && (o.doc || '').trim() !== doc) return false;
    if (articleId === 'income') return kind === 'income';
    if (articleId === 'expense') return kind !== 'income';
    if (articleId === 'unallocated') return kind === 'unallocated';
    if (kind !== 'expense') return false;
    if (articleId === 'none') return !o.articleId || !known.has(o.articleId);
    return !!o.articleId && sub.has(o.articleId);
  }).sort((a, b) => a.date.localeCompare(b.date) || b.amount - a.amount);
}
