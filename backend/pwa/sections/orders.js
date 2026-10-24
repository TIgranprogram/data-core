import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, parseNum, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { badge } from '../ui/badges.js';
import { modal } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { UNITS, unitList, lookups } from './lookups.js';
import { pic } from './stock.js';
import { dictNames } from '../ui/dict-options.js';
import { customerLink } from '../ui/links.js';
import { issuePassport, passports } from './passports.js';

/**
 * Раздел «Заказы» (PRODUCT §4, TASKS Ф.3/Ф.6) — строки заказов = доходы, коллекция incomes (/api/incomes).
 * Сумма = «доход вручную», иначе кол-во × цена; в календарь доход ложится на дату оплаты, иначе отгрузки.
 */
export const INCOME_STATUS = {
  draft: { label: 'Не отгружено', tone: 'dim' },
  awaiting: { label: 'Ждём оплату', tone: 'warn' },
  noamount: { label: 'Без суммы', tone: 'dim' },
  paid: { label: 'Оплачено', tone: 'ok' },
  shipped: { label: 'Отгружено', tone: 'dim' }, // роль без прав на деньги: оплату не видно (сервер, MoneyMask)
};
const STATUS_HINT = {
  '': 'Строки заказов = доходы. Кнопка в строке — следующий шаг: «Отгружено» → «Оплачено». Сумма и даты нужны для платёжного календаря.',
  draft: 'Ещё не отгружено. Отгрузили — отметьте дату отгрузки.',
  awaiting: 'Отгружено, деньги ещё не пришли. Пришли — «Оплачено».',
  noamount: 'Отгружено, но сумма не указана (в Excel-заказах цен нет). Кнопка «Вписать сумму» в строке — и строка попадёт в «Ждём оплату» и в календарь.',
  paid: 'Деньги получены — доход в платёжном календаре на дату оплаты.',
  shipped: 'Отгружено.',
};

let lk = null;
/** Изделия «Продукции» для выбора в позиции (БЗ-5): наименование · артикул. */
const productOptions = () => api('/showcase', { query: { limit: 500, sort: 'name' } })
  .then((r) => r.items.map((x) => ({ value: x.id, label: x.sku ? `${x.name} · арт. ${x.sku}` : x.name }))).catch(() => []);
const m2 = (o) => `№ ${o.orderNo || '—'} · ${o.customer || ''}`;
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

/** «Вписать сумму»: цена за единицу (сумма = кол-во × цена) или сумма строки целиком. */
export async function priceDialog(r) {
  const price = h('input', { inputmode: 'decimal', placeholder: '0,00', value: r.unitPrice ?? '' });
  const total = h('input', { inputmode: 'decimal', placeholder: '0,00', value: r.amountManual ?? '' });
  const out = h('p', { class: 'hint' });
  const show = () => {
    const p = parseNum(price.value), s = parseNum(total.value);
    out.textContent = s > 0 ? `Сумма строки: ${money(s)}` : p > 0 && r.qty ? `Сумма строки: ${qty(r.qty)} × ${money(p)} = ${money(p * r.qty)}` : 'Впишите цену за единицу или сумму целиком.';
  };
  price.addEventListener('input', show); total.addEventListener('input', show); show();
  const saved = await modal({
    title: 'Сумма: ' + (r.title || ''),
    okText: 'Сохранить',
    body: h('div', null,
      h('p', { class: 'hint' }, `${r.orderNo ? 'Заказ ' + r.orderNo + ' · ' : ''}${r.customer || ''} · ${qty(r.qty)} ${r.unit || ''}`),
      h('div', { class: 'form-grid' },
        h('label', { class: 'field' }, h('span', null, 'Цена за единицу, ₽'), price),
        h('label', { class: 'field' }, h('span', null, 'или сумма целиком, ₽'), total)),
      out),
    onOk: async () => {
      const p = parseNum(price.value), s = parseNum(total.value);
      if (!(p > 0) && !(s > 0)) throw new Error('Впишите цену или сумму больше нуля');
      return api(`/incomes/${r.id}`, { method: 'PATCH', body: { unitPrice: p > 0 ? p : null, amountManual: s > 0 ? s : null } });
    },
  });
  if (saved) toast(`Сумма: ${money(saved.amount)}${saved.shipDate ? ' — строка в платёжном календаре' : ''}`);
  return saved;
}

const toInitial = (r) => ({
  ...r, companyName: r.companyName || '', productId: r.product?.id || '',
  shipDate: r.shipDate ? String(r.shipDate).slice(0, 10) : '', paidDate: r.paidDate ? String(r.paidDate).slice(0, 10) : '',
});

export const orders = {
  id: 'orders',
  title: 'Позиции и оплаты',
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
      { key: 'status', label: 'Статус', type: 'chips', options: () => Object.entries(INCOME_STATUS).filter(([v]) => (session.canMoney ? v !== 'shipped' : v === 'draft' || v === 'shipped')).map(([value, s]) => ({ value, label: s.label })), count: (resp, v) => (v === '' ? resp.counts?.all : resp.counts?.[v]) },
      { key: 'companyId', label: 'Все компании', type: 'select', options: async () => (await incomeLookups()).companies.map((c) => ({ value: c.id, label: c.name })) },
      { key: 'from', label: 'С даты', short: 'с', type: 'date' },
      { key: 'to', label: 'По дату', short: 'по', type: 'date' },
      { key: 'orderNo', label: 'Заказ', type: 'hidden' },
    ],
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => pic(r.photos?.[0]) },
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
      : r.status === 'noamount' ? { label: 'Вписать сумму', title: 'Цена за единицу или сумма строки', run: async (row) => !!(await priceDialog(row)) }
      : r.status === 'draft' ? [{ label: 'Сумма', title: 'Цена или сумма строки', run: async (row) => !!(await priceDialog(row)) }, { label: 'Отгружено', title: 'Отгрузили сегодня', run: (row) => markToday(row, 'shipDate') }] : null),
    card: {
      title: heading,
      sub: (r) => [r.customer, `${qty(r.qty)} ${r.unit || ''}`.trim(), r.companyName].filter(Boolean).join(' · '),
      side: (r) => [badge(INCOME_STATUS, r.status), r.amount ? h('span', { class: 'num small' }, money(r.amount)) : null],
    },
    footer: (resp) => h('span', { class: 'sum-line', title: 'Сумма всех позиций в списке — с учётом вкладки, поиска и фильтров, по всем страницам' }, `Итого по списку: ${money(resp.sum || 0)} · ${qty(resp.total)} позиций`),
  },

  card: {
    gallery: (r) => r.photos || [],
    photoAdd: (r, photoId) => api(`/incomes/${r.id}/photos`, { method: 'POST', body: { photoId } }),
    photoRemove: (r, photoId) => api(`/incomes/${r.id}/photos/${photoId}`, { method: 'DELETE' }),
    heading,
    subheading: (r) => [r.customer, r.companyName].filter(Boolean).join(' · '),
    stats: (r) => [...(session.canMoney ? [['Сумма', r.amount ? money(r.amount) : 'не указана']] : []), ['Отгрузка', date(r.shipDate) || '—'], ...(session.canMoney ? [['Оплата', date(r.paidDate) || '—']] : [])],
    view: (r) => [
      ['Статус', badge(INCOME_STATUS, r.status)],
      ['Заказчик', customerLink(r.customer)],
      ['Наша компания', r.companyName],
      ['Форма оплаты', r.paymentForm],
      ['Количество', r.qty != null ? `${qty(r.qty)} ${r.unit || ''}`.trim() : ''],
      ['Цена за ед.', r.unitPrice != null ? money(r.unitPrice) : ''],
      ['Доход вручную', r.amountManual != null ? money(r.amountManual) : ''],
      ['Вид', r.kind],
      ['Цвет', r.color],
      ['Размер', r.size],
      ['Изделие', r.product ? h('a', { href: '#products?open=' + r.product.id }, r.product.name + ' →') : h('span', { class: 'muted' }, 'не привязано — выберите в «Изменить»')],
      ['Примечание', r.notes],
      ['В календаре', r.reportDate ? `${date(r.reportDate)} (${r.paidDate ? 'по дате оплаты' : 'по дате отгрузки'})` : h('span', { class: 'muted' }, 'не попадает — нет даты отгрузки или оплаты')],
      ['Весь заказ', r.orderNo ? h('a', { href: '#orders?orderNo=' + encodeURIComponent(r.orderNo) }, `все строки заказа ${r.orderNo} →`) : ''],
    ],
    actions: (r) => [
      session.canMoney && { label: r.amount ? 'Изменить сумму' : 'Вписать сумму', primary: !r.amount, run: async (row, ctx) => { const s = await priceDialog(row); if (s) ctx.setRow(s); } },
      session.canMoney && !r.paidDate && !!r.amount && { label: 'Оплачено сегодня', primary: !!r.shipDate, run: async (row, ctx) => ctx.setRow(await markToday(row, 'paidDate')) },
      session.canMoney && !!r.paidDate && { label: 'Отменить оплату', run: async (row, ctx) => { const s = await api(`/incomes/${row.id}`, { method: 'PATCH', body: { paidDate: '' } }); toast('Оплата снята'); ctx.setRow(s); } },
      !r.shipDate && { label: 'Отгружено сегодня', primary: !!r.amount, run: async (row, ctx) => ctx.setRow(await markToday(row, 'shipDate')) },
      session.sees('passports') && passports.canEdit() && { label: 'Выпустить паспорт', run: async (row) => {
        const found = await issuePassport({ productId: row.productId ? String(row.productId) : '', name: row.title, orderNo: row.orderNo || '', salesOrderId: row.orderId ? String(row.orderId) : '', customerName: row.customer || '' });
        if (!found) toast('Модель не найдена по названию — выберите её в поле «Наименование» или заполните паспорт');
      } },
    ],
  },

  form: {
    fields: async () => {
      const l = await incomeLookups().catch(() => ({ companies: [], customers: [], paymentForms: ['б/р', 'нал'] }));
      return [
        { section: 'Позиция заказа', tone: 'main', fixed: true },
        { key: 'orderId', label: 'Заказ', type: 'select', options: await import('./salesorders.js').then((m) => m.activeOrders()).then((os) => os.map((o) => ({ value: o.id, label: m2(o) }))).catch(() => []), hint: 'Позиция попадёт в карточку заказа; № и заказчик возьмутся из заказа', wide: true },
        { key: 'orderNo', label: '№ заказа (если без карточки заказа)', max: 50 },
        { key: 'customer', label: 'Заказчик', type: 'combo', options: l.customers, max: 300 },
        { key: 'title', label: 'Наименование', required: true, wide: true, max: 500 },
        { key: 'productId', label: 'Изделие из «Продукции»', type: 'select', wide: true, options: await productOptions(),
          hint: 'Для паспорта и карточки изделия. Не выбрано — подберётся по названию, если такое изделие уже есть; нет в «Продукции» — «Из заказов» там' },
        { key: 'qty', label: 'Количество', type: 'number', min: 0 },
        { key: 'unit', label: 'Ед. изм.', type: 'combo', options: unitList(await lookups().catch(() => null)), max: 30 },
        { section: 'Деньги', tone: 'money', money: true },
        { key: 'unitPrice', money: true, label: 'Цена за ед., ₽', type: 'money', min: 0 },
        { key: 'amountManual', money: true, label: 'Доход вручную, ₽', type: 'money', min: 0, hint: 'Если заполнено — важнее кол-во × цена' },
        { key: 'companyName', label: 'Наша компания', type: 'select', options: l.companies.map((c) => c.name), hint: 'Нужна для платёжного календаря' },
        { key: 'paymentForm', label: 'Форма оплаты', type: 'combo', options: l.paymentForms, max: 50 },
        { section: 'Отгрузка и оплата', tone: 'info' },
        { key: 'shipDate', label: 'Дата отгрузки', type: 'date' },
        { key: 'paidDate', label: 'Дата оплаты', type: 'date' },
        { section: 'Вид, цвет, размер, примечание', tone: 'who', collapsed: true },
        { key: 'kind', label: 'Вид', max: 100 },
        { key: 'color', label: 'Цвет', type: 'combo', max: 100, load: dictNames('colors') },
        { key: 'size', label: 'Размер', max: 100 },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
      ];
    },
    initial: () => ({ unit: 'шт', paymentForm: 'б/р' }),
    toInitial,
    toBody: (v) => {
      const s = (x) => (x === null ? '' : String(x));
      return {
        orderNo: s(v.orderNo), customer: s(v.customer), title: s(v.title), unit: s(v.unit), companyName: s(v.companyName), paymentForm: s(v.paymentForm),
        kind: s(v.kind), color: s(v.color), size: s(v.size), notes: s(v.notes), shipDate: v.shipDate || '', paidDate: v.paidDate || '',
        qty: v.qty, unitPrice: v.unitPrice, amountManual: v.amountManual, orderId: v.orderId || null,
        productId: v.productId || null, // «—» в правке — отвязать; при создании пустое не шлём (сервер подберёт по названию)
      };
    },
    create: async (body) => { if (!body.productId) delete body.productId; const r = await api('/incomes', { method: 'POST', body }); incomeLookups.reset(); return r; },
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
