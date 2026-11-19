import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { date, money } from '../core/format.js';
import { table, link, actions, button, stats, clamp } from '../ui/kit/index.js';
import { operationsQuery } from './money-operations-state.js';
const articleCell = row => { const path = (row.articlePath || []).map(part => typeof part === 'string' ? part : part.name); return h('span', null, clamp(h('b', null, path.at(-1) || 'Без статьи'), { lines: 2 }), path.length > 1 ? clamp(path.join(' → '), { lines: 3 }) : null); };
const centers = { office: 'Офис', workshop: 'Цех', smr: 'СМР', order: 'Под заказ' };
export async function operationsView(params) {
  const query = operationsQuery(params), data = await api('/finance/operations', { query });
  const open = row => patch({ of: 'moneyclassification', open: row.operationId, new: undefined });
  return h('div', null,
    stats([{ label: 'Поступления', value: money(data.totals.income) }, { label: 'Выплаты', value: money(data.totals.expense) }, { label: 'Денежный результат', value: money(data.totals.net) }]),
    h('p', { class: 'hint' }, `Итоги по всем ${data.total} отобранным строкам, до пагинации. Только подтверждённые факты; это денежный результат, а не бухгалтерская прибыль.`),
    table({ label: 'Фактические денежные операции', columns: [{ label: 'Дата', nowrap: true }, { label: 'Факт' }, { label: 'Сумма,₽', num: true, nowrap: true }, { label: 'Наша компания' }, { label: 'Статья / путь', wrap: true }, { label: 'Контрагент', wrap: true }, { label: 'Объект', wrap: true }, { label: 'Направление' }, { label: 'Документ / источник', wrap: true }, { label: 'Классификация', wrap: true }],
      rows: (data.items || []).map(row => ({ data: row.operationId, cells: [date(row.date), row.type === 'income' ? 'Поступление' : 'Выплата', money(row.amount), row.companyName || 'Не указана', articleCell(row), clamp(row.counterpartyName || 'Не указан', { lines: 3 }), clamp(row.projectName || row.costObject || 'Не указан', { lines: 3 }), centers[row.costCenter] || 'Не указано', h('span', null, clamp(row.docNo || row.source, { lines: 3 }), ' ', row.sourceLink ? link({ label: 'Исходный документ', href: row.sourceLink }) : ''),
        h('span', null, link({ label: row.classificationEditable ? 'Уточнить для отчёта' : 'Просмотреть', onClick: () => open(row) }), row.classificationOrigin === 'override' ? ' · Уточнено для отчёта' : '', !row.classificationEditable ? ' · ' + (row.classificationReason || row.classificationEditableReason || row.reason || 'Только просмотр') : '')] })), empty: { title: 'Фактов по этим условиям нет', hint: 'Измените период или фильтры.' } }),
    actions(button({ label: 'Предыдущая страница', kind: 'ghost', disabled: data.page <= 1, onClick: () => patch({ page: data.page - 1 }) }), h('span', null, `Страница ${data.page} · строк ${(data.items || []).length} из ${data.total}`), button({ label: 'Следующая страница', kind: 'ghost', disabled: data.page * data.limit >= data.total, onClick: () => patch({ page: data.page + 1 }) }),
      button({ label: query.sort === 'date' ? 'Сортировать по сумме' : 'Сортировать по дате', kind: 'ghost', onClick: () => patch({ sort: query.sort === 'date' ? 'amount' : 'date', page: undefined }) }), button({ label: query.dir === 'asc' ? 'По убыванию' : 'По возрастанию', kind: 'ghost', onClick: () => patch({ dir: query.dir === 'asc' ? 'desc' : 'asc', page: undefined }) })),
  );
}
