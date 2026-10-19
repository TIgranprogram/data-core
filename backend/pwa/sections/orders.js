import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { badge } from '../ui/badges.js';
import { toast } from '../ui/toast.js';
import { UNITS } from './lookups.js';

/**
 * Раздел «Заказы» (PRODUCT §4, TASKS Ф.3/Ф.6) — строки заказов = доходы, коллекция incomes (/api/incomes).
 * Сумма = «доход вручную», иначе кол-во × цена; в календарь доход ложится на дату оплаты, иначе отгрузки.
 */
export const INCOME_STATUS = {
  draft: { label: 'Не отгружено', tone: 'dim' },
  awaiting: { label: 'Ждём оплату', tone: 'warn' },
  paid: { label: 'Оплачено', tone: 'ok' },
};
const STATUS_HINT = {
  '': 'Строки заказов = доходы. Кнопка в строке — следующий шаг: «Отгружено» → «Оплачено». Сумма и даты нужны для платёжного календаря.',
  draft: 'Ещё не отгружено. Отгрузили — отметьте дату отгрузки.',
  awaiting: 'Отгружено, деньги ещё не пришли. Пришли — «Оплачено».',
  paid: 'Деньги получены — доход в платёжном календаре на дату оплаты.',
};

let lk = null;
export const incomeLookups = () => (lk ??= api('/incomes/lookups').catch((e) => { lk = null; throw e; }));
incomeLookups.reset = () => { lk = null; };

const heading = (r) => (r.orderNo ? `Заказ ${r.orderNo} · ` : '') + (r.title || '—');

/** Отметить дату (оплата / отгрузка) — сегодня. */
export async function markToday(r, field) {
  const saved = await api(`/incomes/${r.id}`, { method: 'PATCH', body: { [field]: isoDay() } });
  toast(field === 'paidDate' ? `Оплачено: ${money(saved.amount)}` : 'Отгружено сегодня', {
    undo: async () => { await api(`/incomes/${r.id}`, { method: 'PATCH', body: { [field]: r[field] ? String(r[field]).slice(0, 10) : '' } }); window.dispatchEvent(new Event('data-changed')); },
  });
  return saved;
}

const toInitial = (r) => ({
  ...r, companyName: r.companyName || '',
  shipDate: r.shipDate ? String(r.shipDate).slice(0, 10) : '', paidDate: r.paidDate ? String(r.paidDate).slice(0, 10) : '',
});

export const orders = {
  id: 'orders',
  title: 'Заказы',
  newTitle: 'Новая строка заказа',
  entityType: 'Income',
  historyLabels: { 'income.created': 'Создана', 'income.updated': 'Изменена', 'income.deleted': 'Удалена', 'income.restored': 'Восстановлена' },
  get: (id) => api(`/incomes/${id}`),

  list: {
    path: '/incomes',
    sortDefault: '-reportDate',
    createLabel: 'Строка заказа',
    searchPlaceholder: 'Поиск: № заказа, заказчик, наименование…',
    emptyText: 'Заказов пока нет. Они появятся из листа «Заказы» Google-таблицы или добавьте вручную.',
    hints: STATUS_HINT,
    filters: [
      { key: 'status', label: 'Статус', type: 'chips', options: () => Object.entries(INCOME_STATUS).map(([value, s]) => ({ value, label: s.label })), count: (resp, v) => (v === '' ? resp.counts?.all : resp.counts?.[v]) },
      { key: 'companyId', label: 'Все компании', type: 'select', options: async () => (await incomeLookups()).companies.map((c) => ({ value: c.id, label: c.name })) },
      { key: 'from', label: 'С даты', short: 'с', type: 'date' },
      { key: 'to', label: 'По дату', short: 'по', type: 'date' },
      { key: 'orderNo', label: 'Заказ', type: 'hidden' },
    ],
    columns: [
      { key: 'orderNo', label: 'Заказ', sort: 'orderNo', cls: 'num', render: (r) => r.orderNo || '' },
      { key: 'customer', label: 'Заказчик', sort: 'customer', cls: 'md-hide', render: (r) => r.customer || '' },
      { key: 'title', label: 'Наименование', sort: 'title', cls: 'clip', render: (r) => h('span', { title: r.title }, r.title) },
      { key: 'qty', label: 'Кол-во', sort: 'qty', cls: 'num right', render: (r) => (r.qty != null ? `${qty(r.qty)} ${r.unit || ''}`.trim() : '') },
      { key: 'amount', label: 'Сумма', sort: 'amount', cls: 'num right', render: (r) => (r.amount ? money(r.amount) : h('span', { class: 'muted' }, 'нет суммы')) },
      { key: 'shipDate', label: 'Отгрузка', sort: 'shipDate', cls: 'num md-hide', render: (r) => date(r.shipDate) },
      { key: 'paidDate', label: 'Оплата', sort: 'paidDate', cls: 'num', render: (r) => date(r.paidDate) },
      { key: 'companyName', label: 'Компания', cls: 'md-hide', render: (r) => r.companyName || '' },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => badge(INCOME_STATUS, r.status) },
    ],
    rowAction: (r) => (r.status === 'awaiting' ? { label: 'Оплачено', title: 'Деньги пришли сегодня', run: (row) => markToday(row, 'paidDate') }
      : r.status === 'draft' ? { label: 'Отгружено', title: 'Отгрузили сегодня', run: (row) => markToday(row, 'shipDate') } : null),
    card: {
      title: heading,
      sub: (r) => [r.customer, `${qty(r.qty)} ${r.unit || ''}`.trim(), r.companyName].filter(Boolean).join(' · '),
      side: (r) => [badge(INCOME_STATUS, r.status), r.amount ? h('span', { class: 'num small' }, money(r.amount)) : null],
    },
    footer: (resp) => h('span', { class: 'sum-line' }, `Сумма по выборке: ${money(resp.sum || 0)}`),
  },

  card: {
    heading,
    subheading: (r) => [r.customer, r.companyName].filter(Boolean).join(' · '),
    stats: (r) => [['Сумма', money(r.amount || 0)], ['Отгрузка', date(r.shipDate) || '—'], ['Оплата', date(r.paidDate) || '—']],
    view: (r) => [
      ['Статус', badge(INCOME_STATUS, r.status)],
      ['Заказчик', r.customer],
      ['Наша компания', r.companyName],
      ['Форма оплаты', r.paymentForm],
      ['Количество', r.qty != null ? `${qty(r.qty)} ${r.unit || ''}`.trim() : ''],
      ['Цена за ед.', r.unitPrice != null ? money(r.unitPrice) : ''],
      ['Доход вручную', r.amountManual != null ? money(r.amountManual) : ''],
      ['Вид', r.kind],
      ['Цвет', r.color],
      ['Примечание', r.notes],
      ['В календаре', r.reportDate ? `${date(r.reportDate)} (${r.paidDate ? 'по дате оплаты' : 'по дате отгрузки'})` : h('span', { class: 'muted' }, 'не попадает — нет даты отгрузки или оплаты')],
      ['Весь заказ', r.orderNo ? h('a', { href: '#orders?orderNo=' + encodeURIComponent(r.orderNo) }, `все строки заказа ${r.orderNo} →`) : ''],
    ],
    actions: (r) => [
      !r.paidDate && { label: 'Оплачено сегодня', primary: !!r.shipDate, run: async (row, ctx) => ctx.setRow(await markToday(row, 'paidDate')) },
      !r.shipDate && { label: 'Отгружено сегодня', primary: true, run: async (row, ctx) => ctx.setRow(await markToday(row, 'shipDate')) },
    ],
  },

  form: {
    fields: async () => {
      const l = await incomeLookups().catch(() => ({ companies: [], customers: [], paymentForms: ['б/р', 'нал'] }));
      return [
        { key: 'orderNo', label: '№ заказа', max: 50 },
        { key: 'customer', label: 'Заказчик', type: 'combo', options: l.customers, max: 300 },
        { key: 'title', label: 'Наименование', required: true, wide: true, max: 500 },
        { key: 'qty', label: 'Количество', type: 'number', min: 0 },
        { key: 'unit', label: 'Ед. изм.', type: 'combo', options: UNITS, max: 30 },
        { key: 'unitPrice', label: 'Цена за ед., ₽', type: 'money', min: 0 },
        { key: 'amountManual', label: 'Доход вручную, ₽', type: 'money', min: 0, hint: 'Если заполнено — важнее кол-во × цена' },
        { key: 'companyName', label: 'Наша компания', type: 'select', options: l.companies.map((c) => c.name), hint: 'Нужна для платёжного календаря' },
        { key: 'paymentForm', label: 'Форма оплаты', type: 'combo', options: l.paymentForms, max: 50 },
        { key: 'shipDate', label: 'Дата отгрузки', type: 'date' },
        { key: 'paidDate', label: 'Дата оплаты', type: 'date' },
        { key: 'kind', label: 'Вид', max: 100 },
        { key: 'color', label: 'Цвет', max: 100 },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
      ];
    },
    initial: () => ({ unit: 'шт', paymentForm: 'б/р' }),
    toInitial,
    toBody: (v) => {
      const s = (x) => (x === null ? '' : String(x));
      return {
        orderNo: s(v.orderNo), customer: s(v.customer), title: s(v.title), unit: s(v.unit), companyName: s(v.companyName), paymentForm: s(v.paymentForm),
        kind: s(v.kind), color: s(v.color), notes: s(v.notes), shipDate: v.shipDate || '', paidDate: v.paidDate || '',
        qty: v.qty, unitPrice: v.unitPrice, amountManual: v.amountManual,
      };
    },
    create: async (body) => { const r = await api('/incomes', { method: 'POST', body }); incomeLookups.reset(); return r; },
    update: async (id, body) => { const r = await api(`/incomes/${id}`, { method: 'PATCH', body }); incomeLookups.reset(); return r; },
  },

  /** Ещё строка в тот же заказ. */
  duplicate: (r) => ({ orderNo: r.orderNo, customer: r.customer, companyName: r.companyName, paymentForm: r.paymentForm, unit: 'шт', shipDate: r.shipDate ? String(r.shipDate).slice(0, 10) : '' }),

  remove: {
    text: (r) => `Удалить строку «${heading(r)}»?`,
    run: (r) => api(`/incomes/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/incomes/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: heading(r), sub: [r.customer, money(r.amount)].filter(Boolean).join(' · '), side: badge(INCOME_STATUS, r.status) }),
  open: (id) => go('orders', { open: id }),
};
