import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, parseNum, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { attachCombo } from '../ui/combo.js';
import { badge } from '../ui/badges.js';
import { modal } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { openSide, noteField, sideForm } from '../ui/side-form.js';
import { UNITS, unitList, lookups } from './lookups.js';
import { pic } from './stock.js';
import { dictNames } from '../ui/dict-options.js';
import { customerLink } from '../ui/links.js';
// УПР-1/Д11: issuePassport и passports.canEdit() убраны — вход только через панель паспорта

/**
 * Раздел «Заказы» (PRODUCT §4, TASKS Ф.3/Ф.6) — строки заказов = доходы, коллекция incomes (/api/incomes).
 * Сумма = «доход вручную», иначе кол-во × цена; в календарь доход ложится на дату оплаты, иначе отгрузки.
 */
export const INCOME_STATUS = {
  draft: { label: 'Не отгружено', tone: 'dim' },
  awaiting: { label: 'Ждём оплату', tone: 'warn' },
  partial: { label: 'Частично оплачено', tone: 'info' },
  noamount: { label: 'Без суммы', tone: 'dim' },
  paid: { label: 'Оплачено', tone: 'ok' },
  shipped: { label: 'Отгружен', tone: 'dim' }, // роль без прав на деньги: оплату не видно (сервер, MoneyMask)
};
const STATUS_HINT = {
  '': 'Строки заказов = доходы. Кнопка в строке — следующий шаг: «Отгружено» → «Оплачено» (платёж можно принять частями). Сумма и даты нужны для платёжного календаря.',
  draft: 'Ещё не отгружено. Отгрузили — отметьте дату отгрузки.',
  awaiting: 'Отгружено, деньги ещё не пришли. Пришли — «Оплачено»: откроется окно платежа.',
  partial: 'Часть денег пришла, остаток (долг) ещё нет. Кнопка «Принять оплату» — принять следующий платёж.',
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

/** Сегодня по Москве (ГГГГ-ММ-ДД) — дата платежа по умолчанию. */
export const todayMsk = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Отметить дату отгрузки — сегодня. Оплата — не здесь: см. paymentDialog (платёж с суммой). */
export async function markToday(r, field) {
  const saved = await api(`/incomes/${r.id}`, { method: 'PATCH', body: { [field]: isoDay() } });
  toast('Отгружен сегодня', {
    undo: async () => { await api(`/incomes/${r.id}`, { method: 'PATCH', body: { [field]: r[field] ? String(r[field]).slice(0, 10) : '' } }); window.dispatchEvent(new Event('data-changed')); },
  });
  return saved;
}

/** «Выбрать изделие»: до 3 предложений сервера (ПРЖ-4) + поиск по «Продукции» → productId в PATCH позиции. Название заказчика не меняется. */
async function pickProduct(r) {
  let opts = []; let loadErr = '';
  const inp = h('input', { type: 'text', placeholder: 'Название или артикул изделия', autocomplete: 'off', value: r.product ? r.product.name : '' });
  let picked = r.productId || r.product?.id || '';
  const field = h('label', { class: 'field' }, h('span', null, 'Изделие из «Продукции»'), inp);
  const sugg = h('div', { class: 'hint' });
  const choose = (id, label) => { inp.value = label; inp.title = label; picked = id; };
  attachCombo(inp, { options: () => opts, onPick: (o) => { picked = o.value; }, empty: () => loadErr || undefined });
  inp.addEventListener('input', () => { picked = ''; });
  productOptions().then((o) => { opts = o; if (!o.length) loadErr = 'Список изделий пуст или не загрузился — закройте окно и откройте снова'; });
  if (r.orderId) {
    api(`/salesorders/${r.orderId}/match-products`, { method: 'POST', body: {} }).then((res) => {
      const sg = (res?.items || []).find((x) => String(x.lineId) === String(r.id))?.suggestions || [];
      if (!sg.length) return;
      sugg.append('Похоже на: ', ...sg.slice(0, 3).flatMap((x, i) => [i ? ', ' : '', h('a', { href: '#', onclick: (e) => { e.preventDefault(); choose(x.productId, x.name); } }, x.name)]));
    }).catch(() => {});
  }
  return modal({
    title: 'Выбрать изделие',
    okText: 'Выбрать',
    body: h('div', null,
      h('p', { class: 'hint' }, `Позиция в заказе: «${r.title || ''}». Название заказчика останется как есть; изделие нужно для паспорта и единого названия.`),
      sugg, field),
    onOk: async () => {
      if (!picked) throw new Error('Выберите изделие из списка');
      const s = await api(`/incomes/${r.id}`, { method: 'PATCH', body: { productId: picked } });
      incomeLookups.reset();
      return s;
    },
  });
}

/** «Вписать сумму» — правая панель (П3): цена за единицу или сумма строки целиком. */
export const priceDialog = (r) => { openSide('incprice', r.id); return Promise.resolve(null); };
const incomeHint = (r) => `${r.orderNo ? 'Заказ ' + r.orderNo + ' · ' : ''}${r.customer || ''} · ${qty(r.qty)} ${r.unit || ''}`;
export const incPrice = sideForm({
  id: 'incprice', title: 'Вписать сумму', canEdit: () => session.canMoney, entityType: 'Income', noun: 'позицию',
  get: (id) => api(`/incomes/${id}`),
  heading: (r) => r.title || '—',
  subheading: incomeHint,
  saveLabel: 'Сохранить',
  fields: (r) => {
    const out = h('p', { class: 'hint' }, 'Впишите цену за единицу или сумму целиком.');
    const note = h('div', null, h('p', { class: 'hint' }, incomeHint(r)), out);
    return [noteField(note), { key: 'unitPrice', money: true, label: 'Цена за единицу, ₽', type: 'money', min: 0, mount: (f) => { const show = () => { const p = parseNum(f.get('unitPrice')) || 0, s = parseNum(f.get('amountManual')) || 0; out.textContent = s > 0 ? `Сумма строки: ${money(s)}` : p > 0 && r.qty ? `Сумма строки: ${qty(r.qty)} × ${money(p)} = ${money(p * r.qty)}` : 'Впишите цену за единицу или сумму целиком.'; }; f.on('unitPrice', show); f.on('amountManual', show); show(); } },
      { key: 'amountManual', money: true, label: 'или сумма целиком, ₽', type: 'money', min: 0 }];
  },
  toInitial: (r) => ({ unitPrice: r.unitPrice ?? null, amountManual: r.amountManual ?? null }),
  toBody: (v) => {
    const p = Number(v.unitPrice) || 0, s = Number(v.amountManual) || 0;
    if (!(p > 0) && !(s > 0)) throw new Error('Впишите цену или сумму больше нуля');
    return { unitPrice: p > 0 ? p : null, amountManual: s > 0 ? s : null };
  },
  save: async (body, r) => { const saved = await api(`/incomes/${r.id}`, { method: 'PATCH', body }); toast(`Сумма: ${money(saved.amount)}${saved.shipDate ? ' — строка в платёжном календаре' : ''}`); return saved; },
});

/** «Принять оплату» — правая панель (П3): дата (сегодня по Москве), сумма (по умолчанию = долг), способ. POST /incomes/:id/payments. */
export const paymentDialog = (r) => { openSide('incpay', r.id); return Promise.resolve(null); };
export const incPay = sideForm({
  id: 'incpay', title: 'Принять оплату', canEdit: () => session.canMoney, entityType: 'Income', noun: 'позицию',
  get: async (id) => ({ ...(await api(`/incomes/${id}`)), _methods: (await incomeLookups().catch(() => ({ paymentMethods: ['нал', 'безнал', 'карта'] }))).paymentMethods || [] }),
  heading: (r) => r.title || '—',
  subheading: incomeHint,
  saveLabel: 'Принять оплату',
  fields: (r) => {
    const debt = r.debt != null ? r.debt : Math.max(0, (Number(r.amount) || 0) - (Number(r.paidAmount) || 0));
    return [noteField(h('p', { class: 'hint' }, `Сумма ${money(r.amount)} · оплачено ${money(r.paidAmount || 0)} · долг ${money(debt)}`)),
      { key: 'date', label: 'Дата', type: 'date', required: true, span: 1 },
      { key: 'amount', money: true, label: 'Сумма, ₽', type: 'money', min: 0, required: true, span: 1 },
      { key: 'method', label: 'Способ', type: 'select', options: (r._methods || []).map((m) => ({ value: m, label: m })) }];
  },
  toInitial: (r) => { const debt = r.debt != null ? r.debt : Math.max(0, (Number(r.amount) || 0) - (Number(r.paidAmount) || 0)); return { date: todayMsk(), amount: debt > 0 ? debt : null, method: '' }; },
  toBody: (v) => {
    const a = Number(v.amount) || 0;
    if (!(a > 0)) throw new Error('Впишите сумму больше нуля');
    if (!v.date) throw new Error('Укажите дату платежа');
    return { date: v.date, amount: a, ...(v.method ? { method: v.method } : {}) };
  },
  save: async (body, r) => { const saved = await api(`/incomes/${r.id}/payments`, { method: 'POST', body }); toast(`Оплата принята: ${money(saved.paidAmount)} из ${money(saved.amount)}`); return saved; },
});

/** Блок «Оплаты» в карточке позиции: список платежей, «+ Платёж», удаление. */
function paymentsBlock(r, ctx) {
  if (!session.canMoney) return null;
  const list = r.payments || [];
  const canEdit = session.canEdit;
  return h('div', { class: 'card-block' },
    h('div', { class: 'q-head' }, h('h3', null, 'Оплаты'), canEdit && Number(r.amount) > 0 && r.debt > 0 ? h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { const s = await paymentDialog(r); if (s) ctx.setRow(s); } }, '+ Оплата') : null),
    list.length ? h('ul', { class: 'q-list' }, list.map((p, i) => h('li', { class: 'q-row' },
      h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, date(p.date)), h('div', { class: 'q-sub' }, [p.method, p.note].filter(Boolean).join(' · '))),
      h('div', { class: 'q-side' }, h('span', { class: 'num pos' }, money(p.amount)),
        canEdit ? h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Удалить платёж', onclick: async () => { ctx.setRow(await api(`/incomes/${r.id}/payments/${i}`, { method: 'DELETE' })); toast('Оплата удалена'); } }, '✕') : null))))
      : h('p', { class: 'muted' }, Number(r.amount) > 0 ? 'Платежей пока нет.' : 'Сначала впишите сумму позиции.'),
    list.length ? h('p', { class: 'hint' }, `Оплачено ${money(r.paidAmount)} из ${money(r.amount)}; долг ${money(r.debt)}.`) : null);
}

let locked = false;
const LOCKED_KEYS = ['title', 'qty', 'unit', 'unitPrice', 'amountManual'];

const toInitial = (r) => ({
  ...r, companyName: r.companyName || '', productId: r.product?.id || '',
  shipDate: r.shipDate ? String(r.shipDate).slice(0, 10) : '', paidDate: r.paidDate ? String(r.paidDate).slice(0, 10) : '',
});

export const orders = {
  id: 'orders',
  title: 'Позиции заказов',
  newTitle: 'Новая строка заказа',
  entityType: 'Income',
  historyLabels: { 'income.created': 'Создана', 'income.updated': 'Изменена', 'income.deleted': 'Удалена', 'income.restored': 'Восстановлена' },
  get: (id) => api(`/incomes/${id}`),

  list: {
    path: '/incomes',
    export: 'admin',
    sortDefault: '-reportDate',
    createLabel: 'Строка заказа',
    searchPlaceholder: 'Поиск: № заказа, заказчик, наименование…',
    emptyText: 'Позиций нет. Добавьте заказ в разделе «Заказы» — его позиции появятся здесь.',
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
      { key: 'title', label: 'Название', sort: 'title', cls: 'clip', render: (r) => h('span', { title: r.title }, r.title) },
      { key: 'qty', label: 'Кол-во', sort: 'qty', cls: 'num right', render: (r) => (r.qty != null ? `${qty(r.qty)} ${r.unit || ''}`.trim() : '') },
      { key: 'amount', label: 'Сумма', sort: 'amount', cls: 'num right', render: (r) => (r.amount ? money(r.amount) : session.canMoney && session.canEdit ? h('a', { href: '#', class: 'muted', title: 'Вписать цену или сумму', onclick: async (e) => { e.preventDefault(); e.stopPropagation(); if (await priceDialog(r)) window.dispatchEvent(new Event('data-changed')); } }, 'нет суммы — вписать') : h('span', { class: 'muted' }, 'нет суммы')) },
      { key: 'shipDate', label: 'Отгрузка', sort: 'shipDate', cls: 'num md-hide', render: (r) => date(r.shipDate) },
      { key: 'paidDate', label: 'Оплата', sort: 'paidDate', cls: 'num', render: (r) => date(r.paidDate) },
      { key: 'companyName', label: 'Наша компания', cls: 'md-hide', render: (r) => r.companyName || '' },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => badge(INCOME_STATUS, r.status) },
    ],
    rowAction: (r) => (r.status === 'awaiting' || r.status === 'partial' ? { label: r.status === 'partial' ? 'Принять оплату' : 'Оплачено', title: 'Принять оплату: сумма по умолчанию — весь долг', run: async (row) => !!(await paymentDialog(row)) }
      : r.status === 'noamount' ? { label: 'Вписать сумму', title: 'Цена за единицу или сумма строки', run: async (row) => !!(await priceDialog(row)) }
      : r.status === 'draft' ? [{ label: 'Сумма', title: 'Цена или сумма строки', run: async (row) => !!(await priceDialog(row)) }, { label: 'Отгрузить', title: 'Отгрузили сегодня', run: (row) => markToday(row, 'shipDate') }] : null),
    card: {
      title: heading,
      sub: (r) => [r.customer, `${qty(r.qty)} ${r.unit || ''}`.trim(), r.companyName].filter(Boolean).join(' · '),
      side: (r) => [badge(INCOME_STATUS, r.status), r.amount ? h('span', { class: 'num small' }, money(r.amount)) : null],
    },
    footer: (resp) => h('span', { class: 'sum-line', title: 'Сумма, оплачено и долг по всем позициям списка — с учётом вкладки, поиска и фильтров, по всем страницам' }, resp.money && session.canMoney ? `Итого: сумма ${money(resp.money.sum)} · оплачено ${money(resp.money.paid)} · долг ${money(resp.money.debt)} · ${qty(resp.total)} позиций` : `${qty(resp.total)} позиций`),
  },

  card: {
    zones: { extra: 'side' }, // УПР-3: оплаты — боковой колонкой
    extra: (r, ctx) => paymentsBlock(r, ctx),
    parent: (r) => (r.orderId ? { label: `Заказ № ${r.orderNo || '—'}`, run: () => go('salesorders', { open: String(r.orderId) }) } : null),
    gallery: (r) => r.photos || [],
    photoAdd: (r, photoId) => api(`/incomes/${r.id}/photos`, { method: 'POST', body: { photoId } }),
    photoRemove: (r, photoId) => api(`/incomes/${r.id}/photos/${photoId}`, { method: 'DELETE' }),
    photoMain: (r, photoId) => api(`/incomes/${r.id}/photos/${photoId}/main`, { method: 'PUT' }),
    heading,
    subheading: (r) => [r.customer, r.companyName].filter(Boolean).join(' · '),
    stats: (r) => [...(session.canMoney ? [['Сумма', r.amount ? money(r.amount) : 'не указана']] : []), ['Отгрузка', date(r.shipDate) || '—'], ...(session.canMoney ? [['Оплачено', r.paidAmount ? money(r.paidAmount) : '—'], ['Долг', r.amount ? money(r.debt || 0) : '—']] : [])],
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
      ['Названия', r.product || r.title ? h('div', null, ...[['В заказе', r.title], ['Короткое', r.product?.name], ['Полное', r.product?.fullName]].filter(([, v]) => v).map(([k, v]) => h('div', null, h('span', { class: 'muted' }, k + ': '), v))) : ''],
      ['Изделие', r.product ? h('a', { href: '#products?open=' + r.product.id }, r.product.name + ' →') : h('span', { class: 'muted' }, 'не привязано — выберите в «Изменить»')],
      ['Примечание', r.notes],
      ['В календаре', r.reportDate ? `${date(r.reportDate)} (${r.paidDate ? 'по дате оплаты' : 'по дате отгрузки'})` : h('span', { class: 'muted' }, 'не попадает — нет даты отгрузки или оплаты')],
      ['Весь заказ', r.orderId ? h('a', { href: '#salesorders?open=' + encodeURIComponent(String(r.orderId)) }, `все строки заказа ${r.orderNo || ''} →`) : ''],
    ],
    actions: (r) => [
      session.canEdit && { label: r.product ? 'Сменить изделие' : 'Выбрать изделие', title: 'Связать позицию с изделием из «Продукции» — для паспорта и единого названия', primary: !r.product && !!r.orderId, run: async (row, ctx) => { const s = await pickProduct(row); if (s) ctx.setRow(s); } },
      session.canMoney && { label: r.amount ? 'Изменить сумму' : 'Вписать сумму', primary: !r.amount, run: async (row, ctx) => { const s = await priceDialog(row); if (s) ctx.setRow(s); } },
      session.canMoney && !r.paidDate && !!r.amount && { label: 'Принять оплату', primary: !!r.shipDate, run: async (row, ctx) => { const s = await paymentDialog(row); if (s) ctx.setRow(s); } },
      session.canMoney && (!!r.paidDate || r.paidAmount > 0) && { label: 'Отменить оплату', run: async (row, ctx) => { const s = await api(`/incomes/${row.id}`, { method: 'PATCH', body: { paidDate: '' } }); toast('Оплата снята'); ctx.setRow(s); } },
      !r.shipDate && { label: 'Отгрузить сегодня', primary: !!r.amount, run: async (row, ctx) => ctx.setRow(await markToday(row, 'shipDate')) },
      // УПР-1/Д11: «Выпустить паспорт» убрана — единственный вход в passports.js
      session.seesDocs() && r.orderId && { label: 'Паспорт →', title: 'Паспорта по заказу', run: (_row) => { go('docs', { tab: 'archive' }); } },
    ],
  },

  form: {
    fields: async (row) => {
      const l = await incomeLookups().catch(() => ({ companies: [], customers: [], paymentForms: ['б/р', 'нал'] }));
      // Заказ уже в работе: название, кол-во, ед. и цены меняет только администратор (сервер иначе вернёт 403)
      locked = false;
      if (row?.orderId && session.role !== 'admin') {
        const o = await api(`/salesorders/${row.orderId}`).catch(() => null);
        locked = !!o && (o.stage || 'new') !== 'new';
      }
      const all = [
        { section: locked ? 'Позиция заказа — название, количество и цену менять может администратор' : 'Позиция заказа', tone: 'main', fixed: true },
        { key: 'orderId', label: 'Заказ', type: 'select', options: await import('./salesorders.js').then((m) => m.activeOrders()).then((os) => os.map((o) => ({ value: o.id, label: m2(o) }))).catch(() => []), hint: 'Позиция попадёт в карточку заказа; № и заказчик возьмутся из заказа', wide: true },
        { key: 'orderNo', label: '№ договора (если без карточки заказа)', max: 50 },
        { key: 'customer', label: 'Заказчик', type: 'combo', options: l.customers, max: 300 },
        { key: 'title', label: 'Название', required: true, wide: true, max: 500 },
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
      return locked ? all.filter((f) => !LOCKED_KEYS.includes(f.key)) : all;
    },
    initial: () => ({ unit: 'шт', paymentForm: 'б/р' }),
    toInitial,
    toBody: (v) => {
      const s = (x) => (x === null ? '' : String(x));
      const body = {
        orderNo: s(v.orderNo), customer: s(v.customer), title: s(v.title), unit: s(v.unit), companyName: s(v.companyName), paymentForm: s(v.paymentForm),
        kind: s(v.kind), color: s(v.color), size: s(v.size), notes: s(v.notes), shipDate: v.shipDate || '', paidDate: v.paidDate || '',
        qty: v.qty, unitPrice: v.unitPrice, amountManual: v.amountManual, orderId: v.orderId || null,
        productId: v.productId || null, // «—» в правке — отвязать; при создании пустое не шлём (сервер подберёт по названию)
      };
      if (locked) for (const k of LOCKED_KEYS) delete body[k];
      return body;
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
  open: (id) => go('money', { tab: 'debts', of: 'orders', open: id }),
};

/**
 * Список «Деньги → Долги»: тот же список позиций (чипы статусов, компания, даты, итог «долг», экспорт),
 * но без создания строк — новые позиции добавляются только из карточки заказа. Карточка — `of=orders`.
 */
export const debts = {
  ...orders,
  title: 'Долги',
  list: {
    ...orders.list,
    createLabel: false,
    emptyText: 'Позиций нет. Позиции появляются из заказов (раздел «Заказы»).',
  },
};
