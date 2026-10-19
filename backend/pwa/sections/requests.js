import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { badge, PRIORITY, SUPPLY_STATUS, supplyKey } from '../ui/badges.js';
import { modal } from '../ui/dialog.js';
import { quickAdd } from '../ui/quick.js';
import { toast } from '../ui/toast.js';
import { lookups, UNITS } from './lookups.js';
import { pic } from './stock.js';

/** Раздел «Заявки» (PRODUCT §1) — коллекция supplyrequests через /api/supply. */
export const STATUS_ORDER = ['in_progress', 'requested', 'ordered', 'paid', 'received', 'cancelled'];
const statusOptions = () => STATUS_ORDER.map((k) => ({ value: k, label: SUPPLY_STATUS[k].label }));
export const NEXT = { in_progress: 'requested', requested: 'ordered', ordered: 'paid' };

export const name = (r) => r.title || r.materialName || '—';
export const heading = (r) => (r.num ? `№${r.num} · ` : '') + name(r);

/** Сменить статус (без окна). Возвращает обновлённую заявку. */
export function patchStatus(r, key) {
  return api(`/supply/requests/${r.id}`, { method: 'PATCH', body: { statusLabel: SUPPLY_STATUS[key].label } });
}
async function setStatus(r, key, ctx) {
  const saved = await patchStatus(r, key);
  toast(`Статус: ${SUPPLY_STATUS[key].label}`, { undo: async () => ctx.setRow(await patchStatus(saved, supplyKey(r))) });
  ctx.setRow(saved);
}

/** Окно «Оприходовать»: возвращает обновлённую заявку или null (отмена). */
export async function receiveDialog(r) {
  const left = h('input', { name: 'qty', inputmode: 'decimal', value: String(r.qty ?? '') });
  const saved = await modal({
    title: 'Оприходовать на склад',
    body: h('div', null,
      h('p', { class: 'hint' }, `«${name(r)}» поступит на склад, заявка станет «Получено».` + (r.materialName ? '' : ' Если такой позиции на складе нет — она будет создана.')),
      h('label', { class: 'field' }, h('span', null, `Количество${r.unit ? ', ' + r.unit : ''}`), left)),
    okText: 'Оприходовать',
    onOk: async () => {
      const n = Number(String(left.value).replace(',', '.').replace(/\s/g, ''));
      if (!(n > 0)) throw new Error('Укажите количество больше нуля');
      return api(`/supply/requests/${r.id}/receive`, { method: 'POST', body: { qty: n } });
    },
  });
  if (saved) toast('Оприходовано на склад');
  return saved;
}
async function receive(r, ctx) { const saved = await receiveDialog(r); if (saved) ctx.setRow(saved); }

async function changeStatus(r, ctx) {
  const sel = h('select', { name: 'status', value: supplyKey(r) }, statusOptions().map((o) => h('option', { value: o.value }, o.label)));
  const key = await modal({
    title: 'Сменить статус', okText: 'Сохранить',
    body: h('div', null, h('label', { class: 'field' }, h('span', null, 'Статус'), sel),
      h('p', { class: 'hint' }, '«Получено» здесь не приходует товар на склад — для этого кнопка «Оприходовать».')),
    onOk: async () => sel.value,
  });
  if (key && key !== supplyKey(r)) await setStatus(r, key, ctx);
}

const fields = async (r) => {
  const lk = await lookups();
  return [
    { key: 'title', label: 'Наименование', required: true, wide: true, max: 500 },
    { key: 'qty', label: 'Количество', type: 'number', required: true, min: 0 },
    { key: 'unit', label: 'Ед. изм.', type: 'combo', options: [...new Set([...UNITS, ...(lk.units || [])])], max: 30 },
    { key: 'status', label: 'Статус', type: 'select', required: true, options: statusOptions() },
    { key: 'priority', label: 'Приоритет', type: 'select', required: true, options: Object.entries(PRIORITY).map(([value, p]) => ({ value, label: p.label })) },
    { key: 'supplierName', label: 'Поставщик', type: 'combo', options: lk.suppliers, max: 200 },
    { key: 'categoryName', label: 'Категория', type: 'combo', options: lk.categories.map((c) => c.name), max: 100 },
    { key: 'orderLabel', label: 'Заказ / заказчик', type: 'combo', options: lk.customers || [], max: 300 },
    { key: 'requestedBy', label: 'Кто подал', type: 'combo', options: lk.requestedBy, max: 200 },
    { key: 'requestDate', label: 'Дата заявки', type: 'date' },
    { key: 'companyName', label: 'Наша компания', type: 'select', options: lk.companies, hint: 'Нужна для платёжного календаря' },
    { key: 'invoiceType', label: 'Тип счёта', type: 'combo', options: lk.invoiceTypes || [], max: 60 },
    { key: 'invoiceNo', label: '№ счёта', max: 100 },
    { key: 'invoiceDate', label: 'Дата счёта', type: 'date', hint: 'В этот день расход попадёт в календарь' },
    { key: 'priceHint', label: 'Сумма с НДС, ₽', type: 'money', min: 0, hint: 'Сумма по строке, не цена за штуку' },
    { key: 'article', label: 'Артикул', max: 100 },
    { key: 'color', label: 'Цвет', max: 100 },
    { key: 'deliveryNote', label: 'Доставка', wide: true, max: 300 },
    { key: 'productUrl', label: 'Ссылка на товар', wide: true, max: 1000, placeholder: 'https://…' },
    { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
  ];
};

const toInitial = (r) => ({ ...r, status: supplyKey(r), priority: r.priority || 'normal', requestDate: r.requestDate ? isoDay(r.requestDate) : '', invoiceDate: r.invoiceDate ? String(r.invoiceDate).slice(0, 10) : '' });

export const requests = {
  id: 'requests',
  title: 'Заявки',
  newTitle: 'Новая заявка',
  entityType: 'SupplyRequest',
  historyLabels: { 'supply.request.created': 'Создана', 'supply.request.updated': 'Изменена', 'supply.request.deleted': 'Удалена', 'supply.request.restored': 'Восстановлена', 'supply.request.received': 'Оприходована' },
  get: (id) => api(`/supply/requests/${id}`),

  list: {
    path: '/supply/requests',
    sortDefault: '-requestDate',
    createLabel: 'Заявка',
    searchPlaceholder: 'Поиск: наименование, №, поставщик, заказ…',
    emptyText: 'Заявок пока нет.',
    filters: [
      { key: 'status', label: 'Статус', type: 'chips', options: statusOptions, count: (resp, v) => (v === '' ? resp.counts?.all : resp.counts?.[v]) ?? undefined },
      { key: 'supplierId', label: 'Все поставщики', type: 'select', options: async () => (await lookups()).supplierRefs.map((s) => ({ value: s.id, label: s.name })) },
      { key: 'categoryId', label: 'Все категории', type: 'select', options: async () => (await lookups()).categories.map((c) => ({ value: c.id, label: c.name })) },
      { key: 'requestedBy', label: 'Кто подал: все', type: 'select', options: async () => (await lookups()).requestedBy.map((p) => ({ value: p, label: p })) },
      { key: 'from', label: 'С даты', short: 'с', type: 'date' },
      { key: 'to', label: 'По дату', short: 'по', type: 'date' },
    ],
    columns: [
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => pic(r.photo) },
      { key: 'num', label: '№', sort: 'num', cls: 'num', render: (r) => r.num ?? '' },
      { key: 'requestDate', label: 'Дата', sort: 'requestDate', cls: 'num', render: (r) => date(r.requestDate || r.createdAt) },
      { key: 'title', label: 'Наименование', sort: 'title', cls: 'clip', render: (r) => h('span', { title: name(r) }, name(r)) },
      { key: 'qty', label: 'Кол-во', sort: 'qty', cls: 'num right', render: (r) => `${qty(r.qty)} ${r.unit || ''}`.trim() },
      { key: 'supplierName', label: 'Поставщик', cls: 'md-hide', render: (r) => r.supplierName || '' },
      { key: 'requestedBy', label: 'Кто подал', sort: 'requestedBy', cls: 'nowrap md-hide', render: (r) => r.requestedBy || '' },
      { key: 'priceHint', label: 'Сумма', sort: 'priceHint', cls: 'num right', render: (r) => money(r.priceHint) },
      { key: 'status', label: 'Статус', sort: 'status', cls: 'nowrap', render: (r) => h('span', null, badge(SUPPLY_STATUS, supplyKey(r)), r.priority === 'urgent' ? h('span', null, ' ', badge(PRIORITY, 'urgent')) : null) },
    ],
    card: {
      title: heading,
      sub: (r) => [`${qty(r.qty)} ${r.unit || ''}`.trim(), r.supplierName, r.requestedBy, date(r.requestDate)].filter(Boolean).join(' · '),
      side: (r) => [badge(SUPPLY_STATUS, supplyKey(r)), r.priceHint ? h('span', { class: 'num small' }, money(r.priceHint)) : null],
    },
    footer: (resp) => h('span', { class: 'sum-line' }, `Сумма по выборке: ${money(resp.sum || 0)}`),
    hints: {
      '': 'Все заявки. Кнопка в строке — следующий шаг: «В заказ» → «Заказано» → «Оплачено» → «Принять» на склад.',
      in_progress: 'Ждут решения: заказывать («В заказ») или отменить в карточке.',
      requested: 'Нужно заказать у поставщика. Оформили — «Заказано».',
      ordered: 'Заказано, ждём счёт и оплату. Оплатили — «Оплачено» (впишите № и дату счёта в карточке).',
      paid: 'Оплачено, ждём поставку. Пришло — «Принять»: товар встанет на склад.',
      received: 'Получено и оприходовано на склад. Делать ничего не нужно.',
      cancelled: 'Отменённые заявки — в расчёты не идут.',
    },
    rowAction: (r) => {
      const k = supplyKey(r);
      if (k === 'paid' || (k === 'ordered' && r.paid)) return { label: 'Принять', title: 'Оприходовать на склад', run: async (row) => !!(await receiveDialog(row)) };
      const to = NEXT[k];
      if (!to) return null;
      const label = { requested: 'В заказ', ordered: 'Заказано', paid: 'Оплачено' }[to];
      return { label, title: 'Статус → «' + SUPPLY_STATUS[to].label + '»', run: async (row) => {
        await patchStatus(row, to);
        toast(`${heading(row)} → ${SUPPLY_STATUS[to].label}`, { undo: async () => { await patchStatus(row, k); window.dispatchEvent(new Event('data-changed')); } });
      } };
    },
    board: {
      columns: STATUS_ORDER.map((k) => ({ key: k, label: SUPPLY_STATUS[k].label, tone: SUPPLY_STATUS[k].tone, query: { status: k, sort: '-requestDate' } })),
      card: (r) => ({
        pic: r.photo,
        title: heading(r),
        meta: [`${qty(r.qty)} ${r.unit || ''}`.trim(), r.supplierName, r.priority === 'urgent' ? badge(PRIORITY, 'urgent') : null].filter(Boolean).map((x) => (typeof x === 'string' ? h('span', null, x) : x)),
        side: r.priceHint ? money(r.priceHint) : '',
      }),
      /** Перетаскивание в колонку: «Получено» — через оприходование на склад, остальное — смена статуса. */
      move: async (r, to) => {
        if (to === 'received') return !!(await receiveDialog(r));
        await api(`/supply/requests/${r.id}`, { method: 'PATCH', body: { statusLabel: SUPPLY_STATUS[to].label } });
        toast(`«${name(r)}» → ${SUPPLY_STATUS[to].label}`);
        return true;
      },
    },
  },

  card: {
    gallery: (r) => (r.photo ? [r.photo] : []),
    heading,
    subheading: (r) => [date(r.requestDate || r.createdAt), r.requestedBy && `подал(а): ${r.requestedBy}`].filter(Boolean).join(' · '),
    view: (r) => [
      ['Статус', h('span', null, badge(SUPPLY_STATUS, supplyKey(r)), ' ', r.priority && r.priority !== 'normal' ? badge(PRIORITY, r.priority) : '')],
      ['Количество', `${qty(r.qty)} ${r.unit || ''}`.trim()],
      ['Сумма с НДС', money(r.priceHint)],
      ['Поставщик', r.supplierName],
      ['Категория', r.categoryName],
      ['Заказ / заказчик', r.orderLabel],
      ['Наша компания', r.companyName],
      ['Тип счёта', r.invoiceType],
      ['№ счёта', r.invoiceNo],
      ['Дата счёта', r.invoiceDate ? date(r.invoiceDate) : ''],
      ['Артикул', r.article],
      ['Цвет', r.color],
      ['Доставка', r.deliveryNote],
      ['Ссылка', r.productUrl ? h('a', { href: r.productUrl, target: '_blank', rel: 'noopener' }, 'открыть') : ''],
      ['Примечание', r.notes],
      ['Позиция склада', r.materialId ? h('a', { href: '#stock?open=' + r.materialId }, r.materialName || 'открыть') : ''],
      ['Оприходовано', r.status === 'received' && r.receivedQty ? qty(r.receivedQty) : ''],
    ],
    actions: (r) => {
      const k = supplyKey(r);
      return [
        !['received', 'cancelled'].includes(k) && { label: 'Оприходовать на склад', primary: true, run: receive },
        NEXT[k] && { label: '→ ' + SUPPLY_STATUS[NEXT[k]].label, run: (row, ctx) => setStatus(row, NEXT[k], ctx) },
        { label: 'Сменить статус…', run: changeStatus },
      ];
    },
  },

  form: {
    fields: () => fields(),
    initial: () => ({ qty: 1, unit: 'шт', status: 'requested', priority: 'normal', requestedBy: session.name, requestDate: isoDay() }),
    toInitial,
    toBody: (v) => {
      const s = (x) => (x === null ? '' : String(x));
      const body = {
        title: s(v.title), qty: v.qty ?? 1, unit: s(v.unit), categoryName: s(v.categoryName), supplierName: s(v.supplierName),
        companyName: s(v.companyName), orderLabel: s(v.orderLabel), requestedBy: s(v.requestedBy), article: s(v.article), color: s(v.color),
        productUrl: s(v.productUrl), invoiceType: s(v.invoiceType), invoiceNo: s(v.invoiceNo), deliveryNote: s(v.deliveryNote), notes: s(v.notes),
        statusLabel: SUPPLY_STATUS[v.status]?.label, priorityLabel: PRIORITY[v.priority]?.label,
      };
      if (v.priceHint !== null) body.priceHint = v.priceHint;
      if (v.requestDate) body.requestDate = v.requestDate;
      body.invoiceDate = v.invoiceDate || '';
      return body;
    },
    create: async (body) => { const r = await api('/supply/requests', { method: 'POST', body }); lookups.reset(); return r; },
    update: async (id, body) => { const r = await api(`/supply/requests/${id}`, { method: 'PATCH', body }); lookups.reset(); return r; },
  },

  /** Быстрая заявка одной строкой над списком (и на «Главной»). */
  quick: (after) => quickAdd({
    placeholder: 'Быстрая заявка: что нужно заказать?  (Enter — добавить)',
    unitOptions: UNITS,
    create: (v) => api('/supply/requests', { method: 'POST', body: { title: v.title, qty: v.qty, unit: v.unit, statusLabel: SUPPLY_STATUS.requested.label, requestedBy: session.name } }),
    after: (row) => { lookups.reset(); toast(`Заявка №${row.num} добавлена в «Заказать»`); after?.(row); },
  }),

  duplicate: (r) => ({ ...toInitial(r), status: 'requested', requestDate: isoDay(), requestedBy: session.name, invoiceNo: '', invoiceDate: '', num: undefined }),

  remove: {
    text: (r) => `Удалить заявку ${heading(r)}?` + (r.status === 'received' ? ' Приход на склад по ней останется — при необходимости отмените его в «Движениях».' : ''),
    run: (r) => api(`/supply/requests/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/supply/requests/${r.id}/restore`, { method: 'POST' }),
  },

  /** Для поиска по всему и корзины. */
  searchRow: (r) => ({ title: heading(r), sub: [r.supplierName, date(r.requestDate)].filter(Boolean).join(' · '), side: badge(SUPPLY_STATUS, supplyKey(r)) }),
  open: (id) => go('requests', { open: id }),
};
