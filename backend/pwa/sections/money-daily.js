import { h } from '../core/dom.js';
import { date, money } from '../core/format.js';
import { button, link, stats, table, section } from '../ui/kit/index.js';
import { conversionBlock } from './money-forecast.js';
import { operationTable } from './money-operations.js';

const amount = (value) => value ? money(value) : '—';
const number = (value) => h('span', { class: 'num' }, amount(value));

/** Факт по датам, отдельно от ожидаемых оплат. Внутри даты — операции этой даты. */
export function dailyPaymentsView(report, { withOpening }) {
  const totals = report.totals;
  const days = [...report.days].filter(day => day.ops?.length || day.income || day.expense).reverse();
  const columns = [{ label: 'Дата', wrap: true }, { label: 'Поступило', num: true }, { label: 'Выплачено', num: true }];
  if (withOpening) columns.push({ label: 'Остаток на конец дня', num: true });
  let active = null;
  const rows = days.flatMap(day => {
    const hasOps = !!day.ops?.length;
    const period = date(day.date);
    const key = 'fin-day-' + day.date;
    const opCell = h('td', { colspan: columns.length });
    const details = h('tr', { id: key, hidden: true }, opCell);
    const toggle = hasOps ? button({ label: period + ' · ' + day.ops.length,
      kind: 'secondary', size: 'S', title: 'Операции за ' + period, onClick: () => {
        const show = details.hidden;
        active?.();
        active = null;
        if (!show) return;
        opCell.replaceChildren(operationTable({ items: day.ops }, { compact: true, calendar: true }));
        details.hidden = false;
        toggle.setAttribute('aria-expanded', 'true');
        active = () => { details.hidden = true; toggle.setAttribute('aria-expanded', 'false'); };
      } }) : null;
    toggle?.setAttribute('aria-expanded', 'false');
    toggle?.setAttribute('aria-controls', key);
    const row = { cells: [toggle || period, number(day.income), number(day.expense), ...(withOpening ? [money(day.closing)] : [])] };
    return hasOps ? [row, details] : [row];
  });
  const pending = (title, entry) => entry?.items?.length ? section({
    title, count: amount(entry.total), body: operationTable({ items: entry.items }, { compact: true, calendar: true, pending: true }),
  }) : null;
  const fill = report.needsFill?.total ? h('p', { class: 'hint' },
    link({ label: 'Требуют заполнения', href: '#fill' }), ' · ' + report.needsFill.total) : null;
  return [
    stats([
      { label: 'Поступило', value: money(totals.income), tone: 'ok' },
      { label: 'Выплачено', value: money(totals.expense) },
      withOpening ? { label: 'Расчётный остаток за период', value: money(totals.closing) }
        : { label: 'Поступило минус выплачено', value: money(totals.income - totals.expense) },
    ]),
    withOpening ? h('p', { class: 'hint' }, 'Расчётный остаток на начало периода: ' + money(totals.opening) +
      (report.startDate ? ' · Учёт с ' + date(report.startDate) : '')) : null,
    table({ label: 'Платежи по дням', columns, rows, empty: { title: 'Платежей за этот месяц нет', hint: 'Выберите другой месяц или компанию.' } }),
    pending('Счета к оплате', report.pending?.invoices),
    pending('Ожидаем оплату за отгруженное', report.pending?.awaiting),
    conversionBlock(report.pending?.needsConversion), fill,
  ];
}
