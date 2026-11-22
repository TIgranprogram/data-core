import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { canFollow } from '../core/route-access.js';
import { date, money } from '../core/format.js';
import { table, link, actions, button, stats, clamp } from '../ui/kit/index.js';
import { sourceMoney } from './invoice-workspace-state.js';
import { operationsQuery } from './money-operations-state.js';

const articleCell = row => {
  const path = (row.articlePath || []).map(part => typeof part === 'string' ? part : part.name);
  return h('span', null, clamp(h('b', null, path.at(-1) || 'Без статьи'), { lines: 2 }), path.length > 1 ? clamp(path.join(' → '), { lines: 3 }) : null);
};
const centers = { office: 'Офис', workshop: 'Цех', smr: 'СМР', order: 'Под заказ' };
const sources = { invoice: 'Счёт поставщика', request: 'Заявка снабжения', income: 'Оплата заказа', expense: 'Прочий расход', payroll: 'ФОТ' };
export const operationTitle = (row) => row.title || row.docNo || row.doc || sources[row.source] || 'Операция';
const typeName = (row) => row.type === 'income' ? 'Поступление' : 'Выплата';
const amountOf = (row) => {
  const isIncome = row.type === 'income';
  return h('span', { class: isIncome ? 'num u-money-in' : 'num u-money-out' }, (isIncome ? '+' : '−') + money(row.amount));
};
const sourceLink = (row) => {
  if (canFollow(session, row.sourceLink)) return link({ label: 'Исходный документ', href: row.sourceLink });
  const type = row.invoiceId ? 'invoicecard' : ({ income: 'orders', request: 'requests', expense: 'expense' })[row.source];
  const id = String(row.invoiceId || row.sourceId || row.id || '');
  if (!type || !/^[0-9a-f]{24}$/i.test(id)) return null;
  const href = '#money?' + new URLSearchParams({ of: type, open: id });
  return canFollow(session, href) ? link({ label: 'Исходный документ', onClick: () => patch({ of: type, open: id, new: undefined }) }) : null;
};
export function openFinanceOperation(row) {
  if (row.operationId) patch({ of: 'moneyclassification', open: row.operationId, new: undefined });
}
const details = row => row.operationId ? link({ label: row.classificationEditable ? 'Уточнить для отчёта' : 'Просмотреть',
  onClick: () => openFinanceOperation(row) }) : null;
const description = row => clamp([row.counterpartyName || row.counterparty, row.projectName, row.docNo || row.doc].filter(Boolean).join(' · '), { lines: 2 });

/** Компактные операции сводки и календаря, полная таблица отдельного ручного отбора. */
export function operationTable(data, { compact = false, calendar = false, pending = false } = {}) {
  return table({
    label: pending ? 'Ожидаемые платежи' : 'Фактические денежные операции',
    cls: compact ? null : 'fin-ops-list',
    columns: [
      { label: 'Дата', nowrap: true }, { label: 'Операция', wrap: true }, { label: 'Сумма, ₽', num: true, nowrap: true },
      { label: compact ? 'Наша компания' : 'Стороны', wrap: !compact },
      { label: 'Статья', wrap: true },
      ...(compact ? [] : [{ label: 'Объект', wrap: true }]),
      { label: 'Документ', wrap: true },
    ],
    rows: (data.items || []).map(row => ({ data: row.operationId, cells: [
      date(row.date),
      compact ? h('div', null, clamp(h('b', null, operationTitle(row)), { lines: 2 }), description(row),
        row.beforeStart ? h('span', { class: 'muted' }, 'До начала учёта') : null,
        row.balanceEstimated ? h('span', { class: 'muted' }, 'Оценка в рублях · ' + sourceMoney(row.sourceBalance, row)) : null) : typeName(row),
      amountOf(row),
      compact ? row.companyName || row.company || 'Не указана' : h('div', null,
        clamp(row.counterpartyName || row.counterparty || 'Без контрагента', { lines: 3 }),
        h('small', { class: 'muted' }, row.companyName || row.company || 'Компания не указана')),
      row.articlePath?.length || !calendar ? articleCell(row) : row.category || '—',
      ...(compact ? [] : [h('div', null, clamp(row.projectName || row.costObject || '—', { lines: 3 }),
        row.costCenter && centers[row.costCenter] ? h('small', { class: 'muted' }, centers[row.costCenter]) : null)]),
      h('div', null, clamp(sources[row.source] || typeName(row), { lines: 2 }), actions(sourceLink(row), !calendar ? details(row) : null),
        !compact && row.classificationOrigin === 'override' ? h('small', { class: 'muted' }, 'Уточнено для отчёта') : null),
    ] })),
    empty: { title: 'Операций по этим условиям нет', hint: 'Измените период или фильтры.' },
  });
}

export async function operationsView(params, onFacets) {
  const query = operationsQuery(params);
  const data = await api('/finance/operations', { query: { ...query, facets: 1 } });
  onFacets?.(data.facets);
  return h('div', null,
    stats([{ label: 'Доходы', value: money(data.totals.income), tone: 'ok' },
      { label: 'Расходы', value: money(data.totals.expense) }, { label: 'Поступило минус выплачено', value: money(data.totals.net) }]),
    operationTable(data),
    actions(button({ label: 'Предыдущая страница', kind: 'ghost', disabled: data.page <= 1, onClick: () => patch({ page: data.page - 1 }) }),
      h('span', null, 'Страница ' + data.page + ' · строк ' + (data.items || []).length + ' из ' + data.total),
      button({ label: 'Следующая страница', kind: 'ghost', disabled: data.page * data.limit >= data.total, onClick: () => patch({ page: data.page + 1 }) }),
      button({ label: query.sort === 'date' ? 'Сортировать по сумме' : 'Сортировать по дате', kind: 'ghost',
        onClick: () => patch({ sort: query.sort === 'date' ? 'amount' : 'date', page: undefined }) }),
      button({ label: query.dir === 'asc' ? 'По убыванию' : 'По возрастанию', kind: 'ghost',
        onClick: () => patch({ dir: query.dir === 'asc' ? 'desc' : 'asc', page: undefined }) })));
}
