import { STAGE, crumbTrail } from './order-stage.js';
import { nextStep, orderCounts } from './salesorders-next.js';
import { stageBar } from './order-head.js';
import { sideForm, openSide, sideNote } from '../ui/kit/side-form.js';
import { api, session, writeHooks } from '../core/api.js';
import { ordersLookup } from '../core/orders-lookup.js';
import { h } from '../core/dom.js';
import { date, isoDay, money, qty } from '../core/format.js';
import { current, go, patch } from '../core/router.js';
import { badge, ORDER_PRIORITY } from '../ui/kit/badges.js';
import { actions, badge as kbadge, button, link, row as kitRow, section, select, stack, toolbar } from '../ui/kit/index.js';
import { toast, toastError } from '../ui/kit/toast.js';
import { confirmDlg, modal } from '../ui/kit/dialog.js';
import { withConfirm } from '../ui/confirm-password.js';
import { incomeLookups } from './orders.js';
import { lineMore } from './order-line-more.js';
import { customerLink, companyLink } from '../ui/links.js';
import { responsibleField, handoffLine } from '../ui/responsible.js';
import { errText } from '../ui/kit/errors.js';
import { busyBlock, failBlock } from '../ui/kit/busy.js';
import { orderReservations } from './order-reservations.js';
import { orderDesign } from './order-design.js';
import { orderWork } from './order-work.js';
import { unassignedTop, addContractsDialog } from './salesorders-unassigned.js'; import { memoryFields } from './salesorders-memory.js';
import { unmatchedTop, unmatchedFlag, unmatchedOrders } from './matching-queue.js';
import { posPic } from '../ui/pos-pic.js';
import { moveContract, stageBack, canChangeLines } from './order-line-actions.js';
import { distribBlock, lineMark, countOf, countBadge } from './order-lines.js';
import { shipmentsBlock, historyBlock, canShip } from './order-shipments.js';
import { importOrderExcel, downloadOrderTemplate } from './salesorders-import.js';
import { suggestLink } from '../ui/composition-suggest.js';
import { NEXT_TIP, STAGE_NOW, HINT, ourLine, issuedBlock, sec, seq, produceBlock } from './order-blocks.js';
import { screenCard } from '../ui/kit/screens/card.js';
import { positionsTable, boardCard } from '../ui/kit/screens/blocks.js';
import { orderFooter } from './order-footer.js';
/**
 * Раздел «Заказы» (TASKS фаза З): заказ = шапка (`salesorders`) + позиции (строки `incomes`).
 * Вкладки «В работе / Закрытые», доска по этапам, карточка: позиции, что заказано под заказ
 * (заявки) и что отпущено со склада. Закрытые сворачиваются по месяцам отгрузки (фаза М).
 */
export { STAGE };
const NEXT = { new: 'production', production: 'ready', ready: 'shipped', shipped: 'closed' };
const NEXT_LABEL = { new: 'В производство', production: 'Готово к отгрузке', ready: 'Отгружен', shipped: 'Завершить заказ' };
const STAGE_ORDER = Object.keys(STAGE);
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
/** Следующий свободный № заказа; сбой — пусто (впишут руками). */
const freeNo = () => api('/salesorders/next-production-no').then((r) => r?.value || '', () => '');
/** Договоры заказа, которые отстают от этапа `stage` (отменённые не в счёт). */
const lagging = (r, stage) => (r.orders || []).filter((o) => o.stage !== 'cancelled' && STAGE_ORDER.indexOf(o.stage || 'new') < STAGE_ORDER.indexOf(stage));
/** Выбор договоров галочками: все отстающие отмечены. null — отказались, иначе id выбранных. */
function pickContracts(r, stage, list) {
  const cbs = list.map((o) => h('input', { type: 'checkbox', checked: true, value: o.id }));
  return modal({
    title: `${heading(r)}: «${STAGE[stage].label}»`, okText: 'Применить к выбранным',
    body: h('div', null, h('p', { class: 'muted' }, 'Отметьте договоры, у которых сменится этап. Остальные останутся как есть.'),
      h('div', null, ...list.map((o, i) => h('label', null,
        kitRow({ lead: cbs[i], title: 'Договор ' + (o.orderNo || '—'),
          meta: [o.customer, 'сейчас: ' + (STAGE[o.stage || 'new']?.label || o.stage)].filter(Boolean).join(' · ') }))))),
    onOk: async () => { const ids = cbs.filter((c) => c.checked).map((c) => c.value); if (!ids.length) throw new Error('Отметьте хотя бы один договор'); return ids; },
  });
}
/** Заказ: следующий этап. Несколько отстающих договоров — выбор галочками; все выбраны — сервер подтягивает отстающие. null — отказались. */
async function setStage(r, stage) {
  // строка списка — без договоров: догрузить карточку, чтобы показать выбор
  if (!r.orders && (r.orderNos || []).length > 1) r = shape(await api(`/production-orders/${encodeURIComponent(r.key)}`));
  const list = lagging(r, stage);
  if (list.length > 1) {
    const ids = await pickContracts(r, stage, list);
    if (!ids) return null;
    if (ids.length < list.length) {
      for (const id of ids) await api(`/salesorders/${id}`, { method: 'PATCH', body: { stage } });
      toast(`${heading(r)} → ${STAGE[stage].label} (договоров: ${ids.length} из ${list.length})`);
      window.dispatchEvent(new CustomEvent('data-changed'));
      return shape(await api(`/production-orders/${encodeURIComponent(r.key)}`));
    }
  }
  const saved = await api(`/production-orders/${encodeURIComponent(r.key)}/stage`, { method: 'POST', body: { stage } });
  toast(`${heading(r)} → ${STAGE[stage].label}${saved?.changed?.length ? ` (договоров: ${saved.changed.length})` : ''}`);
  if (saved?.warnings?.length) toast('Не всё готово', { tone: 'warn', sub: saved.warnings.map((w) => (typeof w === 'string' ? w : w.label || w.hint || '')).filter(Boolean).join('; ') });
  return shape(saved);
}

/** Блок «Готовность к отгрузке» в карточке заказа: проверки сервера + кнопка «Отметить: готов к отгрузке». */
function readinessBlock(r, after) {
  const box = h('div', null);
  const paint = (d) => {
    const checks = d?.checks || [];
    const bad = checks.filter((c) => !c.ok);
    const can = session.canEditOrders && ['new', 'production'].includes(r.stage);
    const mark = async (btn) => {
      if (bad.length && !(await confirmDlg('Не выполнено: ' + bad.map((c) => c.label).join('; ') + '. Всё равно отметить?', 'Заказ перейдёт в «Готово к отгрузке».', { okText: 'Да, отметить' }))) return;
      btn.disabled = true; btn.classList.add('is-busy');
      try { await setStage(r, 'ready'); window.dispatchEvent(new CustomEvent('data-changed')); after?.(); } catch (e) { toastError(e); } finally { btn.disabled = false; btn.classList.remove('is-busy'); }
    };
    const btn = can ? button({ label: 'Отметить: готов к отгрузке', kind: bad.length ? 'ghost' : 'primary', cls: bad.length ? '' : 'btn-warm', onClick: (e) => mark(e.currentTarget) }) : null;
    box.replaceChildren(section({ title: 'Готовность к отгрузке', tone: 'main', open: true, cls: 'rdy', body: [
      ...checks.map((c) => kitRow({ tone: c.ok && c.state !== 'unknown' ? 'ok' : 'neutral',
        title: (c.state === 'unknown' ? '? ' : c.ok ? '✓ ' : '○ ') + c.label,
        below: [(!c.ok || c.state === 'unknown') && c.hint ? h('span', { class: 'muted small' }, ' — ' + c.hint) : null,
          !c.ok && c.href ? h('a', { href: c.href.startsWith('#') ? c.href : '#' + c.href.replace(/^\//, ''), class: 'small' }, ' Открыть') : null] })), btn] }));
  };
  const load = () => api(`/production-orders/${encodeURIComponent(r.key)}/readiness`).then(paint)
    .catch((e) => box.replaceChildren(failBlock(e, load, { cls: 'so-state', text: 'Готовность к отгрузке не загрузилась' })));
  box.append(busyBlock('готовность к отгрузке', { retry: load, cls: 'so-state' }));
  load();
  return box;
}

/** «Связать с каталогом»: предложения сервера по всем позициям без изделия → выбор → apply. Возвращает обновлённый заказ или null. */
async function matchProducts(r) {
  const res = await api(`/salesorders/${r.id}/match-products`, { method: 'POST', body: {} });
  const items = res?.items || [];
  if (!items.length) { toast('Все позиции уже с изделием'); return null; }
  const rows = items.map((it) => {
    const sel = select({ label: it.title || 'Изделие', options: [...(it.suggestions || []).map((s) => [s.productId, `${s.sku ? s.sku + ' ' : ''}${s.name}`]), ['', 'Без изделия']] });
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

const closedStage = (o) => ['closed', 'cancelled'].includes(o.stage);

/** Править заказ/договор может админ, менеджер, владелец; завершённый — только админ. */
const editableOrder = (o) => session.canEditOrders && (o.stage !== 'closed' || session.role === 'admin');
/** Шаг воронки → вкладка договора (прежние ключи: шаг этап не меняет, а открывает нужный блок). */
const STEP_TAB = { new: 'design', production: 'work', ready: 'stock', shipped: 'ship', closed: 'pass' };
const TAB_NAME = { pos: 'Позиции', design: 'Проектирование', work: 'Работа', stock: 'Склад', ship: 'Отгрузки', pass: 'Паспорта' };
/** Вкладки заказа (C118 W2): Позиции · Выполнение · Деньги · Документы. Прежние ключи (so-open-tab, ?tab=ship, pendingTab) переадресуются сюда. */
const LEGACY_TAB = { pos: 'pos', design: 'run', work: 'run', stock: 'run', ship: 'run', pass: 'docs' };
const RUN_SUBS = ['design', 'work', 'stock', 'ship'];
const DEFAULT_SUB = { new: 'design', production: 'work', ready: 'stock', partly: 'ship', shipped: 'ship' };
let pendingTab = null; // из карточки договора: открыть вкладку у этого договора после перехода к заказу
let liveCtx = null; // контекст открытой панели заказа (openTab)
let pendingSub = ''; // какой блок «Выполнения» раскрыть при открытии вкладки
/** Старый ключ вкладки → новая вкладка (+ блок внутри «Выполнения»). */
function goTab(legacy) {
  const key = LEGACY_TAB[legacy];
  if (!key || !liveCtx) return false;
  if (RUN_SUBS.includes(legacy)) pendingSub = legacy;
  liveCtx.openTab(key);
  return true;
}
function goReady() {
  if (!liveCtx) return false;
  pendingSub = '';
  liveCtx.openTab('run');
  setTimeout(() => document.querySelector('.rdy')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 300);
  return true;
}
window.addEventListener('so-open-tab', (ev) => {
  const t = ev.detail?.tab;
  if (t === 'ready' ? goReady() : goTab(t)) ev.detail.handled = true;
});
/** Шаг воронки в карточке договора: перейти к заказу и открыть вкладку этого договора. */
function openStepFromContract(o, key) {
  if (key === 'ready') { pendingTab = null; } else pendingTab = { id: o.id, tab: STEP_TAB[key] };
  patch({ of: undefined, open: o.productionNo || o.id }, { replace: false });
}
/** Перерисовать карточку заказа после правки, не теряя прокрутку. */
const reloadKeep = (anchor, ctx) => async () => {
  const b = anchor.closest?.('.drawer-body'); const y = b?.scrollTop;
  await ctx.reload();
  if (b && y) b.scrollTop = y;
};
const full = async (r) => (r.orders ? r : shape(await api(`/production-orders/${encodeURIComponent(r.key)}`)));

/** Отменённая позиция: серая строка с причиной и «Вернуть»; в суммы не входит. */
const cancelledRow = (l, i, span, open) => h('tr', { class: 'muted', onclick: open, title: 'Позиция отменена: ' + (l.cancelReason || '') + ' — открыть, чтобы вернуть' },
  h('td', { class: 'muted' }, seq(l, i)), h('td', null, ''),
  h('td', { class: 'muted', colspan: span }, h('s', null, l.title), h('div', { class: 'small' }, 'Отменена' + (l.cancelReason ? ': ' + l.cancelReason : ''))));

/** Заголовок-группа «Договор 109-П»: этап, срок, «+ Позиция» и «⋯» (одно меню действий по договору). */
/** Действия по договору — в «⋯» шапки заказа (владелец 15.11: правка заказа — только там, в таблице только смотреть). */
function contractMenu(o, reload, prefix = '') {
  const seeStock = session.sees('stock');
  const can = editableOrder(o);
  const remove = async () => {
    if (!(await confirmDlg('Удалить?', salesorders.remove.text(o) + ' Можно восстановить из корзины.', { okText: 'Удалить', danger: true }))) return;
    try {
      if ((await withConfirm(async () => { await salesorders.remove.run(o); return true; }, { text: 'Удаление требует вашего пароля.' })) === null) return;
      toast('Договор с заказчиком удалён'); window.dispatchEvent(new CustomEvent('data-changed')); reload?.();
    } catch (e) { toastError(e); }
  };
  const menu = [
    { label: 'Договор', title: 'Договор с заказчиком: реквизиты, деньги и правка позиций', onSelect: () => patch({ of: 'salesorder', open: o.id }, { replace: false }) }, // владелец 15.11: «Договор», всё по договору — внутри
    !['closed', 'cancelled', 'new'].includes(o.stage) && canShip() && { label: 'Отгрузить', onSelect: () => patch({ of: 'shipdo', open: o.id, pick: undefined }, { replace: false }) },
    can && !closedStage(o) && seeStock && { label: 'Загрузить спецификацию из Excel', onSelect: () => patch({ of: 'specimport', new: '1', orderId: o.id, open: undefined }, { replace: false }) },
    can && o.productionNo && !closedStage(o) && { label: 'Перенести в другой заказ', onSelect: () => moveContract(o).then((r) => r && reload?.()).catch((e) => toastError(e)) },
    session.role === 'admin' && o.stage !== 'new' && { label: 'Вернуть на прежний этап…', onSelect: () => stageBack(o).then((r) => r && reload?.()).catch((e) => toastError(e)) },
    can && !closedStage(o) && canChangeLines(o) && { label: '+ Позиция', title: 'Новая позиция: все поля — в правой панели', onSelect: () => patch({ of: 'orders', new: '1', open: undefined, orderNo: o.orderNo || '', customer: o.customer || '', companyName: o.companyName || '', orderId: o.id }, { replace: false }) },
    can && { label: 'Удалить договор', danger: true, onSelect: remove },
  ].filter(Boolean).map((m) => ({ ...m, label: prefix + m.label }));
  return menu;
}
/** Заголовок-группа «Договор 9» в таблице позиций: только что это и (если договоров несколько) этап и срок. */
function contractHead(o, many = true) {
  return kitRow({ title: ['Договор ' + (o.orderNo || '—'), o.customer].filter(Boolean).join(' · '), side: many ? [badge(STAGE, o.stage), due(o)].filter(Boolean) : [] });
}
/** Подпись под таблицей договора: пусто / «менять позиции может администратор». */
function contractFoot(o) {
  const lines = o.lines || [];
  if (!lines.length) return h('p', { class: 'muted' }, 'В этом договоре позиций пока нет — «⋯» вверху → «+ Позиция».');
  if (editableOrder(o) && !closedStage(o) && !canChangeLines(o)) return h('p', { class: 'hint' }, 'Договор уже в работе — менять позиции может администратор.');
  return null;
}
/** Одно действие по клику на позицию — везде: панель позиции (фото, сумма, отгрузка, оплата; «назад» — к заказу). */
const openLine = (l) => () => patch({ of: 'orders', open: l.id }, { replace: false });

/** Вкладка «Позиции»: одна таблица по всем договорам заказа (договор — группа строк), «К производству» — свёрнутый режим «одинаковые вместе». */
function positionsPane(d, ctx, pick = null) {
  const box = stack(); const reload = reloadKeep(box, ctx);
  const orders = d.orders || [];
  // пустые колонки не показываем (стенд 11-26: «Отгружено» и «Цвет» пустые на всю таблицу)
  const allLines = orders.flatMap((o) => o.lines || []).filter((l) => !l.cancelledAt);
  const showShip = allLines.some((l) => l.shipped), showColor = false; // цвет и описание — второй строкой под названием (владелец 15.11)
  const columns = [{ label: '№' }, { label: '', phoneHide: true }, { label: 'Название' }, { label: 'Кол-во', num: true }, ...(showShip ? [{ label: 'Отгружено', num: true }] : []), ...(showColor ? [{ label: 'Цвет' }] : [])];
  const span = 2 + (showShip ? 1 : 0) + (showColor ? 1 : 0);
  const hasPic = (l) => !!(l.photo && (l.photo.url || l.photo.thumb));
  const many = orders.length > 1;
  const groups = orders.map((o) => {
    // в таблице только смотреть: правка позиции — в «⋯» её панели (клик по строке), правка договора — в «⋯» заказа
    // отменённые — в конце договора, номер позиции сохраняется
    const order = (o.lines || []).map((l, i) => [l, i]).sort((a, b) => !!a[0].cancelledAt - !!b[0].cancelledAt);
    const rows = order.map(([l, i]) => (l.cancelledAt ? cancelledRow(l, i, span, openLine(l)) : { key: l.id, line: l, expand: () => lineMore(l, o, d, { reload, editable: editableOrder(o), closed: closedStage(o) }), cells: [
      { v: seq(l, i), cls: 'muted' }, posPic(hasPic(l) ? l.photo : null, hasPic(l) ? 'lg' : 'sm'),
      h('span', null, l.title, ourLine(l), l.color || l.notes ? h('div', { class: 'muted small' }, [l.color && 'Цвет: ' + l.color, l.notes].filter(Boolean).join(' · ')) : null, l.unassigned !== undefined || l.lineType ? h('span', null, ' ', lineMark(l)) : null, l.unassigned === undefined && !l.lineType && l.matched === false ? h('a', { class: 'badge warn', href: '#', title: 'Сопоставить позиции договора с изделиями', onclick: (e) => { e.preventDefault(); e.stopPropagation(); patch({ of: 'matching', open: o.id, new: undefined }, { replace: false }); } }, 'не сопоставлено') : null),
      { v: `${qty(l.qty)} ${l.unit || ''}`, cls: 'num nowrap' }, ...(showShip ? [{ v: l.shipped ? `${qty(l.shipped)} из ${qty(l.qty)}` : '', cls: 'num nowrap muted' }] : []), ...(showColor ? [{ v: l.color || '', cls: 'muted' }] : []),
] }));
    return { head: many ? contractHead(o, many) : null, rows, foot: contractFoot(o) }; // один договор — без строки-заголовка: чистая таблица (владелец 15.11)
  });
  box.append(...orders.map((o) => distribBlock(o, reload)), positionsTable({ columns, groups, label: 'Позиции заказа', empty: orders.length ? { title: `В ${orders.length > 1 ? 'договорах' : 'договоре'} ${orders.map((o) => '№ ' + (o.orderNo || '—')).join(', ')} позиций пока нет.`, hint: 'Добавьте позиции: «⋯» вверху → «+ Позиция».' } : { title: 'Договоров нет.', hint: 'Добавьте договор: «⋯» вверху.' }, pick }), produceBlock(d, openLine));
  return box;
}

/** Вкладка «Деньги»: по каждому договору — сумма, оплачено, долг и «Принять оплату» (панель incpay). */
function moneyPane(d) {
  const orders = (d.orders || []).filter((o) => (o.lines || []).some((l) => !l.cancelledAt));
  const paidOf = (l) => (Number(l.paidAmount) || (l.paidDate ? Number(l.amount) || 0 : 0));
  const payOn = session.canEditOrders;
  const columns = [{ label: '№' }, { label: 'Название' }, { label: 'Сумма', num: true }, { label: 'Оплачено', num: true }, { label: 'Долг', num: true }, ...(payOn ? [{ label: '' }] : [])];
  const groups = orders.map((o) => {
    const live = (o.lines || []).filter((l) => !l.cancelledAt);
    const amount = live.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const paid = live.reduce((s, l) => s + paidOf(l), 0);
    const debtAll = Math.max(0, amount - paid);
    const head = kitRow({ title: 'Договор ' + (o.orderNo || '—'), meta: o.customer || '', side: [h('span', { class: 'muted small' }, `сумма ${money(amount)} · оплачено ${money(paid)}`), h('b', { class: debtAll > 0 ? 'neg' : 'muted' }, 'долг ' + money(debtAll))] });
    const rows = (o.lines || []).map((l, i) => {
      if (l.cancelledAt) return null;
      const debt = Math.max(0, (Number(l.amount) || 0) - paidOf(l));
      return { onOpen: openLine(l), cells: [{ v: seq(l, i), cls: 'muted' }, l.title, { v: l.amount ? money(l.amount) : '', cls: 'num' }, { v: paidOf(l) ? money(paidOf(l)) : '', cls: 'num nowrap muted' }, { v: l.amount ? (debt > 0 ? money(debt) : h('span', { class: 'muted' }, '—')) : '', cls: 'num nowrap' },
        ...(payOn ? [l.amount && debt > 0 ? button({ label: 'Принять оплату', kind: 'ghost', size: 'S', title: 'Принять оплату по этой позиции', onClick: (e) => { e.stopPropagation(); patch({ of: 'incpay', open: String(l.id), new: undefined }, { replace: false }); } }) : ''] : [])] };
    }).filter(Boolean);
    return { head, rows };
  });
  return stack(positionsTable({ columns, groups, label: 'Оплаты по позициям заказа', empty: { title: 'Позиций пока нет.' } }));
}

/** Раскрывающийся блок «Выполнения»: содержимое строится при первом открытии. */
function lazySec(title, sub, make, open) {
  const body = h('div', null);
  const s = section({ title, tone: 'main', open, body: [body] });
  s.dataset.sub = sub;
  let built = false;
  const build = () => { if (built) return; built = true; body.replaceChildren(make() || h('p', { class: 'muted' }, 'Здесь пока ничего нет.')); };
  if (open) build(); else s.addEventListener('toggle', () => { if (s.open) build(); });
  return s;
}
/** Вкладка «Выполнение»: готовность → по каждому договору проектирование, работа, склад, отгрузки (раскрыт блок текущего этапа). */
function runPane(d, ctx) {
  const box = stack(); const reload = reloadKeep(box, ctx);
  const seeReq = session.sees('requests'), seeStock = session.sees('stock');
  const want = pendingSub; pendingSub = '';
  const orders = d.orders || [];
  const perContract = orders.map((o) => {
    const lines = o.lines || [];
    const can = editableOrder(o);
    const seqBy = new Map(lines.map((l, i) => [String(l.id), seq(l, i)]));
    const hasShip = o.stage !== 'new' || lines.some((l) => l.shipped);
    const defs = [
      ['design', 'Проектирование', session.sees('design') && lines.length > 0, () => orderDesign({ id: o.id, orderNo: o.productionNo || o.orderNo }, lines)],
      ['work', 'Работа', session.sees('work') && lines.length > 0 && !closedStage(o), () => orderWork([o])],
      ['stock', 'Склад', seeReq || seeStock, () => stack(
        seeReq ? sec('Заказано под заказ', 'who', (o.supplyRequests || []).length,
          (o.supplyRequests || []).length ? stack(...o.supplyRequests.map((s) => kitRow({ title: h('a', { href: '#requests?open=' + (s.id || s._id) }, `№${s.num ?? ''} ${s.title}`), meta: `${qty(s.qty)} ${s.unit || ''} · ${s.statusLabel || s.status || ''}` }))) : h('p', { class: 'muted' }, 'Заявок под этот заказ пока нет.'),
          can ? button({ label: '+ Заявка под этот заказ', size: 'S', title: 'Новая заявка: заказ и заказчик подставятся сами', onClick: () => patch({ of: 'requests', new: '1', open: undefined, salesOrderRef: o.id, orderLabel: o.customer || undefined }) }) : null) : null,
        seeStock ? orderReservations({ id: o.id, orderNo: o.orderNo, productionNo: o.productionNo, seqBy }, reload) : null,
        seeStock ? issuedBlock(o, suggestLink) : null,
        seeStock && (o.stockMovements || []).length ? sec('Отпущено со склада', 'gold', o.stockMovements.length,
          stack(...o.stockMovements.map((m) => kitRow({ lead: date(m.date), title: m.materialName || 'позиция',
            side: [h('span', { class: 'num neg' }, '−' + qty(m.qty))],
            below: [m.issuedToLabel && 'кому: ' + m.issuedToLabel, m.notes].filter(Boolean).join(' · ') || null })))) : null)],
      ['ship', 'Отгрузки', hasShip, () => stack(shipmentsBlock({ id: o.id, stage: o.stage }, reload, { bare: true }), historyBlock({ id: o.id }))],
    ].filter((x) => x[2]);
    const open = want && defs.some((x) => x[0] === want) ? want : DEFAULT_SUB[o.stage];
    const secs = defs.map(([key, title, , make]) => lazySec(title, key, make, key === open));
    if (!secs.length) return null;
    return orders.length > 1 ? sec('Договор ' + (o.orderNo || '—') + (o.customer ? ' · ' + o.customer : ''), 'neutral', null, ...secs) : stack(...secs);
  });
  box.append(['closed', 'cancelled', 'shipped', 'ready', 'partly'].includes(d.stage) ? null : readinessBlock(d, reload), ...perContract);
  if (!box.children.length) box.append(h('p', { class: 'muted' }, 'Здесь пока ничего нет.'));
  if (want) setTimeout(() => box.querySelector(`[data-sub="${want}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }), 150);
  return box;
}

/** Вкладка «Документы»: PDF и ZIP заказа, паспорта по договорам. */
const inWork = (d) => !['new', 'closed', 'cancelled'].includes(d.stage);

/** «+ Договор» — пункты «⋯» заказа: выбрать из договоров без заказа / создать новый. */
const addContractItems = (d) => (!editableOrder(d) || closedStage(d) ? [] : [
  d.productionNo && { label: '+ Договор из договоров без заказа', run: async (row, ctx) => { if (await addContractsDialog(d.productionNo, null)) { const s = await salesorders.get(row.key || row.id); if (s) ctx.setRow(s); } } },
  { label: '+ Новый договор', run: () => patch({ of: 'salesorder', new: '1', productionNo: d.productionNo || '', customer: (d.customers || [])[0] || (d.orders || [])[0]?.customer || '', open: undefined }, { replace: false }) },
]);

const uniq = (a) => [...new Set(a.filter(Boolean))];
/** Номера активных заказов для поля «№ заказа»: кэш 90 с (SPEED-2), сбрасывается любой записью в заказы. */
let nosP = null; let nosAt = 0;
const activeOrderNos = () => {
  if (!nosP || Date.now() - nosAt > 90000) { nosAt = Date.now(); const p = api('/production-orders', { query: { filter: 'active', limit: 200, sort: '-createdAt' } }).then((r) => uniq((r.items || []).map((x) => x.productionNo))); nosP = p; p.catch(() => { if (nosP === p) nosP = null; }); }
  return nosP;
};
writeHooks.push((path) => { if (/^\/(salesorders|production-orders)(\/|$)/.test(path)) nosP = null; });
const sumOf = (os, k) => os.reduce((s, o) => s + (Number(o[k]) || 0), 0);
/** Карточка заказа с сервера → вид строки раздела (id = key). */
function shape(d) {
  const os = d.orders || [];
  return { ...d, id: d.key, orderNos: os.map((o) => o.orderNo), customers: uniq(os.map((o) => o.customer)), companyNames: uniq(os.map((o) => o.companyName)),
    lineCount: os.reduce((s, o) => s + (o.lineCount ?? (o.lines || []).length), 0), amount: sumOf(os, 'amount'), paidAmount: sumOf(os, 'paidAmount') };
}
const readyBadge = () => { const b = kbadge('Можно отгружать', 'ok'); b.title = 'Все проверки пройдены, изготовленное готово — можно отметить «Готово к отгрузке»'; return b; }; // SPEC: tag → badge
const stageCell = (r) => h('span', null, badge(STAGE, r.stage), r.readiness?.ready && ['new', 'production'].includes(r.stage) ? readyBadge() : null, r.stagesDiffer ? h('span', { class: 'muted small', title: 'У договоров заказа разные этапы — показан самый отстающий' }, ' · разные') : null);
const names = (a) => (a || []).join(', ');
const COL_HINT = { new: 'проектирование', production: 'изготовление', ready: 'ждёт отгрузки', partly: 'досдать остаток', shipped: 'закрыть заказ' };
/** Карточка доски (как «В работе»): заголовок, подстрока, одна короткая метка-предупреждение, срок/приоритет и одна кнопка шага (kit.card actions). */
function boardBody(r) {
  const s = nextStep(r);
  const n = orderCounts(r);
  const warn = !r.lineCount && r.stage === 'new' ? 'нет позиций' : n.unassigned > 0 && ['new', 'production'].includes(r.stage) ? String(n.unassigned) : '';
  const un = unmatchedOrders(r)[0];
  const sub = [names(r.customers), (r.orderNos || []).length ? 'договоры ' + names(r.orderNos) : '', `${r.lineCount} поз.`, r.stagesDiffer ? 'разные этапы' : '', r.amount && session.canMoney ? money(r.amount) : ''].filter(Boolean).join(' · ');
  const b = s.btn;
  const canBtn = b && (b.href || session.canEditOrders);
  const flags = [warn ? kbadge(warn, 'warn') : null, !n.unassigned && un ? unmatchedFlag(un.id) : null].filter(Boolean);
  return {
    body: boardCard({ title: heading(r), sub, flags, meta: [due(r), prio(r)] }),
    foot: canBtn ? actions(button({ label: b.label, size: 'S', kind: s.tone === 'ok' ? 'primary' : 'secondary', onClick: () => { if (b.href) location.hash = b.href; else setStage(r, b.stage); } })) : null,
  };
}

/** «Отгружено N из M»: позиция отгружена, если отгружено не меньше заказанного; отменённые не считаются. До отгрузки — этап. */
function shipLine(r) {
  if (!['partly', 'ready', 'shipped', 'closed'].includes(r.stage)) return stageCell(r);
  const live = (r.orders || []).flatMap((o) => o.lines || []).filter((l) => !l.cancelledAt);
  const done = live.filter((l) => (Number(l.shipped) || 0) >= (Number(l.qty) || 0) && Number(l.qty) > 0).length;
  return h('span', null, h('span', { class: 'muted' }, 'Отгружено '), `${done} из ${live.length}`);
}
/**
 * Карточка заказа — по шаблону «Карточка объекта» (screenCard, C118 W2): шапка (заказ, этап один раз) → предупреждения → «Что дальше» с одной главной кнопкой →
 * сведения (5 строк + «Подробнее») → вкладки «Позиции · Выполнение · Деньги · Документы». Остальные действия — в «⋯».
 */
const orderCard = screenCard({
  title: heading,
  // шапка — один блок (владелец 15.11): слева № и «заказчик · компания» (заказчик — ссылкой), по центру этап, справа срок
  sub: (r) => [...(r.customers || []).flatMap((c, i) => [i ? ', ' : '', customerLink(c)]), ...(r.companyNames || []).filter(Boolean).flatMap((c, i) => [i ? ', ' : ' · ', companyLink(c)])],
  // справа в шапке: срок, под ним — отгрузка «N из M позиций» (с отгрузки) или этап (до неё) — владелец 15.11
  side: (r) => [r.deadline ? h('span', null, h('span', { class: 'muted' }, 'Срок '), due(r)) : null, shipLine(r)],
  noHistory: true,
  before: (r, ctx) => {
    liveCtx = ctx;
    crumbTrail([orderCrumb(r)]);
    // прежние ключи вкладок: pendingTab (из договора), ?tab=ship с доски «Отгрузка» → новые вкладки
    let legacy = '';
    if (pendingTab && (r.orders || []).some((o) => String(o.id) === String(pendingTab.id))) { legacy = pendingTab.tab; pendingTab = null; }
    const tab = current().params.tab;
    if (tab && TAB_NAME[tab]) { legacy = tab; patch({ tab: undefined }, { replace: true }); }
    if (legacy) setTimeout(() => goTab(legacy), 80);
  },
  warns: (r, ctx) => [
    r.stage === 'new' && r.lineCount === 0 && !(r.lines || []).length ? { tone: 'error', title: 'В заказе нет позиций — «В производство» не сработает', label: 'К позициям', run: () => ctx.openTab('pos') } : null,
    countOf(r) ? { title: `${countOf(r)} поз. без изделия — «В производство» не сработает, пока их не распределят`, label: 'Распределить', run: () => ctx.openTab('pos') } : null,
  ],
  next: (r, ctx) => {
    let primary = null;
    if (editableOrder(r)) {
      if (r.stage === 'production') primary = { label: 'Проверить готовность', title: 'Проверки перед отметкой «Готово к отгрузке»', run: async () => { goReady(); } };
      else if (NEXT[r.stage]) {
        const many = lagging(r, NEXT[r.stage]).length > 1;
        primary = { label: NEXT_LABEL[r.stage], title: NEXT_TIP[r.stage] + (many ? ' Договоры выберете галочками.' : ''), run: async () => { const s = await setStage(r, NEXT[r.stage]); if (s) ctx.setRow(s); } };
      }
    }
    return { text: primary ? STAGE_NOW[r.stage] || '' : '', tone: 'neutral', primary }; // без кнопки шага блок не нужен (владелец 15.11)
  },
  facts: () => [], // всё нужное — в шапке; «Подробнее» убрано: дублировало вкладку «Позиции» (владелец 15.11)
  // «⋯» — всё, что меняет заказ (владелец 15.11): сам заказ, договоры, позиции; карточка — только смотреть
  menu: (r, ctx) => {
    const many = (r.orders || []).length > 1;
    const reload = () => salesorders.get(r.key || r.id).then((s) => s && ctx.setRow(s));
    return [
      editableOrder(r) && { label: 'Изменить заказ', title: '№ заказа, срок и приоритет — сразу у всех договоров заказа', run: (row) => openSide('orderedit', row.key || row.id) },
      ...addContractItems(r),
      ...(r.orders || []).flatMap((o) => contractMenu(o, reload, many ? `Договор ${o.orderNo || '—'}: ` : '').map((m) => ({ label: m.label, danger: m.danger, run: () => m.onSelect() }))),
    ];
  },
  // без вкладок (владелец 15.11): сразу таблица позиций; подробности позиции — под её строкой; общее по заказу — свёрнутыми блоками
  body: (r, ctx) => {
    const box = stack(h('p', { class: 'muted' }, 'Загружаю позиции…'));
    const parts = {};
    // старые переходы «на вкладку» (доска «Отгрузка», договор, «Проверить готовность») раскрывают нужный блок
    liveCtx = { ...ctx, openTab: function go(key, n = 0) { const s = parts[key === 'pos' || key === 'money' ? 'pos' : key]; if (!s) { if (n < 20) setTimeout(() => go(key, n + 1), 150); return; } if (s.tagName === 'DETAILS') s.open = true; s.scrollIntoView({ block: 'start', behavior: 'smooth' }); } };
    full(r).then((d) => {
      // C124: галочки позиций + подвал «Весь заказ» (вместо блока «Документы заказа»): действия над всем заказом или отмеченными
      const sel = new Map();
      let foot = null;
      const pick = { isOn: (row) => sel.has(row.key), set: (row, on) => { if (on) sel.set(row.key, row.line); else sel.delete(row.key); foot?.update(); } };
      parts.pos = positionsPane(d, ctx, pick);
      parts.run = lazySec('Выполнение заказа', 'run', () => runPane(d, ctx), false);
      foot = orderFooter(r, d, sel, {
        reload: () => salesorders.get(r.key || r.id).then((s) => s && ctx.setRow?.(s)),
        onClear: () => { sel.clear(); parts.pos.querySelectorAll('.k-pick input:checked').forEach((cb) => { cb.checked = false; cb.closest('tr')?.classList.remove('is-picked'); }); foot.update(); },
      });
      parts.docs = foot.el;
      box.replaceChildren(...[parts.pos, parts.run, parts.docs].filter(Boolean));
    }).catch((e) => box.replaceChildren(h('p', { class: 'muted' }, 'Позиции не загрузились: ' + (e.message || e))));
    return box;
  },
});

export const salesorders = {
  id: 'salesorders',
  kind: 'Заказ',
  title: 'Заказы',
  entityType: 'SalesOrder',
  canEdit: () => session.canEditOrders, // директор и бухгалтер только смотрят: сервер им откажет
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
    viewKey: 'salesorders', path: '/production-orders',
    map: (r) => ({ ...r, id: r.key }),
    export: 'admin',
    sortDefault: 'deadline',
    createLabel: false,
    headActions: () => session.canEditOrders ? [
      button({ label: '+ Заказ', kind: 'primary', title: 'Новый заказ (договор): № заказа можно взять существующий — договоры объединятся в один заказ', onClick: () => patch({ of: 'salesorder', new: '1', open: undefined }, { replace: false }) }),
      button({ label: 'Импорт Excel', title: 'Проверка полей Excel и загрузка заказа на сайт', onClick: () => importOrderExcel().catch((e) => toastError(e)) }),
      button({ label: 'Шаблон', kind: 'ghost', title: 'Скачать пустой шаблон Excel для заказа', onClick: () => downloadOrderTemplate() }),
    ] : [],
    searchPlaceholder: 'Поиск: № заказа, № договора, заказчик, предмет…',
    extraKeys: ['productId'], query: (P) => ({ productId: P.productId || undefined }),
    emptyText: 'Заказов пока нет.',
    emptyHint: '«+ Заказ» вручную или «Импорт Excel» из файла. Договоры с одним № заказа объединяются.',
    rowClass: (r) => r.stage === 'new' ? 'so-design-row' : '',
    filters: [
      // вкладки: Новые → В работе (по умолчанию) → Отгруженные → Завершённые → Все в конце (ORDERS-1; старый адрес filter=done ведёт на «Завершённые»)
      { key: 'filter', label: 'Статус', type: 'chips', defaultValue: 'active', noAll: true, options: () => [{ value: 'new', label: 'Новые' }, { value: 'active', label: 'В работе' }, { value: 'shipped', label: 'Отгруженные' }, { value: 'closed', label: 'Завершённые' }, { value: 'all', label: 'Все' }], count: (resp, v) => (v === 'new' ? resp.counts?.fresh : resp.counts?.[v]) },
      { key: 'overdue', label: 'Срок', type: 'chips', allLabel: 'Любой срок', options: () => [{ value: '1', label: 'Просрочено' }] },
    ],
    top: (reload) => {
      if (current().params.filter === 'done') setTimeout(() => patch({ filter: 'closed' }), 0);
      return h('div', null, unmatchedTop(), session.canEditOrders ? unassignedTop(reload) : null);
    },
    hints: HINT,
    hintKey: 'filter',
    periods: (P) => (['shipped', 'closed'].includes(P.filter) ? { date: (r) => r.deadline || r.createdAt, total: session.canMoney ? (rs) => money(rs.reduce((s, r) => s + (Number(r.amount) || 0), 0)) : undefined } : null),
    rowAction: (r) => (NEXT[r.stage] ? { label: NEXT_LABEL[r.stage], title: NEXT_TIP[r.stage], run: (row) => setStage(row, NEXT[row.stage]) } : null),
    columns: [
      { key: 'productionNo', label: '№ заказа', sort: 'productionNo', cls: 'nowrap', render: (r) => (r.productionNo ? h('b', null, r.productionNo) : h('span', { class: 'muted' }, 'нет №')) },
      { key: 'orderNos', label: 'Договоры заказчика', cls: 'clip md-hide', render: (r) => h('span', { class: 'muted small', title: names(r.orderNos) }, names(r.orderNos) || '—') },
      { key: 'customer', label: 'Заказчик', sort: 'customer', cls: 'clip', render: (r) => h('span', { title: names(r.customers) }, names(r.customers)) },
      { key: 'companyName', label: 'Наша компания', cls: 'md-hide', render: (r) => names(r.companyNames) || h('span', { class: 'muted' }, '—') },
      { key: 'lineCount', label: 'Поз.', cls: 'num right', render: (r) => h('span', null, qty(r.lineCount), countOf(r) ? h('span', null, ' ', countBadge(countOf(r))) : null) },
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
      default: true,
      map: (r) => ({ ...r, id: r.key }),
      columns: ['new', 'production', 'ready', 'partly', 'shipped'].map((k) => ({ key: k, label: STAGE[k].label, hint: COL_HINT[k], tone: STAGE[k].tone, query: { stage: k, sort: k === 'shipped' ? '-deadline' : 'deadline' } })),
      card: (r) => boardBody(r),
      canMove: () => session.canEditOrders,
      move: async (r, to) => !!(await setStage(r, to)),
    },
  },

  card: orderCard,
};

const orderCrumb = (r) => (r.productionNo ? `Заказ № ${r.productionNo}` : 'Заказ без №');

/** Подставить свободный № заказа, если поле пусто (новый или заказ без №). */
const fillFreeNo = (fa) => {
  const run = async () => {
    if (String(fa.get('productionNo')).trim()) return;
    const v = await freeNo();
    if (v && !String(fa.get('productionNo')).trim()) fa.set('productionNo', v, { auto: true });
  };
  run();
  const inp = fa.input('productionNo');
  (inp?.el || inp)?.addEventListener?.('change', run);
};

/** «Изменить заказ» (правая панель): № заказа, срок, приоритет → PATCH /salesorders/:id по очереди на каждый договор. */
export const orderEdit = sideForm({
  id: 'orderedit', title: 'Изменить заказ', noun: 'заказ',
  canEdit: () => session.canEditOrders,
  get: (key) => salesorders.get(key),
  heading: (r) => heading(r),
  subheading: (r) => [names(r.customers), `договоров: ${(r.orders || []).length}`].filter(Boolean).join(' · '),
  fields: async (row) => {
    const [nums, next] = await Promise.all([activeOrderNos().catch(() => []), freeNo()]);
    const options = uniq([next, ...nums].filter(Boolean));
    return [
      { section: 'Заказ', tone: 'main', fixed: true },
      { key: '_note', type: 'widget', label: '', wide: true, widget: () => ({ el: sideNote(`Изменения запишутся во все договоры заказа (${(row?.orders || []).length}): ${names((row?.orders || []).map((o) => o.orderNo || '—'))}.`), get value() { return ''; }, set value(_) { /* только показ */ } }) },
      { key: 'productionNo', label: '№ заказа', type: 'combo', required: true, options, max: 50,
        hint: row?.productionNo
          ? 'Номер для производства, например 21-26. Выберете № другого заказа — договоры объединятся с ним.'
          : (next ? `Подставлен следующий свободный № ${next} (последний + 1). Можно выбрать другой из списка.` : 'Номер для производства, например 21-26. Выберете № другого заказа — договоры объединятся с ним.'),
        mount: fillFreeNo },
      { key: 'deadline', label: 'Срок (дата отгрузки)', type: 'date', hint: 'Запишется в «Дата отгрузки» каждого договора. Пусто — срок не меняется.' },
      { key: 'priority', label: 'Приоритет', type: 'select', options: Object.entries(ORDER_PRIORITY).map(([value, p]) => ({ value, label: p.label })), hint: 'Срочные заказы выделяются в «Проектировании» и в списках.' },
    ];
  },
  toInitial: (r) => ({ productionNo: r.productionNo || '', deadline: r.deadline ? String(r.deadline).slice(0, 10) : '', priority: r.priority || 'normal' }),
  save: async (v, row) => {
    const no = String(v.productionNo ?? '').trim();
    if (!no) throw new Error('Укажите № заказа');
    const was = row.deadline ? String(row.deadline).slice(0, 10) : '';
    const prioNow = row.priority && row.priority !== 'normal' ? row.priority : '';
    const prioNew = v.priority === 'normal' ? '' : v.priority || '';
    const body = {};
    if (no !== (row.productionNo || '')) body.productionNo = no;
    if (v.deadline && v.deadline !== was) body.shipDate = v.deadline;
    if (prioNew !== prioNow) body.priority = prioNew;
    const list = row.orders || [];
    const key = body.productionNo || row.productionNo || row.key;
    if (Object.keys(body).length && list.length) {
      const done = [];
      for (const o of list) {
        try { await api(`/salesorders/${o.id}`, { method: 'PATCH', body }); done.push(o); }
        catch (e) {
          if (done.length) window.dispatchEvent(new CustomEvent('data-changed'));
          const left = list.filter((x) => !done.includes(x));
          const nm = (a) => names(a.map((x) => x.orderNo || '—'));
          throw new Error(`${String(errText(e)).replace(/\.?\s*$/, '.')} Изменены договоры: ${done.length ? nm(done) : 'ни одного'}. Не изменены: ${nm(left)}.`);
        }
      }
      toast(`Заказ № ${key} изменён (договоров: ${list.length})`);
    }
    // после «Сохранить» вернуться в карточку заказа (панель-форма сама закрывается чуть раньше)
    setTimeout(() => patch({ of: undefined, open: key }), 60);
    return { ...row, id: row.key };
  },
});

/** Договор (`salesorders`): правка шапки, отмена, удаление. Открывается из группы в карточке заказа. */
export const salesorder = {
  id: 'salesorder',
  kind: 'Договор с заказчиком',
  title: 'Договор с заказчиком',
  newTitle: 'Новый заказ (договор)', // кнопка «+ Заказ» — заголовок панели совпадает
  entityType: 'SalesOrder',
  canEdit: () => session.canEditOrders,
  historyLabels: { 'salesorder.created': 'Создан', 'salesorder.updated': 'Изменён', 'salesorder.deleted': 'Удалён', 'salesorder.restored': 'Восстановлен' },
  get: (id) => api(`/salesorders/${id}`),

  card: {
    heading: (r) => `Договор ${r.orderNo || '—'}`,
    subheading: (r) => [r.customer, r.companyName].filter(Boolean).join(' · '),
    parent: (r) => ({ label: `Заказ № ${prodNo(r)}`, run: () => patch({ of: undefined, open: r.productionNo || r.id }, { replace: false }) }),
    editTop: true,
    extra: (r) => handoffLine('salesorder', r.id),
    stats: (r) => [['Позиций', qty(r.lineCount)], ...(session.canMoney ? [['Сумма', r.amount ? money(r.amount) : '—'], ['Оплачено', r.paidAmount ? money(r.paidAmount) : '—']] : [])],
    view: (r) => [
      ['№ заказа', r.productionNo || h('span', { class: 'muted' }, 'нет №')],
      ...(r.offerId || r.offerNo ? [['Из КП', r.offerNo ? link({ label: r.offerNo, onClick: () => go('offers', { open: r.offerId }) }) : '—']] : []),
      ['Заказчик', customerLink(r.customer)],
      ['Предмет', r.title],
      ['Наша компания', r.companyName || h('span', { class: 'muted' }, 'не указана')],
      ['Приоритет', r.priority && r.priority !== 'normal' ? prio(r) : ''],
      ['Ответственный', r.responsible],
      ['Форма оплаты', r.paymentForm],
      ['№ госконтракта', [r.contractNo, r.contractDate && 'от ' + date(r.contractDate)].filter(Boolean).join(' ')],
      ['Срок изготовления', date(r.productionDeadline)],
      ['Дата отгрузки', date(r.shipDate)],
      ['Окончание поставки', date(r.deliveryDeadline)],
      ['Примечание', r.notes],
    ],
    // воронка этапов договора и крошки «Заказ № … › Договор …»; шаг ведёт к заказу и открывает нужную вкладку
    top: (r) => { crumbTrail([orderCrumb(r), `Договор ${r.orderNo || '—'}`]); return stageBar(r, { onStep: (k) => openStepFromContract(r, k) }); },
    actions: (r) => !editableOrder(r) ? [] : [
      NEXT[r.stage] && { label: NEXT_LABEL[r.stage], run: async (row, ctx) => ctx.setRow(await setContractStage(row, NEXT[row.stage])) },
      r.stage !== 'cancelled' && !['shipped', 'closed'].includes(r.stage) && { label: 'Отменить договор с заказчиком', run: async (row, ctx) => { if (!(await confirmDlg(`Отменить договор с заказчиком ${row.orderNo || ''}?`, 'Договор перейдёт в «Отменён» и уйдёт из «В работе». Брони и заявки не удаляются — снимите их отдельно. Вернуть можно сменой этапа.', { okText: 'Да, отменить договор с заказчиком', danger: true }))) return; ctx.setRow(await setContractStage(row, 'cancelled')); } },
      !closedStage(r) && ['admin', 'manager'].includes(session.role) && { label: 'Связать с каталогом', title: 'Связать позиции заказчика с нашими изделиями — для паспорта и производства. Договор не меняется.', run: async (row, ctx) => { const s = await matchProducts(row); if (s) ctx.setRow(s); } },
    ],
  },

  form: {
    fields: async (row) => {
      const [l, nums, next] = await Promise.all([
        incomeLookups().catch(() => ({ companies: [], customers: [], paymentForms: ['б/р', 'б/р 30%', 'б/р 50%', 'нал'] })),
        activeOrderNos().catch(() => []),
        freeNo(),
      ]);
      const options = uniq([next, ...nums].filter(Boolean)); const needNo = !row || !String(row.productionNo || '').trim();
      return [
        { section: 'Договор с заказчиком', tone: 'main', fixed: true },
        ...(await memoryFields({ row, customers: l.customers, companies: l.companies, next, needNo })),
        { key: 'productionNo', label: '№ заказа', type: 'combo', required: true, options, max: 50,
          hint: needNo
            ? (next
              ? `Новый заказ получит следующий свободный № ${next}. Существующий — выберите № из списка, договор войдёт в него.`
              : 'Номер для производства, например 21-26. Выберите № из списка — договор войдёт в этот заказ.')
            : 'Номер для производства, например 21-26: номер и год. Выберите № из списка — договор войдёт в этот заказ.',
          // новый или без № — сразу last+1
          mount: (fa) => { if (!needNo) return; if (next) fa.set('productionNo', next, { auto: true }); } },
        { key: 'orderNo', label: '№ договора', required: true, max: 50 },
        { key: 'title', label: 'Предмет заказа', wide: true, max: 1000 },
        { key: 'companyName', label: 'Наша компания', type: 'select', required: true, choose: true, hint: 'От компании зависят документы. Из прошлого заказа заказчика подставим по кнопке «Да, как в прошлый раз».', options: l.companies.map((c) => c.name) },
        { key: 'paymentForm', label: 'Форма оплаты', type: 'combo', options: l.paymentForms, max: 50 },
        await responsibleField('Кому передан договор. Смена записывается в историю передач.'),
        { key: 'priority', label: 'Приоритет', type: 'select', options: Object.entries(ORDER_PRIORITY).map(([value, p]) => ({ value, label: p.label })), hint: 'Срочные заказы выделяются в «Проектировании» и в списках.' },
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
    initial: async () => ({ stage: 'new', paymentForm: 'б/р', priority: 'normal', productionNo: await freeNo() }),
    toInitial: (r) => ({ ...r, priority: r.priority || 'normal', ...Object.fromEntries(['shipDate', 'productionDeadline', 'deliveryDeadline', 'contractDate'].map((k) => [k, r[k] ? String(r[k]).slice(0, 10) : ''])) }),
    toBody: (v) => {
      const s = (x) => (x === null ? '' : String(x));
      return { orderNo: s(v.orderNo), productionNo: s(v.productionNo), customer: s(v.customer), title: s(v.title), companyName: s(v.companyName), paymentForm: s(v.paymentForm), ...(v.stage ? { stage: v.stage } : {}), priority: v.priority === 'normal' ? '' : v.priority || '',
        ...('responsibleId' in v ? { responsibleId: v.responsibleId || '' } : {}),
        productionDeadline: v.productionDeadline || '', shipDate: v.shipDate || '', deliveryDeadline: v.deliveryDeadline || '', contractNo: s(v.contractNo), contractDate: v.contractDate || '', notes: s(v.notes), requireFields: true };
    },
    create: (body) => api('/salesorders', { method: 'POST', body: { ...body, clientUid: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) } }),
    update: (id, body) => api(`/salesorders/${id}`, { method: 'PATCH', body }),
  },

  remove: { password: true,
    text: (r) => `Удалить договор ${r.orderNo || ''} (${r.customer || 'без заказчика'})? Его позиции уйдут в корзину вместе с ним и вернутся при восстановлении. Заявки и брони останутся. Сорвавшийся заказ не удаляют: поставьте этап «Отменён», он останется в списке.`,
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
