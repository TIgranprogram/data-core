import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { select, button, segmented, textInput, field, searchBox } from '../ui/kit/index.js';
import { filterPanel } from '../ui/kit/filter-panel.js';
import { incomeLookups } from './orders.js';
import { orderChoices } from './expenses.js';
import { loadFinancialArticles, flattenArticles } from './financial-articles.js';
import { financialQuery, financialFilterChanges, FINANCE_FILTER_KEYS } from './money-operations-state.js';

import { operationsView } from './money-operations.js';
import { articlesView } from './money-articles.js';

export function financialFilters(opRow) {
  const content = h('div');
  const change = (key, value) => patch(financialFilterChanges(key, value));
  const choose = (key, label, options) => select({ label, options, onChange: value => change(key, value) });
  const day = (key, label) => {
    const control = textInput({ label, type: 'date' });
    control.input.name = key;
    control.input.addEventListener('change', () => change(key, control.value));
    return control;
  };
  const from = day('from', 'С даты');
  const to = day('to', 'По дату');
  const counterpart = searchBox({ label: 'Контрагент', placeholder: 'Название контрагента', delay: 400, onSearch: value => change('counterpartyName', value) });
  counterpart.input.name = 'counterpartyName';
  const type = choose('type', 'Направление факта', [
    ['', 'Поступления и выплаты'], ['income', 'Поступления'], ['expense', 'Выплаты'],
  ]);
  const company = choose('companyId', 'Наша компания', [['', 'Все компании']]);
  const article = choose('articleId', 'Статья', [['', 'Все статьи']]);
  const order = choose('salesOrderId', 'Объект', [['', 'Все заказы']]);
  const center = choose('costCenter', 'Направление затрат', [
    ['', 'Все направления'], ['office', 'Офис'], ['workshop', 'Цех'], ['smr', 'СМР'], ['order', 'Под заказ'],
  ]);
  const source = choose('source', 'Источник', [
    ['', 'Все источники'], ['invoice', 'Счета поставщиков'], ['request', 'Заявки прежнего учёта'], ['income', 'Доходы'], ['expense', 'Прочие расходы'], ['payroll', 'Выплаты ФОТ'],
  ]);
  const view = segmented({
    label: 'Вид финансовой таблицы',
    items: [{ key: 'articles', label: 'По статьям' }, { key: 'operations', label: 'Операции' }],
    onChange: value => patch({ view: value === 'operations' ? value : undefined, page: undefined }),
  });
  const reset = button({ label: 'Сбросить фильтры', kind: 'ghost', cls: 'ls-reset', onClick: () => patch({
    ...Object.fromEntries(FINANCE_FILTER_KEYS.map(key => [key, undefined])),
    org: undefined, mode: undefined, order: undefined, page: undefined,
  }) });
  const filters = filterPanel({
    key: 'money-articles',
    search: counterpart.el,
    fields: [from.el, to.el, field('Направление факта', type), field('Наша компания', company), field('Статья', article),
      field('Объект', order), field('Направление затрат', center), field('Источник', source), reset],
    content,
  });
  let seq = 0;
  const options = (control, items, value) => {
    control.replaceChildren(...items.map(({ value, label }) => h('option', { value }, label)));
    control.value = value || '';
  };
  return {
    el: h('div', null, view.el, filters.el),
    content,
    async update(params, noIncomeText, isCurrent) {
      const version = ++seq;
      from.value = params.from || '';
      to.value = params.to || '';
      const count = FINANCE_FILTER_KEYS.filter(key => key !== 'counterpartyName' && params[key]).length
        + Number(!params.companyId && !!params.org && params.org !== 'all')
        + Number(!params.salesOrderId && params.mode === 'object' && !!params.order);
      filters.setCount(count);
      reset.hidden = !count && !params.counterpartyName;
      const query = financialQuery(params);
      from.value = query.from;
      to.value = query.to;
      counterpart.set(query.counterpartyName);
      type.value = query.type || '';
      center.value = query.costCenter || '';
      source.value = query.source || '';
      view.set(params.view === 'operations' ? 'operations' : 'articles');
      const [lookup, articles, orders] = await Promise.all([incomeLookups(), loadFinancialArticles({ refresh: true }), orderChoices('Все заказы')]);
      if (version !== seq || !isCurrent()) return;
      options(company, [{ value: '', label: query.org ? 'Текущая: ' + query.org : 'Все компании' },
        ...(lookup.companies || []).map(row => ({ value: String(row.id), label: row.name }))], query.companyId);
      options(article, [{ value: '', label: 'Все статьи' }, { value: 'none', label: 'Без статьи' },
        ...flattenArticles(articles.items || []).filter(row => !query.type || row.type === query.type).map(row => ({
          value: row.id, label: `${row.type === 'income' ? 'Поступление' : 'Выплата'} · ${row.path.join(' → ')}${row.archivedAt ? ' · архивная' : ''}`,
        }))], query.articleId);
      options(order, orders, query.salesOrderId);
      const result = params.view === 'operations' ? await operationsView(params) : articlesView({
        year: query.from.slice(0, 4), org: params.org || 'all', mode: params.mode, order: params.order,
        filters: query, incomeMode: params.incomeMode, opRow, noIncomeText,
      });
      if (isCurrent()) content.replaceChildren(result);
    },
  };
}
