import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, money } from '../core/format.js';
import { patch } from '../core/router.js';
import { actions, button, empty, segmented, failBlock, busyBlock, link, stats, toolbar, treeTable } from '../ui/kit/index.js';
import { openFinanceOperation, operationTitle } from './money-operations.js';
import { businessToday } from './invoice-workspace-state.js';

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const QUARTERS = ['I', 'II', 'III', 'IV'];
const PERIOD_KEY = 'dc-money-articles-period';
const opened = new Set(['income', 'expense']);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* */ } } };
const sum = (values, indices) => indices.reduce((total, i) => total + (Number(values?.[i]) || 0), 0);
const quarter = (month) => Math.floor((Number(month.slice(5, 7)) - 1) / 3);
const num = (value, strong) => {
  const n = Number(value) || 0;
  return h('span', { class: 'num' + (n < 0 ? ' neg' : '') + (strong ? ' strong' : '') + (!n ? ' muted' : '') }, n ? money(n).replace(' ₽', '') : '—');
};
const share = (amount, base) => base ? {
  ratio: amount / base,
  text: String(Math.round(amount / base * 1000) / 10).replace('.', ',') + '%',
} : undefined;

/** Сводка фактов и операции под любой строкой. Фильтры и периоды одинаковы у дерева и операций. */
export function articlesView({ year, org, mode, order, filters, incomeMode, onFacets }) {
  const bar = toolbar();
  const out = h('div');
  const el = h('div', null, bar, out);
  let report, tt, groups = [], destroyed = false;
  let quarters = store.get(PERIOD_KEY) === 'quarters';

  const titleOfPeriod = (indices) => {
    const first = report.months[indices[0]];
    return (quarters ? QUARTERS[quarter(first)] + ' квартал' : MONTHS[Number(first.slice(5, 7)) - 1]) + ' ' + first.slice(0, 4);
  };
  function chosenGroups() {
    const all = new Map();
    const current = businessToday().slice(0, 7);
    report.months.forEach((month, index) => {
      if (month > current) return;
      const key = quarters ? month.slice(0, 4) + '-' + quarter(month) : month;
      all.set(key, [...(all.get(key) || []), index]);
    });
    return [...all.values()];
  }
  function showOps(rowId, extra, indices, e) {
    let { from, to } = filters;
    if (indices?.length) {
      const start = report.months[indices[0]] + '-01';
      const last = report.months[indices.at(-1)];
      const end = new Date(Date.UTC(Number(last.slice(0, 4)), Number(last.slice(5, 7)), 0)).toISOString().slice(0, 10);
      if (start > from) from = start;
      if (end < to) to = end;
    }
    const insert = tt.insertRows(rowId, { key: indices?.join(',') || 'all', trigger: e?.currentTarget });
    if (!insert) return;
    const spanningRow = (content) => h('tr', { class: 'fin-tree-note' }, h('td', { colspan: String(groups.length + 3) }, content));
    async function load(page) {
      insert.set([spanningRow(busyBlock('операции'))]);
      try {
        const response = await api('/finance/operations', { query: { ...filters, ...extra, from, to, page, limit: 20 } });
        if (!insert.active() || destroyed) return;
        const items = response.items || [];
        const first = (page - 1) * response.limit + 1, last = Math.min(page * response.limit, response.total);
        const rows = items.map(operationRow);
        if (!rows.length) rows.push(spanningRow('Операций за этот период нет.'));
        if (response.total > response.limit) rows.push(spanningRow(actions(
          button({ label: 'Предыдущие', size: 'S', disabled: page <= 1, onClick: () => load(page - 1) }),
          h('span', { class: 'muted' }, first + '–' + last + ' из ' + response.total),
          button({ label: 'Следующие', size: 'S', disabled: last >= response.total, onClick: () => load(page + 1) }))));
        insert.set(rows);
      } catch (error) {
        if (insert.active() && !destroyed) insert.set([spanningRow(failBlock(error, () => load(page)))]);
      }
    }
    void load(1);
  }

  function operationRow(row) {
    const month = String(row.date || '').slice(0, 7);
    const name = operationTitle(row);
    const open = row.operationId ? () => openFinanceOperation(row) : null;
    const supplementary = [date(row.date), row.counterpartyName || row.counterparty, row.docNo].filter(Boolean).join(' · ');
    const isIncome = row.type === 'income';
    const amount = h('span', { class: isIncome ? 'num u-money-in' : 'num u-money-out' },
      (isIncome ? '+' : '−') + money(row.amount).replace(' ₽', ''));
    const period = groups.findIndex((indices) => indices.some((i) => report.months[i] === month));
    return h('tr', { class: 'fin-tree-entry' + (open ? ' fin-tree-entry-click' : ''), onclick: open ? (ev) => {
      if (!ev.target.closest('a, button')) open();
    } : null },
    h('td', { class: 'sticky' },
      open ? link({ label: name, title: 'Подробности операции', onClick: open }) : name,
      supplementary ? h('small', { class: 'muted' }, supplementary) : null),
    ...groups.map((_, i) => h('td', { class: 'day' }, i === period ? amount : null)),
    h('td', { class: 'tot' }, period < 0 ? amount : null), h('td', { class: 'tot' }));
  }

  function node({ id, label, name = label, values, total, weight, scope, cls, kids = [], strong = false }) {
    const activate = (indices) => (e) => showOps(id, scope, indices, e);
    return {
      id, label, cls, share: weight, kids,
      cells: groups.map((indices) => {
        const value = sum(values, indices);
        return { v: num(value, strong), click: scope && value ? activate(indices) : null,
          title: name + ' · ' + titleOfPeriod(indices) + ' · ' + money(value) };
      }),
      total: { v: num(total, true), click: scope && total ? activate(null) : null, title: name + ' · весь выбранный период · ' + money(total) },
      onLeaf: scope && !kids.length && total ? activate(null) : undefined,
      raw: total,
    };
  }
  function articleRows(rows, type, base) {
    const build = (row, parentTotal) => {
      const articleId = row.id === type + ':none' ? 'none' : row.articleId || row.id.split(':')[0];
      const scope = { type, articleId, includeDescendants: row.id.endsWith(':self') ? 0 : 1 };
      const kids = (row.children || []).map(child => child.id ? build(child, row.total) : node({
        id: row.id + '|' + child.name, label: child.name, values: child.values, total: child.total, weight: share(child.total, row.total),
        scope: { ...scope, counterparty: child.name },
      }));
      return node({ id: row.id, label: row.name, name: row.path?.join(' → ') || row.name, values: row.values, total: row.total,
        weight: share(row.total, parentTotal), scope, kids });
    };
    return (rows || []).map(row => build(row, base));
  }
  function incomeByCustomer() {
    return (report.incomeRows || []).map(cp => node({
      id: cp.id, label: cp.name, values: cp.values, total: cp.total, weight: share(cp.total, report.head.totals.income),
      scope: { type: 'income', counterparty: cp.name },
      kids: (cp.children || []).map(o => node({
        id: cp.id + '|' + o.id, label: o.name, name: cp.name + ' → ' + o.name, values: o.values, total: o.total, weight: share(o.total, cp.total),
        scope: { type: 'income', counterparty: cp.name, doc: o.name },
      })),
    }));
  }
  function paint() {
    tt?.closeInsert();
    const { head, scope = {}, articleRows: rowsByType, rows: legacyRows, unassigned, unallocated } = report;
    const { income, expense, profit } = head.totals;
    if (!income && !expense) {
      out.replaceChildren(empty({ title: 'Нет операций за выбранный период', hint: 'Измените даты или условия отбора.' }));
      tt = null;
      return;
    }
    groups = chosenGroups();
    const base = scope.mode === 'object' ? scope.contractPrice : null;
    const expenses = articleRows(rowsByType?.filter(row => row.type === 'expense') ?? legacyRows, 'expense', base || expense);
    if (!rowsByType && unassigned?.total) expenses.push(node({
      id: 'none', label: 'Без статьи', values: unassigned.values, total: unassigned.total, scope: { type: 'expense', articleId: 'none' },
    }));
    const rows = [
      filters.type !== 'expense' && node({ id: 'income', label: 'Доходы', cls: 'grp in', values: head.income, total: income,
        strong: true, scope: { type: 'income' }, kids: incomeMode === 'customers' ? incomeByCustomer() : articleRows(rowsByType?.filter(row => row.type === 'income'), 'income', income) }),
      filters.type !== 'income' && node({ id: 'expense', label: 'Расходы', cls: 'grp out', values: head.expense, total: expense,
        strong: true, scope: { type: 'expense' }, kids: expenses }),
      unallocated?.total && node({ id: 'unallocated', label: 'Не распределено по объекту', cls: 'sub', values: unallocated.values, total: unallocated.total }),
      node({ id: 'result', label: 'Денежный результат', cls: 'bal end', values: head.profit, total: profit, strong: true }),
    ].filter(Boolean);
    tt = treeTable({ label: 'Доходы и расходы по статьям', head: incomeMode === 'customers' ? 'Статья / заказчик' : 'Статья',
      disclosure: true, open: opened, shareLabel: base ? '% цены' : 'Доля',
      periods: groups.map(indices => ({ label: titleOfPeriod(indices), today: indices.some(index => report.months[index] === businessToday().slice(0, 7)) })),
      moreLabel: rest => 'Ещё ' + rest.length, rows });
    tt.el.classList.add('fin-report-tree');
    out.replaceChildren(
      stats([{ value: money(income), label: 'Доходы', tone: 'ok' }, { value: money(expense), label: 'Расходы' },
        { value: money(profit), label: 'Поступило минус выплачено', tone: profit < 0 ? 'danger' : undefined }]),
      tt.el, h('p', { class: 'hint' }, 'Стрелка раскрывает ветку. Сумма показывает операции за период. Нажмите операцию, чтобы открыть подробности.'));
  }

  const incomeSwitch = segmented({ fit: true, label: 'Доходы в таблице', value: incomeMode === 'customers' ? 'customers' : 'articles',
    items: [{ key: 'articles', label: 'Статьи' }, { key: 'customers', label: 'Заказчики и заказы' }],
    onChange: value => patch({ incomeMode: value === 'customers' ? value : undefined }) });
  const periodSwitch = segmented({ fit: true, label: 'Период таблицы', value: quarters ? 'quarters' : 'months',
    items: [{ key: 'months', label: 'Месяцы' }, { key: 'quarters', label: 'Кварталы' }],
    onChange: value => { quarters = value === 'quarters'; store.set(PERIOD_KEY, value); if (report) paint(); } });
  bar.append(filters.type === 'expense' ? null : incomeSwitch.el, periodSwitch.el,
    actions(button({ label: 'Раскрыть всё', kind: 'ghost', size: 'S', onClick: () => tt?.expandAll() }),
      button({ label: 'Свернуть всё', kind: 'ghost', size: 'S', onClick: () => tt?.collapseAll() })));
  async function load() {
    out.replaceChildren(busyBlock('доходы и расходы'));
    try {
      report = await api('/finance/by-articles', { query: { year, org, ...filters, facets: 1,
        mode: mode === 'object' && (filters.salesOrderId || order) ? 'object' : 'company' } });
      if (destroyed) return;
      onFacets?.(report.facets);
      paint();
    } catch (error) {
      if (!destroyed) out.replaceChildren(failBlock(error, load));
    }
  }
  void load();
  return { el, destroy() { destroyed = true; tt?.closeInsert(); } };
}
