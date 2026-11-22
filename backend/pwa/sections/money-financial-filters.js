import { session } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { ordersLookup } from '../core/orders-lookup.js';
import { select, button, segmented, textInput, field, fieldRow, searchBox } from '../ui/kit/index.js';
import { filterPanel } from '../ui/kit/filter-panel.js';
import { incomeLookups } from './orders.js';
import { loadFinancialArticles, flattenArticles } from './financial-articles.js';
import { financialQuery, financialFilterChanges, FINANCE_FILTER_KEYS } from './money-operations-state.js';
import { operationsView } from './money-operations.js';
import { articlesView } from './money-articles.js';

const maySeePeople = () => session.canPayroll && session.sees('payroll');
const item = (value, label) => ({ value, label });
const orderLabel = (o) => ['Договор № ' + (o.orderNo || '—'), o.customer || o.title].filter(Boolean).join(' · ');
function orderOptions(rows, query) {
  const groups = new Map();
  const contracts = [];
  for (const row of rows) {
    if (row.productionNo) {
      if (!groups.has(row.productionNo)) groups.set(row.productionNo, item('order:' + row.productionNo, 'Заказ № ' + row.productionNo + (row.customer ? ' · ' + row.customer : '')));
    }
    if (!row.productionNo || row.id === query.salesOrderId) contracts.push(item('contract:' + row.id, orderLabel(row)));
  }
  return [item('', 'Все заказы'), ...groups.values(), ...contracts];
}
const options = (control, items, value, savedLabel) => {
  const found = items.some(row => row.value === value);
  const values = value && !found ? [...items, item(value, savedLabel)] : items;
  control.replaceChildren(...values.map(({ value, label }) => h('option', { value }, label)));
  control.value = value || '';
};

export function financialFilters() {
  const content = h('div');
  const change = (key, value) => patch(financialFilterChanges(key, value));
  const choose = (key, label, values) => select({ label, options: values, onChange: value => change(key, value) });
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
  const type = choose('type', 'Направление', [['', 'Доходы и расходы'], ['income', 'Доходы'], ['expense', 'Расходы']]);
  const company = choose('companyId', 'Наша компания', [['', 'Все компании']]);
  const article = choose('articleId', 'Статья', [['', 'Все статьи']]);
  const order = select({ label: 'Заказ', options: [['', 'Все заказы']], onChange: (value) => {
    const contract = value.startsWith('contract:');
    change(contract ? 'salesOrderId' : 'productionNo', value.replace(/^[^:]+:/, ''));
  } });
  const line = choose('salesOrderLineId', 'Позиция заказа', [['', 'Все позиции']]);
  const people = maySeePeople() ? choose('personId', 'Сотрудник', [['', 'Все сотрудники']]) : null;
  const center = choose('costCenter', 'Направление затрат', [
    ['', 'Все направления'], ['office', 'Офис'], ['workshop', 'Цех'], ['smr', 'СМР'], ['order', 'Под заказ'],
  ]);
  const source = choose('source', 'Источник', [
    ['', 'Все источники'], ['invoice', 'Счета поставщиков'], ['request', 'Заявки прежнего учёта'], ['income', 'Доходы'], ['expense', 'Прочие расходы'],
    ...(people ? [['payroll', 'Выплаты ФОТ']] : []),
  ]);
  const view = segmented({
    fit: true, label: 'Вид финансовой таблицы',
    items: [{ key: 'articles', label: 'По статьям' }, { key: 'operations', label: 'Операции' }],
    onChange: value => patch({ view: value === 'operations' ? value : undefined, page: undefined }),
  });
  const reset = button({ label: 'Сбросить фильтры', kind: 'ghost', size: 'S', onClick: () => patch({
    ...Object.fromEntries(FINANCE_FILTER_KEYS.map(key => [key, undefined])),
    org: undefined, mode: undefined, order: undefined, page: undefined,
  }) });
  const dates = fieldRow(from.el, to.el);
  dates.classList.add('fin-filter-dates');
  const filters = filterPanel({
    key: 'money-articles',
    search: [counterpart.el, view.el],
    fields: [dates, field('Заказ', order), field('Позиция заказа', line),
      people ? field('Сотрудник · выплаты ФОТ', people) : null,
      field('Наша компания', company), field('Направление', type), field('Статья', article),
      field('Направление затрат', center), field('Источник', source), reset],
    content,
  });
  filters.el.classList.add('fin-report-filter');
  let seq = 0, mounted = null;
  const destroy = () => { seq++; mounted?.destroy(); mounted = null; };

  return {
    el: filters.el,
    content,
    destroy,
    async update(params, isCurrent) {
      destroy();
      const version = seq;
      const query = financialQuery(params);
      if (!people) delete query.personId;
      const count = FINANCE_FILTER_KEYS.filter(key => key !== 'counterpartyName' && params[key]).length
        + Number(!params.companyId && !!params.org && params.org !== 'all')
        + Number(!params.salesOrderId && params.mode === 'object' && !!params.order);
      filters.setCount(count);
      reset.hidden = !count && !params.counterpartyName;
      from.value = query.from;
      to.value = query.to;
      counterpart.set(query.counterpartyName);
      type.value = query.type || '';
      center.value = query.costCenter || '';
      source.value = query.source || '';
      view.set(params.view === 'operations' ? 'operations' : 'articles');

      const current = () => version === seq && isCurrent();
      const setFacets = (data) => {
        if (!current()) return;
        options(line, [item('', 'Все позиции'), ...(data?.orderLines || []).map(row => item(row.id, row.label))], query.salesOrderLineId, 'Выбранная позиция');
        line.disabled = !query.salesOrderLineId && !(data?.orderLines || []).length;
        if (people) options(people, [item('', 'Все сотрудники'), ...(data?.people || []).map(row => item(row.id, row.label))], query.personId, 'Выбранный сотрудник');
      };
      const p = Promise.all([incomeLookups().catch(() => ({})), loadFinancialArticles({ refresh: true }).catch(() => ({})), ordersLookup({ filter: 'all' }).catch(() => [])]);
      if (params.view === 'operations') {
        const output = await operationsView({ ...params, personId: query.personId }, setFacets);
        if (current()) content.replaceChildren(output);
      } else {
        mounted = articlesView({ year: query.from.slice(0, 4), org: params.org || 'all', mode: params.mode, order: params.order, filters: query,
          incomeMode: params.incomeMode, onFacets: setFacets });
        content.replaceChildren(mounted.el);
      }
      const [lookup, articles, orders] = await p;
      if (!current()) return;
      options(company, [item('', query.org ? 'Текущая: ' + query.org : 'Все компании'),
        ...(lookup.companies || []).map(row => item(String(row.id), row.name))], query.companyId, 'Выбранная компания');
      options(article, [item('', 'Все статьи'), item('none', 'Без статьи'),
        ...flattenArticles(articles.items || []).filter(row => !query.type || row.type === query.type).map(row => item(row.id,
          (row.type === 'income' ? 'Доход' : 'Расход') + ' · ' + row.path.join(' → ') + (row.archivedAt ? ' · архивная' : '')))],
      query.articleId, 'Выбранная статья');
      const selected = query.productionNo ? 'order:' + query.productionNo : query.salesOrderId ? 'contract:' + query.salesOrderId : '';
      options(order, orderOptions(orders, query), selected, query.productionNo ? 'Заказ № ' + query.productionNo : 'Выбранный заказ');
    },
  };
}
