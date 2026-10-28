/**
 * Прогноз денег (TASKS БЗ-1) — отдельно от факта: платёжный календарь показывает только то, что было (по сегодня),
 * прогноз — только будущее (с завтра). Чистые функции, покрыты юнит-тестами (forecast.spec.ts).
 *
 * Факт — только оплаченное (заявки с paid, платежи по позициям, выплаты ФОТ), поэтому в прогноз идёт всё неоплаченное:
 * Ожидаемые выплаты — НЕоплаченные заявки (не отменённые) с суммой и нашей компанией:
 *   дата счёта позже сегодня → в этот день; дата счёта уже прошла (счёт не оплачен) → на сегодня как «просрочено»;
 *   открытые (ожидает / заказать / в работе) без даты счёта → «без срока».
 * Ожидаемые поступления — неоплаченный остаток позиций заказов (сумма − уже принятые платежи, К7):
 *   форма оплаты «… 30% …» — 30% в день заказа (договора), остаток — в срок; уже принятая предоплата вычитается; иначе всё — в срок;
 *   срок = отгрузка → изготовление → окончание поставки; срок уже прошёл — на сегодня как «просрочено»; срока нет — «без срока».
 */
import { buildCashflow, type Op } from './cashflow';

export interface ExpenseSrc { id: string; title: string; amount: number; company: string; invoiceDate?: string | null; status: string; doc?: string; counterparty?: string }
export interface IncomeSrc {
  /** Уже принято платежами, ₽ (К7). */
  paid?: number;
  id: string; title: string; amount: number; company: string; paymentForm?: string | null; orderNo?: string; customer?: string;
  /** Дата заказа / договора (для предоплаты) и срок (отгрузка → изготовление → поставка), ГГГГ-ММ-ДД. */
  orderDate?: string | null; due?: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const OPEN = new Set(['in_progress', 'requested', 'ordered']);

/** «б/р 30%» → 30; «50% предоплата» → 50; нет процента — null. */
export function prepayPercent(form?: string | null): number | null {
  const m = String(form ?? '').match(/(\d{1,3})\s*%/);
  const p = m ? Number(m[1]) : NaN;
  return p > 0 && p < 100 ? p : null;
}

/** Будущие операции и «без срока» из заявок и позиций заказов. today — ГГГГ-ММ-ДД. */
export function expectedOps(expenses: ExpenseSrc[], incomes: IncomeSrc[], today: string) {
  const ops: (Op & { overdue?: boolean })[] = [];
  const noDate: { type: 'income' | 'expense'; id: string; title: string; amount: number; company: string; doc?: string; counterparty?: string }[] = [];
  for (const e of expenses) {
    if (!(e.amount > 0) || e.status === 'cancelled') continue;
    if (e.invoiceDate) {
      const overdue = e.invoiceDate <= today;
      ops.push({ type: 'expense', id: e.id, date: overdue ? today : e.invoiceDate, amount: r2(e.amount), company: e.company, title: overdue ? `${e.title} · просрочено` : e.title, doc: e.doc, counterparty: e.counterparty, overdue });
    }
    else if (OPEN.has(e.status)) noDate.push({ type: 'expense', id: e.id, title: e.title, amount: r2(e.amount), company: e.company, doc: e.doc, counterparty: e.counterparty });
  }
  for (const i of incomes) {
    if (!(i.amount > 0)) continue;
    const base = { type: 'income' as const, id: i.id, company: i.company, title: i.title, doc: i.orderNo ? `заказ ${i.orderNo}` : undefined, counterparty: i.customer };
    const at = (date: string | null | undefined, amount: number, what: string) => {
      if (!(amount > 0)) return;
      if (!date) { noDate.push({ ...base, amount: r2(amount), title: what ? `${i.title} (${what})` : i.title }); return; }
      const overdue = date <= today;
      ops.push({ ...base, date: overdue ? today : date, amount: r2(amount), title: [i.title, what, overdue ? 'просрочено' : ''].filter(Boolean).join(' · '), overdue });
    };
    const paid = i.paid ?? 0;
    if (paid >= i.amount) continue;
    const p = prepayPercent(i.paymentForm);
    if (p) {
      const pre = Math.max(0, (i.amount * p) / 100 - paid); // предоплата, которую ещё не внесли
      at(i.orderDate || i.due, pre, `предоплата ${p}%`);
      at(i.due, i.amount - paid - pre, paid > 0 && pre === 0 ? 'остаток' : `остаток ${100 - p}%`);
    } else at(i.due, i.amount - paid, paid > 0 ? 'остаток' : '');
  }
  return { ops, noDate };
}

/**
 * Прогноз по дням от сегодня до to: остаток на сегодня (opening) + поступления − выплаты; дни с минусом — кассовый разрыв.
 * Сегодня — только «просроченные» поступления и выплаты на сегодня не попадают (они в факте).
 */
export function buildForecast(ops: Op[], today: string, to: string, opening: number, companies: string[]) {
  const cf = buildCashflow(ops, today, to, opening, companies);
  const week = new Date(Date.parse(today + 'T00:00:00Z') + 7 * 86400000).toISOString().slice(0, 10);
  const firstGap = cf.days.find((d) => d.closing < 0)?.date ?? null;
  const minDay = cf.days.reduce((m, d) => (d.closing < m.closing ? d : m), cf.days[0]);
  return {
    ...cf,
    gapDays: cf.days.filter((d) => d.closing < 0).map((d) => d.date),
    firstGap,
    minBalance: minDay ? { date: minDay.date, amount: minDay.closing } : null,
    week: {
      to: week,
      pay: r2(cf.days.filter((d) => d.date <= week).reduce((s, d) => s + d.expense, 0)),
      receive: r2(cf.days.filter((d) => d.date <= week).reduce((s, d) => s + d.income, 0)),
    },
  };
}
