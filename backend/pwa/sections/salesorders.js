import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, parseNum, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { badge } from '../ui/badges.js';
import { toast } from '../ui/toast.js';
import { incomeLookups } from './orders.js';
import { customerLink } from '../ui/links.js';
import { errText } from '../ui/errors.js';
import { orderReservations } from './order-reservations.js';
import { suggestLink } from '../ui/composition-suggest.js';

/**
 * Раздел «Заказы» (TASKS фаза З): заказ = шапка (`salesorders`) + позиции (строки `incomes`).
 * Вкладки «В работе / Выполненные», доска по этапам, карточка: позиции, что заказано под заказ
 * (заявки) и что отпущено со склада. Выполненные сворачиваются по месяцам отгрузки (фаза М).
 */
export const STAGE = {
  new: { label: 'Новый', tone: 'primary' },
  production: { label: 'В производстве', tone: 'info' },
  ready: { label: 'Готов к отгрузке', tone: 'warn' },
  shipped: { label: 'Отгружен', tone: 'ok' },
  closed: { label: 'Закрыт', tone: 'dim' },
  cancelled: { label: 'Отменён', tone: 'danger' },
};
const NEXT = { new: 'production', production: 'ready', ready: 'shipped', shipped: 'closed' };
const NEXT_LABEL = { new: 'В производство', production: 'Готов', ready: 'Отгружен', shipped: 'Закрыть' };
const HINT = {
  '': 'Все заказы заказчиков. Кнопка в строке — следующий этап. Клик — позиции заказа, заявки и выдача со склада.',
  active: 'Заказы в работе: новые, в производстве, готовые к отгрузке. Красный срок — просрочено.',
  done: 'Отгруженные и закрытые заказы — по месяцам отгрузки. Нажмите на месяц, чтобы раскрыть.',
};

const heading = (r) => `Заказ № ${r.orderNo || '—'}`;
const deadline = (r) => r.shipDate || r.productionDeadline || r.deliveryDeadline;
function due(r) {
  const d = deadline(r);
  if (!d) return h('span', { class: 'muted' }, '—');
  const late = !['shipped', 'closed', 'cancelled'].includes(r.stage) && new Date(d) < new Date(isoDay());
  return h('span', { class: late ? 'neg' : '', title: late ? 'Срок прошёл' : '' }, date(d));
}
async function setStage(r, stage) {
  const saved = await api(`/salesorders/${r.id}`, { method: 'PATCH', body: { stage, ...(stage === 'shipped' && !r.shipDate ? { shipDate: isoDay() } : {}) } });
  toast(`${heading(r)} → ${STAGE[stage].label}`, { undo: async () => { await api(`/salesorders/${r.id}`, { method: 'PATCH', body: { stage: r.stage } }); window.dispatchEvent(new CustomEvent('data-changed')); } });
  return saved;
}

/** Быстрая строка «+ позиция» в карточке заказа: наименование, кол-во, ед. → Enter. Фото — в карточке позиции. */
function addLineRow(r, after) {
  const title = h('input', { placeholder: 'Новая позиция: наименование (Enter — добавить)', maxlength: 500 });
  const q = h('input', { inputmode: 'decimal', value: '1', class: 'so-q', 'aria-label': 'Количество' });
  const unit = h('select', { 'aria-label': 'Ед. изм.' }, ...['шт', 'компл', 'пара', 'м', 'м²', 'кг'].map((u) => h('option', { value: u }, u)));
  const btn = h('button', { class: 'btn btn-primary btn-sm', type: 'button' }, 'Добавить');
  const go = async () => {
    const name = title.value.trim();
    if (!name) { title.focus(); return; }
    btn.disabled = true;
    try {
      const line = await api('/incomes', { method: 'POST', body: { orderId: r.id, title: name, qty: parseNum(q.value) || 1, unit: unit.value, clientUid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) } });
      toast(`Позиция добавлена — откройте её, чтобы добавить фото и сумму`);
      title.value = ''; q.value = '1';
      window.dispatchEvent(new CustomEvent('data-changed'));
      after(line);
    } catch (e) { toast(errText(e), { error: true }); } finally { btn.disabled = false; }
  };
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  btn.addEventListener('click', go);
  return h('div', { class: 'so-add' }, title, q, unit, btn);
}

/** «Выдано со склада» по позициям заказа (SK-5b): нетто = выдано − возвращено; позиция — «552-2 · название». */
function issuedBlock(d, sec) {
  const by = d.issuedByLine || [];
  if (!by.length) return '';
  const lines = d.lines || [];
  const groups = new Map();
  for (const x of by) { const k = x.salesOrderLineId ? String(x.salesOrderLineId) : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const title = (k) => { if (!k) return 'Весь заказ (без позиции)'; const i = lines.findIndex((l) => String(l.id) === k); return i < 0 ? 'Позиция заказа' : `${d.orderNo || ''}-${lines[i].lineNo || i + 1} · ${lines[i].title}`; };
  return sec(`Выдано со склада по позициям (${groups.size})`, h('ul', { class: 'timeline' }, ...[...groups].flatMap(([k, xs]) => xs.map((x, i) => h('li', i ? { class: 'tl-cont' } : null,
    i === 0 ? h('span', { class: 'tl-line', title: title(k) }, title(k)) : null, h('span', null, x.materialName || 'позиция'),
    h('span', { class: 'num neg', title: 'Выдано минус возвращено' }, qty(x.net) + ' ' + (x.unit || '')),
    h('span', { class: 'muted' }, `выдано ${qty(x.issued)}${x.returned ? ', возвращено ' + qty(x.returned) : ''}`),
    i === 0 && k && lines.find((l) => String(l.id) === k)?.productId ? suggestLink(k) : null)))));
}

function details(r) {
  const box = h('div', null, h('div', { class: 'muted' }, 'Загрузка позиций…'));
  const load = () => api(`/salesorders/${r.id}`).then((d) => {
    const lines = d.lines || [];
    const sec = (title, ...kids) => h('div', { class: 'so-sec' }, h('div', { class: 'section-title' }, title), ...kids);
    box.replaceChildren(
      sec(`Позиции (${lines.length})`, lines.length
        ? h('table', { class: 'so-lines' }, h('thead', null, h('tr', null, h('th', null, '№'), h('th', null, ''), h('th', null, 'Наименование'), h('th', { class: 'num' }, 'Кол-во'), h('th', null, 'Цвет'), session.canMoney ? h('th', { class: 'num' }, 'Сумма') : null)),
          h('tbody', null, ...lines.map((l, i) => h('tr', { onclick: () => patch({ of: 'orders', open: l.id }, { replace: false }), title: 'Открыть позицию: фото, сумма, отгрузка, оплата (назад — к заказу)' },
            h('td', { class: 'muted' }, l.lineNo || i + 1), h('td', { class: 'pic-cell' }, l.photo ? h('img', { class: 'pic so-pic', src: PREFIX + (l.photo.thumb || l.photo.url), alt: '', loading: 'lazy', title: 'Открыть фото', onclick: (e) => { e.stopPropagation(); window.open(PREFIX + l.photo.url, '_blank'); }, onerror: (e) => e.target.remove() }) : null), h('td', null, l.title), h('td', { class: 'num nowrap' }, `${qty(l.qty)} ${l.unit || ''}`),
            h('td', { class: 'muted' }, l.color || ''), session.canMoney ? h('td', { class: 'num' }, l.amount ? money(l.amount) : '') : null))))
        : h('p', { class: 'muted' }, 'Позиций пока нет — добавьте ниже.'),
        session.canEdit && !['closed', 'cancelled'].includes(r.stage) ? addLineRow(r, () => load()) : null),
      sec(`Заказано под заказ (${(d.supplyRequests || []).length})`, (d.supplyRequests || []).length
        ? h('ul', { class: 'timeline' }, ...d.supplyRequests.map((s) => h('li', null, h('a', { href: '#requests?open=' + (s.id || s._id) }, `№${s.num ?? ''} ${s.title}`), h('span', { class: 'muted' }, ` · ${qty(s.qty)} ${s.unit || ''} · ${s.statusLabel || s.status || ''}`))))
        : h('p', { class: 'muted' }, 'Заявок под этот заказ нет. В заявке выберите «Заказ» — она появится здесь.')),
      // брони заказа по позициям, «Выдать по заказу» (SK-6b); грузится отдельным запросом
      orderReservations({ id: r.id, orderNo: r.orderNo }, load),
      issuedBlock(d, sec),
      sec(`Отпущено со склада (${(d.stockMovements || []).length})`, (d.stockMovements || []).length
        ? h('ul', { class: 'timeline' }, ...d.stockMovements.map((m) => h('li', null, h('span', { class: 'when' }, date(m.date)), h('span', null, m.materialName || 'позиция'), h('span', { class: 'num neg' }, '−' + qty(m.qty)), h('span', { class: 'muted' }, [m.issuedToLabel && 'кому: ' + m.issuedToLabel, m.notes].filter(Boolean).join(' · ')))))
        : h('p', { class: 'muted' }, 'Списаний под заказ нет. На «Складе» → «Выдать» выберите этот заказ.')));
  }).catch((e) => box.replaceChildren(h('p', { class: 'muted' }, 'Не удалось загрузить: ' + errText(e))));
  load();
  return box;
}

export const salesorders = {
  id: 'salesorders',
  title: 'Заказы',
  newTitle: 'Новый заказ',
  entityType: 'SalesOrder',
  historyLabels: { 'salesorder.created': 'Создан', 'salesorder.updated': 'Изменён', 'salesorder.deleted': 'Удалён', 'salesorder.restored': 'Восстановлен' },
  get: (id) => api(`/salesorders/${id}`),

  list: {
    path: '/salesorders',
    sortDefault: 'shipDate',
    createLabel: 'Заказ',
    searchPlaceholder: 'Поиск: № заказа, заказчик, предмет, контракт…',
    emptyText: 'Заказов пока нет.',
    filters: [
      { key: 'filter', label: 'Состояние', type: 'chips', options: () => [{ value: 'active', label: 'В работе' }, { value: 'done', label: 'Выполненные' }], count: (resp, v) => (v === '' ? resp.counts?.all : resp.counts?.[v]) },
    ],
    hints: HINT,
    hintKey: 'filter',
    periods: (P) => (P.filter === 'done' ? { date: (r) => r.shipDate || r.updatedAt, total: session.canMoney ? (rs) => money(rs.reduce((s, r) => s + (Number(r.amount) || 0), 0)) : undefined } : null),
    rowAction: (r) => (NEXT[r.stage] ? { label: NEXT_LABEL[r.stage], title: 'Следующий этап', run: (row) => setStage(row, NEXT[row.stage]) } : null),
    columns: [
      { key: 'orderNo', label: '№', sort: 'orderNo', cls: 'nowrap', render: (r) => h('b', null, r.orderNo || '—') },
      { key: 'customer', label: 'Заказчик', sort: 'customer', cls: 'clip', render: (r) => h('span', { title: r.customer || '' }, r.customer || '') },
      { key: 'title', label: 'Предмет / позиции', cls: 'clip md-hide', render: (r) => h('span', { class: 'muted', title: r.title || '' }, r.title || `${r.lineCount} поз.`) },
      { key: 'companyName', label: 'Компания', cls: 'md-hide', render: (r) => r.companyName || h('span', { class: 'muted' }, '—') },
      { key: 'lineCount', label: 'Поз.', cls: 'num right', render: (r) => qty(r.lineCount) },
      { key: 'shipDate', label: 'Срок', sort: 'shipDate', cls: 'nowrap', render: due },
      { key: 'amount', money: true, label: 'Сумма', cls: 'num right md-hide', render: (r) => (r.amount ? money(r.amount) : h('span', { class: 'muted' }, '—')) },
      { key: 'stage', label: 'Этап', sort: 'stage', cls: 'nowrap', render: (r) => badge(STAGE, r.stage) },
    ],
    card: {
      title: (r) => `№ ${r.orderNo || '—'} · ${r.customer || ''}`,
      sub: (r) => [r.title, `${r.lineCount} поз.`, deadline(r) ? 'срок ' + date(deadline(r)) : ''].filter(Boolean).join(' · '),
      side: (r) => [badge(STAGE, r.stage)],
    },
    board: {
      columns: ['new', 'production', 'ready', 'shipped'].map((k) => ({ key: k, label: STAGE[k].label, tone: STAGE[k].tone, query: { stage: k, sort: k === 'shipped' ? '-shipDate' : 'shipDate' } })),
      card: (r) => ({
        title: `№ ${r.orderNo || '—'} · ${r.customer || ''}`,
        meta: [r.title ? h('span', null, r.title.slice(0, 80)) : null, h('span', null, `${r.lineCount} поз.`), deadline(r) ? due(r) : null].filter(Boolean),
        side: r.amount && session.canMoney ? money(r.amount) : '',
      }),
      move: async (r, to) => { await setStage(r, to); return true; },
    },
  },

  card: {
    heading,
    subheading: (r) => [r.customer, r.companyName].filter(Boolean).join(' · '),
    stats: (r) => [['Этап', STAGE[r.stage]?.label || r.stage], ['Позиций', qty(r.lineCount)], ...(session.canMoney ? [['Сумма', r.amount ? money(r.amount) : '—'], ['Оплачено', r.paidAmount ? money(r.paidAmount) : '—']] : [])],
    view: (r) => [
      ['Заказчик', customerLink(r.customer)],
      ['Предмет', r.title],
      ['Наша компания', r.companyName || h('span', { class: 'muted' }, 'не указана')],
      ['Форма оплаты', r.paymentForm],
      ['Контракт', [r.contractNo, r.contractDate && 'от ' + date(r.contractDate)].filter(Boolean).join(' ')],
      ['Срок изготовления', date(r.productionDeadline)],
      ['Дата отгрузки', date(r.shipDate)],
      ['Окончание поставки', date(r.deliveryDeadline)],
      ['Примечание', r.notes],
    ],
    actions: (r) => [
      NEXT[r.stage] && { label: NEXT_LABEL[r.stage], primary: true, run: async (row, ctx) => ctx.setRow(await setStage(row, NEXT[row.stage])) },
      r.stage !== 'cancelled' && !['shipped', 'closed'].includes(r.stage) && { label: 'Отменить заказ', run: async (row, ctx) => ctx.setRow(await setStage(row, 'cancelled')) },
      !['closed', 'cancelled'].includes(r.stage) && session.canEdit && { label: 'Загрузить спецификацию', title: 'Файл Excel → брони под позиции этого заказа', run: (row) => patch({ of: 'specimport', new: '1', orderId: row.id, open: undefined }, { replace: false }) },
      { label: '+ Позиция', run: (row) => go('orders', { new: '1', orderNo: row.orderNo || '', customer: row.customer || '', companyName: row.companyName || '', orderId: row.id }) },
    ],
    extra: (r) => details(r),
  },

  form: {
    fields: async () => {
      const l = await incomeLookups().catch(() => ({ companies: [], customers: [], paymentForms: ['б/р', 'б/р 30%', 'б/р 50%', 'нал'] }));
      return [
        { section: 'Заказ', tone: 'main', fixed: true },
        { key: 'orderNo', label: '№ заказа', required: true, max: 50 },
        { key: 'customer', label: 'Заказчик', type: 'combo', options: l.customers, max: 300 },
        { key: 'title', label: 'Предмет заказа', wide: true, max: 1000 },
        { key: 'companyName', label: 'Наша компания', type: 'select', options: l.companies.map((c) => c.name) },
        { key: 'paymentForm', label: 'Форма оплаты', type: 'combo', options: l.paymentForms, max: 50 },
        { key: 'stage', label: 'Этап', type: 'select', required: true, options: Object.entries(STAGE).map(([value, s]) => ({ value, label: s.label })) },
        { section: 'Сроки', tone: 'info' },
        { key: 'productionDeadline', label: 'Срок изготовления', type: 'date' },
        { key: 'shipDate', label: 'Дата отгрузки', type: 'date' },
        { key: 'deliveryDeadline', label: 'Окончание поставки', type: 'date' },
        { section: 'Контракт и примечание', tone: 'who', collapsed: true },
        { key: 'contractNo', label: '№ контракта', max: 100 },
        { key: 'contractDate', label: 'Дата контракта', type: 'date' },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
      ];
    },
    initial: () => ({ stage: 'new', paymentForm: 'б/р' }),
    toInitial: (r) => ({ ...r, ...Object.fromEntries(['shipDate', 'productionDeadline', 'deliveryDeadline', 'contractDate'].map((k) => [k, r[k] ? String(r[k]).slice(0, 10) : ''])) }),
    toBody: (v) => {
      const s = (x) => (x === null ? '' : String(x));
      return { orderNo: s(v.orderNo), customer: s(v.customer), title: s(v.title), companyName: s(v.companyName), paymentForm: s(v.paymentForm), stage: v.stage,
        productionDeadline: v.productionDeadline || '', shipDate: v.shipDate || '', deliveryDeadline: v.deliveryDeadline || '', contractNo: s(v.contractNo), contractDate: v.contractDate || '', notes: s(v.notes) };
    },
    create: (body) => api('/salesorders', { method: 'POST', body: { ...body, clientUid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) } }),
    update: (id, body) => api(`/salesorders/${id}`, { method: 'PATCH', body }),
  },

  remove: {
    text: (r) => `Удалить ${heading(r).toLowerCase()} (${r.customer || 'без заказчика'})? Позиции останутся в «Позициях заказов».`,
    run: (r) => api(`/salesorders/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/salesorders/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: `${heading(r)} · ${r.customer || ''}`, sub: [r.title, `${r.lineCount} поз.`].filter(Boolean).join(' · '), side: badge(STAGE, r.stage) }),
  open: (id) => go('salesorders', { open: id }),
};

/** Выбор заказа и позиции (для заявок и списаний, З.6): заказы в работе. Кэш на 1 минуту. */
let cache = null; let cacheAt = 0;
export async function activeOrders() {
  if (cache && Date.now() - cacheAt < 60000) return cache;
  const r = await api('/salesorders', { query: { filter: 'active', limit: 500, sort: 'orderNo' } });
  cache = r.items; cacheAt = Date.now();
  return cache;
}
export const orderLabel = (o) => `№ ${o.orderNo || '—'} · ${o.customer || ''}`.trim();

/** Варианты «Заказ / позиция» для выпадающего списка (З.6): «id» — весь заказ, «id:lineId» — позиция. */
export async function orderOptions(keep) {
  const [orders, lines] = await Promise.all([activeOrders(), api('/incomes', { query: { limit: 3000, sort: 'lineNo' } }).then((r) => r.items).catch(() => [])]);
  const byOrder = new Map();
  for (const l of lines) if (l.orderId) { const k = String(l.orderId); if (!byOrder.has(k)) byOrder.set(k, []); byOrder.get(k).push(l); }
  const opts = [];
  for (const o of orders) {
    opts.push({ value: o.id, label: orderLabel(o) + ' — весь заказ' });
    for (const l of byOrder.get(o.id) || []) opts.push({ value: o.id + ':' + l.id, label: `   └ ${l.lineNo ? l.lineNo + '. ' : ''}${String(l.title || '').slice(0, 70)}` });
  }
  if (keep && !opts.some((x) => x.value === keep)) opts.unshift({ value: keep, label: 'Заказ (выполнен или удалён)' });
  return opts;
}
export const splitRef = (ref) => { const [o, l] = String(ref || '').split(':'); return { salesOrderId: o || '', salesOrderLineId: l || '' }; };
export const joinRef = (r) => (r.salesOrderId ? String(r.salesOrderId) + (r.salesOrderLineId ? ':' + String(r.salesOrderLineId) : '') : '');
