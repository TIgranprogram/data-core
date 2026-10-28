import { api, PREFIX, session } from '../core/api.js';
import { ordersLookup } from '../core/orders-lookup.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, parseNum, qty } from '../core/format.js';
import { go, patch } from '../core/router.js';
import { badge, ORDER_PRIORITY } from '../ui/badges.js';
import { toast } from '../ui/toast.js';
import { confirmDlg, modal } from '../ui/dialog.js';
import { incomeLookups } from './orders.js';
import { customerLink } from '../ui/links.js';
import { errText } from '../ui/errors.js';
import { failBlock } from '../ui/busy.js';
import { orderReservations } from './order-reservations.js';
import { suggestLink } from '../ui/composition-suggest.js';
import { orderDesign } from './order-design.js';
import { unassignedTop, addContractsDialog } from './salesorders-unassigned.js';
import { shipmentsBlock, historyBlock, canShip } from './order-shipments.js';

/**
 * Раздел «Заказы» (TASKS фаза З): заказ = шапка (`salesorders`) + позиции (строки `incomes`).
 * Вкладки «В работе / Выполненные», доска по этапам, карточка: позиции, что заказано под заказ
 * (заявки) и что отпущено со склада. Выполненные сворачиваются по месяцам отгрузки (фаза М).
 */
export const STAGE = {
  new: { label: 'Проектирование', tone: 'primary' },
  production: { label: 'Производство', tone: 'info' },
  ready: { label: 'Готово к отгрузке', tone: 'warn' },
  partly: { label: 'Частично отгружен', tone: 'warn' },
  shipped: { label: 'Отгружена', tone: 'ok' },
  closed: { label: 'Закрыт', tone: 'dim' },
  cancelled: { label: 'Отменён', tone: 'danger' },
};
const NEXT = { new: 'production', production: 'ready', ready: 'shipped', shipped: 'closed' };
const NEXT_LABEL = { new: 'В производство', production: 'Готово к отгрузке', ready: 'Отгружена', shipped: 'Закрыть' };
const HINT = {
  new: 'Новые (входящие): ещё не в проектировании, не в производстве и не отгружены. Начните — «В производство» или передайте в проектирование.',
  active: 'Заказы в работе: проектирование, производство, готовые к отгрузке. Красный срок — просрочено.',
  done: 'Отгруженные и закрытые заказы — по месяцам отгрузки. Нажмите на месяц, чтобы раскрыть.',
};

/** Приоритет заказа: «обычный» не показываем. */
const prio = (r) => (r.priority && r.priority !== 'normal' ? badge(ORDER_PRIORITY, r.priority) : null);
/** № заказа = № на производство (productionNo); № договора (orderNo) — справка. Несколько договоров с одним № — один заказ производства. */
export const prodNo = (r) => r?.productionNo || 'нет №';
const heading = (r) => (r.productionNo ? `Заказ № ${r.productionNo}` : `Заказ без № · договор ${(r.orderNos || [r.orderNo])[0] || '—'}`);
const deadline = (r) => r.deadline || r.shipDate || r.productionDeadline || r.deliveryDeadline;
function due(r) {
  const d = deadline(r);
  if (!d) return h('span', { class: 'muted' }, '—');
  const late = !['shipped', 'closed', 'cancelled'].includes(r.stage) && new Date(d) < new Date(isoDay());
  return h('span', { class: late ? 'neg' : '', title: late ? 'Срок прошёл' : '' }, date(d));
}
/** Договор: свой этап (PATCH /salesorders/:id), с отменой. */
async function setContractStage(r, stage) {
  const saved = await api(`/salesorders/${r.id}`, { method: 'PATCH', body: { stage, ...(stage === 'shipped' && !r.shipDate ? { shipDate: isoDay() } : {}) } });
  toast(`Договор ${r.orderNo || ''} → ${STAGE[stage].label}`, { undo: async () => { await api(`/salesorders/${r.id}`, { method: 'PATCH', body: { stage: r.stage } }); window.dispatchEvent(new CustomEvent('data-changed')); } });
  return saved;
}
/** Заказ: следующий этап «ко всем договорам» — сервер подтягивает только отстающие. null — отказались. */
async function setStage(r, stage) {
  const many = (r.orderNos || []).length > 1;
  if (many && !(await confirmDlg(`${heading(r)}: «${STAGE[stage].label}» — ко всем договорам?`, 'Этап сменится у договоров, которые отстают. Остальные не меняются.', { okText: 'Да, ко всем' }))) return null;
  const saved = await api(`/production-orders/${encodeURIComponent(r.key)}/stage`, { method: 'POST', body: { stage } });
  toast(`${heading(r)} → ${STAGE[stage].label}${saved?.changed?.length ? ` (договоров: ${saved.changed.length})` : ''}`);
  return shape(saved);
}

/** «Связать с каталогом»: предложения сервера по всем позициям без изделия → выбор → apply. Возвращает обновлённый заказ или null. */
async function matchProducts(r) {
  const res = await api(`/salesorders/${r.id}/match-products`, { method: 'POST', body: {} });
  const items = res?.items || [];
  if (!items.length) { toast('Все позиции уже с изделием'); return null; }
  const rows = items.map((it) => {
    const sel = h('select', null,
      ...(it.suggestions || []).map((s) => h('option', { value: s.productId }, `${s.name}${s.sku ? ' · ' + s.sku : ''}`)),
      h('option', { value: '' }, 'Без изделия'));
    return { it, sel, el: h('label', { class: 'field' }, h('span', null, `${it.lineNo ? it.lineNo + '. ' : ''}${it.title || ''}`), sel) };
  });
  const saved = await modal({
    title: 'Связать с каталогом', okText: 'Сохранить', wide: true,
    body: h('div', null, h('p', { class: 'hint' }, 'Первое предложение отмечено. Выберите «Без изделия», если подходящего нет.'), ...rows.map((x) => x.el)),
    onOk: async () => {
      const picks = rows.filter((x) => x.sel.value).map((x) => ({ lineId: x.it.lineId, productId: x.sel.value }));
      if (!picks.length) return {};
      const a = await api(`/salesorders/${r.id}/match-products`, { method: 'POST', body: { apply: true, picks } });
      toast(`Изделий привязано: ${a?.count ?? picks.length}`);
      return api(`/salesorders/${r.id}`);
    },
  });
  return saved && saved.id ? saved : null;
}

/** Быстрая строка «+ позиция» в карточке заказа: наименование, кол-во, ед. → Enter. Фото — в карточке позиции. */
let focusNewLine = false; // ТИ-8: после создания заказа сразу даём ввести первую позицию
const ourLine = (l) => {
  const our = l.product?.ourName || (l.productName && [l.sku || l.productSku, l.productName].filter(Boolean).join(' · '));
  if (our) return h('div', { class: 'muted small' }, 'Наше: ' + our);
  return l.productId || l.product ? null : h('div', { class: 'muted small' }, 'Свяжите с каталогом');
};
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
  if (focusNewLine) { focusNewLine = false; setTimeout(() => { title.scrollIntoView?.({ block: 'center' }); title.focus(); }, 50); }
  return h('div', { class: 'so-add' }, title, q, unit, btn);
}

/** «Выдано со склада» по позициям заказа (SK-5b): нетто = выдано − возвращено; позиция — «552-2 · название». */
function issuedBlock(d, sec) {
  const by = d.issuedByLine || [];
  if (!by.length) return '';
  const lines = d.lines || [];
  const groups = new Map();
  for (const x of by) { const k = x.salesOrderLineId ? String(x.salesOrderLineId) : ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  const title = (k) => { if (!k) return 'Весь заказ (без позиции)'; const i = lines.findIndex((l) => String(l.id) === k); return i < 0 ? 'Позиция заказа' : `${d.productionNo || d.orderNo || ''}-${lines[i].seqNo ?? lines[i].lineNo ?? i + 1} · ${lines[i].title}`; };
  return sec(`Выдано со склада по позициям (${groups.size})`, h('ul', { class: 'timeline' }, ...[...groups].flatMap(([k, xs]) => xs.map((x, i) => h('li', i ? { class: 'tl-cont' } : null,
    i === 0 ? h('span', { class: 'tl-line', title: title(k) }, title(k)) : null, h('span', null, x.materialName || 'позиция'),
    h('span', { class: 'num neg', title: 'Выдано минус возвращено' }, qty(x.net) + ' ' + (x.unit || '')),
    h('span', { class: 'muted' }, `выдано ${qty(x.issued)}${x.returned ? ', возвращено ' + qty(x.returned) : ''}`),
    i === 0 && k && lines.find((l) => String(l.id) === k)?.productId ? suggestLink(k) : null)))));
}

/** Строка «Паспорта N (готовы M)» → вкладка «По заказам» (ТИ-11). */
function orderPassports(r) {
  if (!session.seesDocs()) return null;
  const val = h('span', { class: 'muted' }, 'загрузка…');
  api('/passports', { query: { salesOrderId: r.id, limit: 200 } }).then((d) => {
    const items = (d.items || []).filter((p) => p.status !== 'annulled');
    const ready = items.filter((p) => (p.readiness || (p.status === 'draft' ? 'notReady' : 'ready')) === 'ready').length;
    val.replaceChildren(items.length ? h('a', { href: '#docs?tab=orders&open=' + r.id }, `Паспорта ${items.length} (готовы ${ready})`) : 'пока не выпускали — «Выпустить паспорт» в позиции заказа');
  }).catch(() => val.replaceChildren('не удалось загрузить'));
  return h('div', { class: 'so-sec' }, h('div', { class: 'section-title' }, 'Паспорта'), val);
}

const sec = (title, ...kids) => h('div', { class: 'so-sec' }, h('div', { class: 'section-title' }, title), ...kids);
const seq = (l, i) => l.seqNo ?? l.lineNo ?? i + 1;
const closedStage = (o) => ['closed', 'cancelled'].includes(o.stage);

/** Группа «Договор 109-П»: шапка с кнопками, позиции (сквозной №), «ещё» — паспорта, отгрузки, склад (строится при раскрытии). */
function contractGroup(o, reload) {
  const lines = o.lines || [];
  const seeReq = session.sees('requests'), seeStock = session.sees('stock');
  const acts = [];
  if (session.canEdit) acts.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Изменить договор: № договора, заказчик, этап, срок, примечание', onclick: () => patch({ of: 'salesorder', open: o.id }, { replace: false }) }, 'Изменить договор'));
  if (!['closed', 'cancelled', 'new'].includes(o.stage) && canShip()) acts.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => patch({ of: 'shipdo', open: o.id }, { replace: false }) }, 'Отгрузить'));
  if (!closedStage(o) && session.canEdit && session.sees('stock')) acts.push(h('button', { class: 'btn btn-ghost btn-sm', type: 'button', title: 'Файл Excel → брони под позиции этого договора', onclick: () => patch({ of: 'specimport', new: '1', orderId: o.id, open: undefined }, { replace: false }) }, 'Спецификация'));
  const head = h('div', { class: 'so-grp-head' },
    h('div', { class: 'so-grp-title' }, h('b', null, 'Договор ' + (o.orderNo || '—')), h('span', { class: 'muted' }, o.customer ? ' · ' + o.customer : ''), ' ', badge(STAGE, o.stage), ' ', due(o)),
    acts.length ? h('div', { class: 'so-grp-acts' }, ...acts) : null);
  const table = lines.length
    ? h('table', { class: 'so-lines' }, h('thead', null, h('tr', null, h('th', null, '№'), h('th', null, ''), h('th', null, 'Наименование'), h('th', { class: 'num' }, 'Кол-во'), h('th', { class: 'num' }, 'Отгружено'), h('th', null, 'Цвет'), session.canMoney ? h('th', { class: 'num' }, 'Сумма') : null)),
      h('tbody', null, ...lines.map((l, i) => h('tr', { onclick: () => patch({ of: 'orders', open: l.id }, { replace: false }), title: 'Открыть позицию: фото, сумма, отгрузка, оплата (назад — к заказу)' },
        h('td', { class: 'muted' }, seq(l, i)), h('td', { class: 'pic-cell' }, l.photo ? h('img', { class: 'pic so-pic', src: PREFIX + (l.photo.thumb || l.photo.url), alt: '', loading: 'lazy', title: 'Открыть фото', onclick: (e) => { e.stopPropagation(); window.open(PREFIX + l.photo.url, '_blank'); }, onerror: (e) => e.target.remove() }) : null), h('td', null, l.title, ourLine(l)), h('td', { class: 'num nowrap' }, `${qty(l.qty)} ${l.unit || ''}`),
        h('td', { class: 'num nowrap muted' }, l.shipped ? `${qty(l.shipped)} из ${qty(l.qty)}` : ''), h('td', { class: 'muted' }, l.color || ''), session.canMoney ? h('td', { class: 'num' }, l.amount ? money(l.amount) : '') : null))))
    : h('p', { class: 'muted' }, 'В этом договоре позиций пока нет — добавьте ниже.');
  const add = session.canEdit && !closedStage(o) ? (o.stage === 'new' || session.role === 'admin' ? addLineRow(o, reload) : h('p', { class: 'hint' }, 'Договор уже в работе — менять позиции может администратор.')) : null;
  const more = h('details', { class: 'so-more' }, h('summary', null, 'Паспорта, отгрузки, проектирование, склад'));
  let built = false;
  more.addEventListener('toggle', () => {
    if (!more.open || built) return; built = true;
    const seqBy = new Map(lines.map((l, i) => [String(l.id), seq(l, i)]));
    more.append(...[
      orderPassports(o),
      shipmentsBlock({ id: o.id, stage: o.stage }, reload),
      historyBlock({ id: o.id }),
      orderDesign({ id: o.id, orderNo: o.productionNo || o.orderNo }, lines),
      seeReq ? sec(`Заказано под заказ (${(o.supplyRequests || []).length})`,
        (o.supplyRequests || []).length ? h('ul', { class: 'timeline' }, ...o.supplyRequests.map((s) => h('li', null, h('a', { href: '#requests?open=' + (s.id || s._id) }, `№${s.num ?? ''} ${s.title}`), h('span', { class: 'muted' }, ` · ${qty(s.qty)} ${s.unit || ''} · ${s.statusLabel || s.status || ''}`)))) : h('p', { class: 'muted' }, 'Заявок под этот заказ пока нет.'),
        h('button', { class: 'btn btn-sm', type: 'button', title: 'Новая заявка: заказ и заказчик подставятся сами', onclick: () => patch({ of: 'requests', new: '1', open: undefined, salesOrderRef: o.id, orderLabel: o.customer || undefined }) }, '+ Заявка под этот заказ')) : null,
      seeStock ? orderReservations({ id: o.id, orderNo: o.orderNo, productionNo: o.productionNo, seqBy }, reload) : null,
      seeStock ? issuedBlock(o, sec) : null,
      seeStock && (o.stockMovements || []).length ? sec(`Отпущено со склада (${o.stockMovements.length})`,
        h('ul', { class: 'timeline' }, ...o.stockMovements.map((m) => h('li', null, h('span', { class: 'when' }, date(m.date)), h('span', null, m.materialName || 'позиция'), h('span', { class: 'num neg' }, '−' + qty(m.qty)), h('span', { class: 'muted' }, [m.issuedToLabel && 'кому: ' + m.issuedToLabel, m.notes].filter(Boolean).join(' · ')))))) : null,
    ].filter((x) => x != null && x !== false && x !== ''));
  });
  return h('div', { class: 'so-grp' }, head, table, add, more);
}

/** «К производству»: одинаковые позиции всех договоров заказа сложены вместе (только просмотр). */
function produceBlock(d) {
  const t = d.toProduce || [];
  if (!t.length) return null;
  return sec(`К производству (${t.length})`,
    h('table', { class: 'so-lines' }, h('thead', null, h('tr', null, h('th', null, '№'), h('th', null, 'Изделие'), h('th', { class: 'num' }, 'Кол-во'), h('th', null, 'Ед.'), h('th', null, 'Из позиций'))),
      h('tbody', null, ...t.map((x, i) => h('tr', null, h('td', { class: 'muted' }, i + 1), h('td', null, x.title), h('td', { class: 'num nowrap' }, qty(x.qty)), h('td', { class: 'muted' }, x.unit || ''), h('td', { class: 'muted' }, (x.seqNos || []).join(', ')))))),
    h('p', { class: 'hint' }, 'Одинаковые позиции всех договоров заказа сложены вместе — чтобы запустить в работу сразу всё. Это только просмотр.'));
}

function details(r) {
  const box = h('div', null);
  const paint = (d) => box.replaceChildren(...[
    produceBlock(d),
    sec(`Договоры (${(d.orders || []).length})`, ...((d.orders || []).length ? d.orders.map((o) => contractGroup(o, reload)) : [h('p', { class: 'muted' }, 'Договоров нет.')])),
  ].filter(Boolean));
  const reload = () => api(`/production-orders/${encodeURIComponent(r.key)}`).then((d) => paint(d)).catch((e) => box.replaceChildren(failBlock(e, reload)));
  if (r.orders) paint(r); else { box.append(h('div', { class: 'muted' }, 'Загрузка…')); reload(); }
  return box;
}

const uniq = (a) => [...new Set(a.filter(Boolean))];
const sumOf = (os, k) => os.reduce((s, o) => s + (Number(o[k]) || 0), 0);
/** Карточка заказа с сервера → вид строки раздела (id = key). */
function shape(d) {
  const os = d.orders || [];
  return { ...d, id: d.key, orderNos: os.map((o) => o.orderNo), customers: uniq(os.map((o) => o.customer)), companyNames: uniq(os.map((o) => o.companyName)),
    lineCount: os.reduce((s, o) => s + (o.lineCount ?? (o.lines || []).length), 0), amount: sumOf(os, 'amount'), paidAmount: sumOf(os, 'paidAmount') };
}
const stageCell = (r) => h('span', null, badge(STAGE, r.stage), r.stagesDiffer ? h('span', { class: 'muted small', title: 'У договоров заказа разные этапы — показан самый отстающий' }, ' · разные') : null);
const names = (a) => (a || []).join(', ');

export const salesorders = {
  id: 'salesorders',
  title: 'Заказы',
  entityType: 'SalesOrder',
  // карточка — заказ производства (key = № заказа или id договора без №); старые ссылки по id договора находят свой заказ
  get: async (id) => {
    try { return shape(await api(`/production-orders/${encodeURIComponent(id)}`)); }
    catch (e) {
      if (e?.status !== 404 || !/^[0-9a-f]{24}$/i.test(String(id))) throw e;
      const o = await api(`/salesorders/${id}`);
      return shape(await api(`/production-orders/${encodeURIComponent(o.productionNo || id)}`));
    }
  },

  list: {
    path: '/production-orders',
    map: (r) => ({ ...r, id: r.key }),
    export: 'admin',
    sortDefault: 'deadline',
    createLabel: false,
    headActions: () => [h('button', { class: 'btn btn-primary', type: 'button', title: 'Новый договор: № заказа можно взять существующий — договоры объединятся в один заказ', onclick: () => patch({ of: 'salesorder', new: '1', open: undefined }, { replace: false }) }, '+ Договор')],
    searchPlaceholder: 'Поиск: № заказа, № договора, заказчик, предмет…',
    emptyText: 'Заказов пока нет.',
    emptyHint: 'Нажмите «+ Договор»: № заказа, заказчик, срок. Договоры с одним № заказа объединяются в один заказ.',
    rowClass: (r) => r.stage === 'new' ? 'so-design-row' : '',
    filters: [
      // вкладки: Новые → В работе (по умолчанию) → Выполненные → Все в конце (пользователь 2026-10-28)
      { key: 'filter', label: 'Состояние', type: 'chips', defaultValue: 'active', noAll: true, options: () => [{ value: 'new', label: 'Новые' }, { value: 'active', label: 'В работе' }, { value: 'done', label: 'Выполненные' }, { value: 'all', label: 'Все' }], count: (resp, v) => (v === 'new' ? resp.counts?.fresh : resp.counts?.[v]) },
    ],
    top: (reload) => unassignedTop(reload),
    hints: HINT,
    hintKey: 'filter',
    periods: (P) => (P.filter === 'done' ? { date: (r) => r.deadline || r.createdAt, total: session.canMoney ? (rs) => money(rs.reduce((s, r) => s + (Number(r.amount) || 0), 0)) : undefined } : null),
    rowAction: (r) => (NEXT[r.stage] ? { label: NEXT_LABEL[r.stage], title: (r.orderNos || []).length > 1 ? 'Следующий этап — ко всем договорам заказа' : 'Следующий этап', run: (row) => setStage(row, NEXT[row.stage]) } : null),
    columns: [
      { key: 'productionNo', label: '№ заказа', sort: 'productionNo', cls: 'nowrap', render: (r) => (r.productionNo ? h('b', null, r.productionNo) : h('span', { class: 'muted' }, 'нет №')) },
      { key: 'orderNos', label: 'Договоры', cls: 'clip md-hide', render: (r) => h('span', { class: 'muted small', title: names(r.orderNos) }, names(r.orderNos) || '—') },
      { key: 'customer', label: 'Заказчик', sort: 'customer', cls: 'clip', render: (r) => h('span', { title: names(r.customers) }, names(r.customers)) },
      { key: 'companyName', label: 'Компания', cls: 'md-hide', render: (r) => names(r.companyNames) || h('span', { class: 'muted' }, '—') },
      { key: 'lineCount', label: 'Поз.', cls: 'num right', render: (r) => qty(r.lineCount) },
      { key: 'deadline', label: 'Срок', sort: 'deadline', cls: 'nowrap', render: due },
      { key: 'amount', money: true, label: 'Сумма', cls: 'num right md-hide', render: (r) => (r.amount ? money(r.amount) : h('span', { class: 'muted' }, '—')) },
      { key: 'priority', label: 'Приоритет', cls: 'nowrap md-hide', render: (r) => prio(r) || '' },
      { key: 'stage', label: 'Этап', cls: 'nowrap', render: stageCell },
    ],
    card: {
      title: (r) => `№ ${prodNo(r)} · ${names(r.customers)}`,
      sub: (r) => [(r.orderNos || []).length && 'договоры ' + names(r.orderNos), `${r.lineCount} поз.`, r.deadline ? 'срок ' + date(r.deadline) : ''].filter(Boolean).join(' · '),
      side: (r) => [badge(STAGE, r.stage), prio(r)],
    },
    board: {
      map: (r) => ({ ...r, id: r.key }),
      columns: ['new', 'production', 'ready', 'partly', 'shipped'].map((k) => ({ key: k, label: STAGE[k].label, tone: STAGE[k].tone, query: { stage: k, sort: k === 'shipped' ? '-deadline' : 'deadline' } })),
      card: (r) => ({
        title: `№ ${prodNo(r)} · ${names(r.customers)}`,
        meta: [(r.orderNos || []).length ? h('span', { class: 'muted' }, 'договоры ' + names(r.orderNos)) : null, h('span', null, `${r.lineCount} поз.`), r.deadline ? due(r) : null, r.stagesDiffer ? h('span', { class: 'muted' }, 'разные этапы') : null, prio(r)].filter(Boolean),
        side: r.amount && session.canMoney ? money(r.amount) : '',
      }),
      move: async (r, to) => !!(await setStage(r, to)),
    },
  },

  card: {
    heading,
    noHistory: true,
    subheading: (r) => [names(r.customers), names(r.companyNames)].filter(Boolean).join(' · '),
    stats: (r) => [['Этап', STAGE[r.stage]?.label || r.stage], ['Договоров', qty((r.orderNos || []).length)], ['Позиций', qty(r.lineCount)], ...(session.canMoney ? [['Сумма', r.amount ? money(r.amount) : '—'], ['Оплачено', r.paidAmount ? money(r.paidAmount) : '—']] : [])],
    view: (r) => [
      ['Договоры', names(r.orderNos)],
      ['Заказчик', (r.customers || []).length ? h('span', null, ...(r.customers || []).flatMap((c, i) => [i ? ', ' : '', customerLink(c)])) : ''],
      ['Наша компания', names(r.companyNames) || h('span', { class: 'muted' }, 'не указана')],
      ['Срок', r.deadline ? due(r) : ''],
      ['Приоритет', r.priority && r.priority !== 'normal' ? prio(r) : ''],
      ['Этапы по договорам', r.stagesDiffer ? h('span', null, ...(r.orders || []).flatMap((o, i) => [i ? h('br') : '', `${o.orderNo || '—'}: ${STAGE[o.stage]?.label || o.stage}`])) : ''],
    ],
    actions: (r) => {
      const many = (r.orderNos || []).length > 1;
      return [
        NEXT[r.stage] && { label: NEXT_LABEL[r.stage] + (many ? ' — всем договорам' : ''), title: many ? 'Этап сменится у договоров, которые отстают' : undefined, primary: true, run: async (row, ctx) => { const s = await setStage(row, NEXT[row.stage]); if (s) ctx.setRow(s); } },
        !closedStage(r) && r.productionNo && session.canEdit && { label: '+ Добавить договор', title: 'Выбрать договоры без заказа и добавить их в этот заказ', run: async (row, ctx) => { if (await addContractsDialog(row.productionNo, null)) { const s = await salesorders.get(row.key || row.id); if (s) ctx.setRow(s); } } },
        !closedStage(r) && { label: '+ Договор в этот заказ', title: 'Новый договор с этим № заказа', run: (row) => patch({ of: 'salesorder', new: '1', productionNo: row.productionNo || '', customer: names(row.customers) && (row.customers || [])[0] || '', open: undefined }, { replace: false }) },
      ];
    },
    extra: (r) => details(r),
  },
};

/** Договор (`salesorders`): правка шапки, отмена, удаление. Открывается из группы в карточке заказа. */
export const salesorder = {
  id: 'salesorder',
  title: 'Договор',
  newTitle: 'Новый договор',
  entityType: 'SalesOrder',
  historyLabels: { 'salesorder.created': 'Создан', 'salesorder.updated': 'Изменён', 'salesorder.deleted': 'Удалён', 'salesorder.restored': 'Восстановлен' },
  get: (id) => api(`/salesorders/${id}`),

  card: {
    heading: (r) => `Договор ${r.orderNo || '—'}`,
    subheading: (r) => [r.customer, r.companyName].filter(Boolean).join(' · '),
    parent: (r) => ({ label: `Заказ № ${prodNo(r)}`, run: () => patch({ of: undefined, open: r.productionNo || r.id }, { replace: false }) }),
    editTop: true,
    stats: (r) => [['Этап', STAGE[r.stage]?.label || r.stage], ['Позиций', qty(r.lineCount)], ...(session.canMoney ? [['Сумма', r.amount ? money(r.amount) : '—'], ['Оплачено', r.paidAmount ? money(r.paidAmount) : '—']] : [])],
    view: (r) => [
      ['№ заказа', r.productionNo || h('span', { class: 'muted' }, 'нет №')],
      ['Заказчик', customerLink(r.customer)],
      ['Предмет', r.title],
      ['Наша компания', r.companyName || h('span', { class: 'muted' }, 'не указана')],
      ['Приоритет', r.priority && r.priority !== 'normal' ? prio(r) : ''],
      ['Форма оплаты', r.paymentForm],
      ['№ госконтракта', [r.contractNo, r.contractDate && 'от ' + date(r.contractDate)].filter(Boolean).join(' ')],
      ['Срок изготовления', date(r.productionDeadline)],
      ['Дата отгрузки', date(r.shipDate)],
      ['Окончание поставки', date(r.deliveryDeadline)],
      ['Примечание', r.notes],
    ],
    actions: (r) => [
      NEXT[r.stage] && { label: NEXT_LABEL[r.stage], run: async (row, ctx) => ctx.setRow(await setContractStage(row, NEXT[row.stage])) },
      r.stage !== 'cancelled' && !['shipped', 'closed'].includes(r.stage) && { label: 'Отменить договор', run: async (row, ctx) => { if (!(await confirmDlg(`Отменить договор ${row.orderNo || ''}?`, 'Договор перейдёт в «Отменён» и уйдёт из «В работе». Брони и заявки не удаляются — снимите их отдельно. Вернуть можно сменой этапа.', { okText: 'Да, отменить договор', danger: true }))) return; ctx.setRow(await setContractStage(row, 'cancelled')); } },
      !closedStage(r) && ['admin', 'manager'].includes(session.role) && { label: 'Связать с каталогом', title: 'Связать позиции заказчика с нашими изделиями — для паспорта и производства. Договор не меняется.', run: async (row, ctx) => { const s = await matchProducts(row); if (s) ctx.setRow(s); } },
      session.sees('orders') && { label: '+ Позиция', run: (row) => go('orders', { new: '1', orderNo: row.orderNo || '', customer: row.customer || '', companyName: row.companyName || '', orderId: row.id }) },
    ],
  },

  form: {
    fields: async () => {
      const [l, nums] = await Promise.all([
        incomeLookups().catch(() => ({ companies: [], customers: [], paymentForms: ['б/р', 'б/р 30%', 'б/р 50%', 'нал'] })),
        api('/production-orders', { query: { filter: 'active', limit: 200, sort: '-createdAt' } }).then((r) => uniq((r.items || []).map((x) => x.productionNo))).catch(() => []),
      ]);
      return [
        { section: 'Договор', tone: 'main', fixed: true },
        { key: 'productionNo', label: '№ заказа', type: 'combo', options: nums, max: 50, hint: 'Номер для производства, вид 21-26 (номер-год). Выберите № из списка — договор войдёт в этот заказ. Нет номера — «Взять свободный №».',
          mount: (fa) => { const inp = fa.input('productionNo'); const b = h('button', { type: 'button', class: 'link-btn', onclick: async () => { try { const r = await api('/salesorders/next-production-no'); fa.set('productionNo', r.value); } catch (e) { toast(errText(e)); } } }, 'Взять свободный №'); (fa.field('productionNo') || inp?.el || inp)?.append?.(b); } },
        { key: 'orderNo', label: '№ договора', required: true, max: 50 },
        { key: 'customer', label: 'Заказчик', type: 'combo', options: l.customers, max: 300 },
        { key: 'title', label: 'Предмет заказа', wide: true, max: 1000 },
        { key: 'companyName', label: 'Наша компания', type: 'select', options: l.companies.map((c) => c.name) },
        { key: 'paymentForm', label: 'Форма оплаты', type: 'combo', options: l.paymentForms, max: 50 },
        { key: 'stage', label: 'Этап', type: 'select', required: true, options: Object.entries(STAGE).map(([value, s]) => ({ value, label: s.label })) },
        { key: 'priority', label: 'Приоритет', type: 'select', required: true, options: Object.entries(ORDER_PRIORITY).map(([value, p]) => ({ value, label: p.label })), hint: 'Срочные заказы выделяются в «Проектировании» и в списках.' },
        { section: 'Сроки', tone: 'info' },
        { key: 'productionDeadline', label: 'Срок изготовления', type: 'date' },
        { key: 'shipDate', label: 'Дата отгрузки', type: 'date' },
        { key: 'deliveryDeadline', label: 'Окончание поставки', type: 'date' },
        { section: 'Контракт и примечание', tone: 'who', collapsed: true },
        { key: 'contractNo', label: '№ госконтракта', max: 100 },
        { key: 'contractDate', label: 'Дата контракта', type: 'date' },
        { key: 'notes', label: 'Примечание', type: 'textarea', wide: true },
      ];
    },
    initial: () => ({ stage: 'new', paymentForm: 'б/р', priority: 'normal' }),
    toInitial: (r) => ({ ...r, priority: r.priority || 'normal', ...Object.fromEntries(['shipDate', 'productionDeadline', 'deliveryDeadline', 'contractDate'].map((k) => [k, r[k] ? String(r[k]).slice(0, 10) : ''])) }),
    toBody: (v) => {
      const s = (x) => (x === null ? '' : String(x));
      return { orderNo: s(v.orderNo), productionNo: s(v.productionNo), customer: s(v.customer), title: s(v.title), companyName: s(v.companyName), paymentForm: s(v.paymentForm), stage: v.stage, priority: v.priority === 'normal' ? '' : v.priority || '',
        productionDeadline: v.productionDeadline || '', shipDate: v.shipDate || '', deliveryDeadline: v.deliveryDeadline || '', contractNo: s(v.contractNo), contractDate: v.contractDate || '', notes: s(v.notes) };
    },
    create: (body) => api('/salesorders', { method: 'POST', body: { ...body, clientUid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) } }).then((r) => { focusNewLine = true; return r; }),
    update: (id, body) => api(`/salesorders/${id}`, { method: 'PATCH', body }),
  },

  remove: { password: true,
    text: (r) => `Удалить договор ${r.orderNo || ''} (${r.customer || 'без заказчика'})? Позиции останутся в «Позициях заказов», заявки и брони тоже. Отменённый договор остаётся в списке; удаление — в корзину.`,
    run: (r) => api(`/salesorders/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/salesorders/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: `Заказ № ${prodNo(r)} · ${r.customer || ''}`, sub: [r.orderNo && 'договор ' + r.orderNo, r.title, `${r.lineCount} поз.`].filter(Boolean).join(' · '), side: badge(STAGE, r.stage) }),
  open: (id) => go('salesorders', { open: id }),
};

/** Выбор заказа и позиции (для заявок и списаний, З.6): заказы в работе. Кэш на 1 минуту (core/orders-lookup.js). */
// SK-8d: короткий список (/salesorders/lookup) — открыт и для «Склада», «Заявок»; кэш — в core/orders-lookup.js
export const activeOrders = () => ordersLookup({ filter: 'active' });
export const orderLabel = (o) => [`№ ${prodNo(o)}`, o.orderNo && `договор ${o.orderNo}`, o.customer].filter(Boolean).join(' · ');

/** Варианты «Заказ / позиция» для выпадающего списка (З.6): «id» — весь заказ, «id:lineId» — позиция. */
export async function orderOptions(keep) {
  // SK-8d: заказы в работе сразу с позициями — без /incomes?limit=3000 (раздел «Позиции и оплаты» может быть закрыт)
  const orders = await ordersLookup({ filter: 'active', lines: true });
  const opts = [];
  for (const o of orders) {
    opts.push({ value: o.id, label: orderLabel(o) + ' — весь заказ' });
    for (const l of o.lines || []) opts.push({ value: o.id + ':' + l.id, label: `   └ ${seq(l, -1) ? seq(l, -1) + '. ' : ''}${String(l.title || '').slice(0, 70)}` });
  }
  if (keep && !opts.some((x) => x.value === keep)) opts.unshift({ value: keep, label: 'Заказ (выполнен или удалён)' });
  return opts;
}
export const splitRef = (ref) => { const [o, l] = String(ref || '').split(':'); return { salesOrderId: o || '', salesOrderLineId: l || '' }; };
export const joinRef = (r) => (r.salesOrderId ? String(r.salesOrderId) + (r.salesOrderLineId ? ':' + String(r.salesOrderLineId) : '') : '');
