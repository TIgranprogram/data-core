import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { select, actions, button, segmented, textInput, fieldRow, field } from '../ui/kit/index.js';
import { incomeLookups } from './orders.js';
import { orderChoices } from './expenses.js';
import { loadFinancialArticles, flattenArticles } from './financial-articles.js';
import { financialQuery, financialFilterChanges, FINANCE_FILTER_KEYS } from './money-operations-state.js';
export async function financialFilters(params) {
  const query = financialQuery(params);
  const [lookup, articles, orders] = await Promise.all([incomeLookups(), loadFinancialArticles({ refresh: true }), orderChoices('Все заказы')]);
  const change = (key, value) => patch(financialFilterChanges(key, value));
  const choose = (key, label, options) => field(label, select({ label, value: query[key] || '', options, onChange: value => change(key, value) }));
  const day = (key, label) => { const control = textInput({ label, type: 'date', value: query[key] }); control.input.name = key; control.input.addEventListener('change', () => change(key, control.value)); return control.el; };
  let counterpartTimer;
  const counterpart = textInput({ value: query.counterpartyName || '', label: 'Контрагент', placeholder: 'Название контрагента', onInput: value => { clearTimeout(counterpartTimer); counterpartTimer = setTimeout(() => { if (counterpart.el.isConnected) change('counterpartyName', value.trim()); }, 400); }, onEnter: value => { clearTimeout(counterpartTimer); change('counterpartyName', value); } });
  counterpart.input.name = 'counterpartyName';
  return h('div', null,
    segmented({ label: 'Вид финансовой таблицы', value: params.view === 'operations' ? 'operations' : 'articles', items: [{ key: 'articles', label: 'По статьям' }, { key: 'operations', label: 'Операции' }], onChange: value => patch({ view: value === 'operations' ? value : undefined, page: undefined }) }).el,
    fieldRow(day('from', 'С даты'), day('to', 'По дату'), counterpart.el),
    fieldRow(choose('type', 'Направление факта', [{ value: '', label: 'Поступления и выплаты' }, { value: 'income', label: 'Поступления' }, { value: 'expense', label: 'Выплаты' }]),
      choose('companyId', 'Наша компания', [{ value: '', label: params.org && params.org !== 'all' ? 'Текущая: ' + params.org : 'Все компании' }, ...(lookup.companies || []).map(row => ({ value: String(row.id), label: row.name }))]),
      choose('articleId', 'Статья', [{ value: '', label: 'Все статьи' }, { value: 'none', label: 'Без статьи' }, ...flattenArticles(articles.items || []).filter(row => !query.type || row.type === query.type).map(row => ({ value: row.id, label: `${row.type === 'income' ? 'Поступление' : 'Выплата'} · ${row.path.join(' → ')}${row.archivedAt ? ' · архивная' : ''}` }))]),
      choose('salesOrderId', 'Объект', orders), choose('costCenter', 'Направление затрат', [{ value: '', label: 'Все направления' }, { value: 'office', label: 'Офис' }, { value: 'workshop', label: 'Цех' }, { value: 'smr', label: 'СМР' }, { value: 'order', label: 'Под заказ' }]),
      choose('source', 'Источник', [{ value: '', label: 'Все источники' }, { value: 'invoice', label: 'Счета поставщиков' }, { value: 'request', label: 'Заявки прежнего учёта' }, { value: 'income', label: 'Доходы' }, { value: 'expense', label: 'Прочие расходы' }, { value: 'payroll', label: 'Выплаты ФОТ' }]),
    ),
    actions(button({ label: 'Сбросить фильтры', kind: 'ghost', onClick: () => patch({ ...Object.fromEntries(FINANCE_FILTER_KEYS.map(key => [key, undefined])), org: undefined, mode: undefined, order: undefined, page: undefined }) })),
  );
}
