import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { current, go } from '../core/router.js';
import { paintOrder } from '../core/order-color.js';
import { badge, DESIGN_STATUS, ORDER_PRIORITY } from './badges.js';
import { busyBlock, failBlock } from './busy.js';
import { confirmDlg, modal } from './dialog.js';
import { afterDrag, draggable } from './drag.js';
import { enhanceSelect } from './select.js';
import { toast, toastError } from './toast.js';

/**
 * Доска заказов «Проектирование» (DESIGN §4 «Доска заказов», `.db`): слева выбранные заказы (раскрываются в изделия),
 * справа колонки статусов; изделие переносят из заказа в колонку или между колонками (ui/drag.js, меню «Статус»).
 * Подключается как `board.mount` в ui/list.js — тот же вид {el, reload, setQuery}. Старая плоская доска — ?view=flat.
 * Сервер: GET /design-board (заказы, счётчики, открытые задачи), GET /design-board/:id/lines (позиции раскрытого заказа),
 * POST /design-board {orderId, distribute?}, DELETE /design-board/:orderId, POST /design-tasks {incomeId, status, assigneeId?, pauseReason?}.
 * board.env = { people(), moveTask(task, to), dueNode(row), activeOrders(), stageLabel(stage) } — из sections/design.js.
 */
export const COL_LABEL = { queue: 'Распределение', work: 'В работе', paused: 'Приостановлены', done: 'Завершены' };
const COLS = ['queue', 'work', 'paused', 'done'];
const SHORT = { queue: 'распределение', work: 'в работе', paused: 'пауза', done: 'готово' };
const PER_DONE = 20;
const isPhone = () => window.matchMedia('(max-width: 720px)').matches;
/** Пустое значение (null, undefined, пустая строка, случайное слово «null») — ''. Такое на экране не печатаем. */
export const clean = (v) => { const s = v === null || v === undefined || v === false ? '' : String(v).trim(); return s === 'null' || s === 'undefined' || /^-{2,}$/.test(s) ? '' : s; };
/** Подпись из кусочков: пустые отбрасываются, остальные через « · ». */
export const dotted = (...xs) => xs.map(clean).filter(Boolean).join(' · ');
const plain = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');

// ---------- общие окна (их же использует sections/design.js) ----------
/** Окно причины паузы → строка или null (отмена). */
export function askReason() {
  const inp = h('input', { maxlength: 500, placeholder: 'Например: ждём размеры от заказчика', 'aria-label': 'Причина паузы' });
  return modal({ title: 'Приостановить задачу', body: h('label', { class: 'field' }, h('span', null, 'Причина паузы'), inp), okText: 'Приостановить',
    onOk: () => { const v = inp.value.trim(); if (!v) throw new Error('Впишите причину паузы.'); return v; } });
}
/** Окно «Кто проектирует?» → id сотрудника или null (отмена — ничего не создаётся и не меняется). */
export function askAssignee(people, { okText = 'Назначить и взять в работу' } = {}) {
  const sel = h('select', { 'aria-label': 'Исполнитель' }, h('option', { value: '' }, '— выберите —'), ...people.map((p) => h('option', { value: p.value }, p.label)));
  queueMicrotask(() => enhanceSelect(sel));
  return modal({ title: 'Кто проектирует?', body: h('label', { class: 'field' }, h('span', null, 'Исполнитель'), sel), okText,
    onOk: () => { if (!sel.value) throw new Error('Выберите исполнителя.'); return sel.value; } });
}

/** Лист снизу «Куда перенести …?» (единственный путь на телефоне и с клавиатуры). options: [{ to, label, here }] */
export function statusSheet({ title, options, onPick, opener }) {
  const back = h('div', { class: 'db-sheet-back' });
  const close = () => { document.removeEventListener('keydown', onKey, true); back.remove(); opener?.focus?.(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const btns = options.map((o) => h('button', { type: 'button', class: 'db-sheet-opt' + (o.here ? ' here' : ''), disabled: !!o.here, 'aria-current': o.here ? 'true' : undefined,
    onclick: () => { close(); onPick(o.to); } }, h('span', null, o.label), o.here ? h('small', null, 'сейчас') : null));
  const sheet = h('div', { class: 'db-sheet', role: 'dialog', 'aria-modal': 'true', tabindex: '-1', 'aria-label': 'Куда перенести «' + title + '»?' },
    h('h3', null, 'Куда перенести «', h('span', { class: 'db-sheet-t' }, title), '»?'), ...btns,
    h('button', { type: 'button', class: 'btn db-sheet-cancel', onclick: close }, 'Отмена'));
  back.append(sheet);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(back);
  (btns.find((b) => !b.disabled) || sheet).focus();
}

// ---------- данные: приведение ответа сервера к одному виду ----------
const idOf = (x) => String(x?.orderId ?? x?.id ?? '');
export function normOrder(o) {
  const c = o.counts || {};
  return { orderId: idOf(o), orderNo: clean(o.orderNo), customer: clean(o.customer), deadline: o.deadline ?? null, priority: o.priority || 'normal', stage: o.stage || '',
    note: o.note || '', addedAt: o.addedAt || null, counts: { queue: c.queue || 0, work: c.work || 0, paused: c.paused || 0, done: c.done || 0, free: c.free ?? null }, lines: o.lines };
}
/** Позиция заказа (с задачей или без) → единый вид. */
export function normLine(l, order) {
  const t = l.task ? normTask({ ...l.task, incomeId: l.incomeId ?? l.id, lineNo: l.lineNo, title: l.task.title ?? l.title, productName: l.productName, sku: l.sku, photo: l.photo }, order) : null;
  return { incomeId: String(l.incomeId ?? l.id ?? ''), lineNo: l.lineNo ?? null, title: clean(l.title) || clean(l.productName) || 'Без названия', qty: l.qty ?? null, productId: l.productId || null, sku: clean(l.sku) || null, photo: l.photo || null, task: t };
}
/** Задача (из открытых задач или вложенная в позицию) → вид, который понимают moveTask и карточка. */
export function normTask(t, order) {
  return { ...t, id: String(t.id), status: t.status, title: clean(t.title), productName: clean(t.productName) || null, sku: clean(t.sku) || null, customerTitle: clean(t.customerTitle) || null, orderId: String(t.orderId ?? order?.orderId ?? ''), orderNo: clean(t.orderNo) || clean(order?.orderNo) || null,
    assigneeId: t.assigneeId ?? t.assignee?.id ?? null, assignee: t.assignee || null, pauseReason: t.pauseReason || null, priority: t.priority || order?.priority || 'normal',
    deadline: t.deadline ?? order?.deadline ?? null, seq: t.seq ?? Number(String(t.code || '').replace(/\D/g, '')) ?? 0 };
}
export function normBoard(r) {
  const orders = (r.orders || r.items || []).map(normOrder);
  const byId = new Map(orders.map((o) => [o.orderId, o]));
  const tasks = (r.tasks || []).map((t) => normTask(t, byId.get(String(t.orderId))));
  if (!r.tasks) for (const o of orders) for (const l of o.lines || []) { const x = normLine(l, o); if (x.task && x.task.status !== 'done') tasks.push(x.task); }
  return { orders, tasks, total: r.total ?? orders.length };
}
// последняя загрузка доски — панель заказа берёт шапку заказа отсюда
let lastOrders = new Map();
export const boardOrder = (id) => lastOrders.get(String(id)) || null;
/** Заказ доски по id со свежими счётчиками (панель заказа; работает и по прямой ссылке). */
export async function fetchBoardOrder(id) {
  const nb = normBoard(await api('/design-board'));
  lastOrders = new Map(nb.orders.map((o) => [o.orderId, o]));
  return boardOrder(id);
}
export async function loadLines(orderId, order) {
  const r = await api(`/design-board/${orderId}/lines`);
  return (Array.isArray(r) ? r : r.lines || r.items || []).map((l) => normLine(l, order));
}
export async function addToBoard(orderId, distribute) { return api('/design-board', { method: 'POST', body: { orderId, ...(distribute ? { distribute: true } : {}) } }); }
export async function removeFromBoard(orderId) { return api(`/design-board/${orderId}`, { method: 'DELETE' }); }
export const changed = () => window.dispatchEvent(new CustomEvent('data-changed'));
/** «На распределение все позиции». Сообщение — сколько создано и сколько уже было. */
export async function distributeOrder(orderId) {
  const r = await addToBoard(orderId, true);
  toast(r.created ? `На распределение: ${r.created} поз.${r.skipped ? ` (уже были: ${r.skipped})` : ''}` : 'Все позиции уже взяты в проектирование', { tone: r.created ? 'success' : 'info' });
  return r;
}
/** «Убрать из проектирования»: подтверждение, отказ сервера (есть открытые задачи) — понятным текстом, «Отменить» возвращает. */
export async function dropOrder(order) {
  if (!(await confirmDlg('Убрать заказ из проектирования?', `${orderName(order)} пропадёт из левой колонки. Задачи останутся в таблице.`, { okText: 'Убрать' }))) return false;
  try { await removeFromBoard(order.orderId); } catch (e) { toastError(e, 'убрать заказ'); return false; }
  toast(`${orderName(order)} убран из проектирования`, { undo: async () => { await addToBoard(order.orderId); changed(); } });
  return true;
}

/**
 * Взять позицию заказа в проектирование: ОДИН POST /design-tasks {incomeId, status, assigneeId?, pauseReason?}.
 * В «В работе» спрашивает исполнителя, в «Приостановлены» — причину; отмена окна — ничего не создаётся (false). Сразу в «Завершены» нельзя.
 */
export async function createTask(line, to, people) {
  if (to === 'done') { toast('Сначала возьмите изделие в работу', { tone: 'warn' }); return false; }
  const body = { incomeId: line.incomeId, status: to };
  if (to === 'paused') { const why = await askReason(); if (!why) return false; body.pauseReason = why; }
  if (to === 'work') { const who = await askAssignee(await people()); if (!who) return false; body.assigneeId = who; }
  const t = await api('/design-tasks', { method: 'POST', body });
  toast(to === 'work' ? 'Взято в работу' : to === 'paused' ? 'Приостановлено' : 'Отправлено на распределение', { undo: async () => { await api(`/design-tasks/${t.id}`, { method: 'DELETE' }); changed(); } });
  return true;
}

// ---------- мелкие элементы ----------
const photo = (src, cls = 'db-pic') => (src ? h('img', { class: cls, src: PREFIX + src, alt: '', loading: 'lazy', draggable: 'false', onerror: (e) => e.target.replaceWith(h('span', { class: cls + ' none' })) }) : h('span', { class: cls + ' none' }));
const orderName = (o) => (clean(o.orderNo) ? 'ЗНП ' + clean(o.orderNo) : 'Заказ без номера');
const chip = (orderId, orderNo) => (orderId ? paintOrder(h('span', { class: 'db-chip' }, h('i', { class: 'db-dot' }), 'ЗНП ' + (clean(orderNo) || 'без номера')), orderId) : h('span', { class: 'db-chip none' }, 'Без заказа'));

/** Куда можно перенести: с левой стороны (нет задачи) — в «Завершены» нельзя. */
function sheetOptions(status) {
  const items = [['queue', status ? 'Вернуть на распределение' : 'Распределение'], ['work', status === 'done' ? 'Вернуть в работу' : status === 'paused' ? 'Возобновить' : 'В работе'], ['paused', 'Приостановить']];
  if (status) items.push(['done', 'Завершить']);
  return items.map(([to, label]) => ({ to, label, here: to === status }));
}

export function mountDesignBoard(board, _path, initialQuery, { onTotal }) {
  const env = board.env;
  const canEdit = session.canEdit;
  let query = initialQuery;
  const S = { orders: [], tasks: [], done: [], doneTotal: 0, donePage: 1, lines: new Map(), loadingLines: new Set(), expanded: new Set(), error: null, ready: false };
  let tab = 'board', chipCol = 'queue', seq = 0, openMenu = null, addBox = null;

  const live = h('div', { class: 'db-live', 'aria-live': 'polite', role: 'status' });
  const ordersHead = h('div', { class: 'db-ohead' });
  const ordersList = h('div', { class: 'db-olist' });
  const colsEl = h('div', { class: 'db-cols' });
  const chipsEl = h('div', { class: 'db-chips', role: 'tablist', 'aria-label': 'Статус' });
  const tabsEl = h('div', { class: 'seg db-tabs', role: 'tablist', 'aria-label': 'Раздел доски' });
  const left = h('aside', { class: 'db-left', 'aria-label': 'Заказы в проектировании' }, ordersHead, ordersList);
  const right = h('div', { class: 'db-right' }, chipsEl, colsEl);
  const el = h('div', { class: 'db', dataset: { tab: 'board', col: 'queue' } }, tabsEl, left, right, live);

  const syncUrl = () => { S.expanded = new Set(String(current().params.o || '').split(',').filter(Boolean)); };
  const announce = (t) => { live.textContent = ''; setTimeout(() => { live.textContent = t; }, 30); };
  const openTask = (t) => { const P = current().params; go('design', { ...P, of: undefined, open: t.id, new: undefined }, { replace: !!P.open, kind: 'card' }); };
  const openOrder = (id) => { const P = current().params; go('design', { ...P, of: 'designorder', open: id, new: undefined }, { replace: !!P.open, kind: 'card' }); };
  const setO = () => { const o = [...S.expanded].join(','); const P = current().params; if ((P.o || '') !== o) go('design', { ...P, o: o || undefined }, { replace: true }); };

  // ---------- фильтры шапки списка (поиск, исполнитель, заказ) — по уже загруженному ----------
  const taskText = (t) => plain([t.code, t.title, t.productName, t.sku, t.orderNo, t.customerTitle].join(' '));
  const orderText = (o) => plain([o.orderNo, o.customer].join(' '));
  const wantTask = (t) => (!query.assigneeId || t.assigneeId === query.assigneeId) && (!query.orderId || t.orderId === query.orderId) && (!query.search || taskText(t).includes(plain(query.search)));
  const visibleOrders = () => {
    const q = plain(query.search);
    return S.orders.filter((o) => (!query.orderId || o.orderId === query.orderId)
      && (!q || orderText(o).includes(q) || S.tasks.some((t) => t.orderId === o.orderId && taskText(t).includes(q))));
  };

  // ---------- действия ----------
  /** Любое действие: отмена окна — тихо; 409 — «уже взяли» и перечитать; всегда перечитываем доску. */
  async function act(fn, ok) {
    el.classList.add('loading');
    try {
      const r = await fn();
      if (r !== false && r !== null && ok) announce(ok);
    } catch (e) {
      if (e?.status === 409) toast('Позицию уже взяли', { tone: 'warn', sub: 'Список обновлён.' });
      else toastError(e, 'перенести изделие');
    } finally { await load(true); }
  }
  /** Перенос изделия. item: { task } — существующая задача, { line } — позиция без задачи (создаётся одним POST). */
  async function moveItem(item, to) {
    if (item.task) {
      if (item.task.status === to) return false;
      return !!(await env.moveTask(item.task, to));
    }
    return createTask(item.line, to, env.people);
  }
  const moveTo = (item, to) => act(() => moveItem(item, to), `Перенесено в «${COL_LABEL[to]}»`);
  function pickStatus(item, title, opener) {
    statusSheet({ title, options: sheetOptions(item.task?.status || null), opener, onPick: (to) => moveTo(item, to) });
  }
  function dropOn(item, colEl) {
    const to = colEl.dataset.key;
    if (item.task && item.task.status === to) return;
    // изделие приземляется в колонку сразу (временная карточка); не вышло — перечитывание уберёт
    const body = colEl.querySelector('.col-body');
    if (item.task && item.node) body.prepend(item.node);
    else if (item.line && to !== 'done') body.prepend(h('article', { class: 'tcard db-task is-temp' }, h('div', { class: 't-title' }, item.line.title), h('div', { class: 't-sub' }, 'Создаю задачу…')));
    moveTo(item, to);
  }
  function revealTask(t) {
    tab = 'board'; chipCol = t.status; el.dataset.tab = 'board'; el.dataset.col = t.status;
    const node = colsEl.querySelector(`[data-task="${t.id}"]`);
    if (node) { node.scrollIntoView({ block: 'center', inline: 'nearest' }); node.classList.remove('flash'); void node.offsetWidth; node.classList.add('flash'); node.focus({ preventScroll: true }); }
  }

  // ---------- левая колонка ----------
  function closeMenus() { openMenu?.(); openMenu = null; }
  document.addEventListener('click', (e) => { if (!el.isConnected) return; if (!e.target.closest?.('.db-menu-host, .db-add-host')) { closeMenus(); closeAdd(); } });
  function menuBtn(label, items, cls = '') {
    const menu = h('div', { class: 'menu db-menu', role: 'menu', hidden: true }, items.map((i) => h('button', { type: 'button', role: 'menuitem', class: i.danger ? 'danger' : '', onclick: (e) => { e.stopPropagation(); closeMenus(); i.run(); } }, i.label)));
    const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon db-more ' + cls, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': label, title: label,
      onclick: (e) => {
        e.stopPropagation();
        const was = !menu.hidden; closeMenus();
        if (was) return;
        menu.hidden = false; btn.setAttribute('aria-expanded', 'true'); menu.querySelector('button')?.focus();
        openMenu = () => { menu.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
      },
      onkeydown: (e) => { if (e.key === 'Escape') { closeMenus(); btn.focus(); } } }, '⋯');
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenus(); btn.focus(); } });
    return h('span', { class: 'rel db-menu-host' }, btn, menu);
  }

  function lineEl(o, l) {
    const t = l.task;
    const node = h('div', { class: 'db-line' + (t ? ' has-task' : ' movable'), tabindex: '0', dataset: { income: l.incomeId },
      'aria-label': `${l.lineNo != null ? 'Поз. ' + l.lineNo + ' ' : ''}${l.title}${t ? ', ' + (COL_LABEL[t.status] || '') : ', ещё не взято'}`,
      onclick: () => (t ? openTask(t) : openOrder(o.orderId)),
      onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (t) openTask(t); else openOrder(o.orderId); } } },
    photo(l.photo, 'db-pic sm'),
    h('div', { class: 'db-lmain' }, h('div', { class: 't-title', title: l.title }, (l.lineNo != null ? `поз. ${l.lineNo} · ` : '') + l.title),
      h('div', { class: 't-sub' }, dotted(l.sku && '№ ' + l.sku, l.qty != null && qty(l.qty) + ' шт'))),
    t ? h('div', { class: 'db-lstate' }, badge(DESIGN_STATUS, t.status),
      h('button', { type: 'button', class: 'link-btn', onclick: (e) => { e.stopPropagation(); revealTask(t); } }, `в колонке «${COL_LABEL[t.status]}» →`))
      : canEdit ? h('button', { type: 'button', class: 'btn btn-ghost btn-icon db-more', 'aria-label': `Статус: перенести «${l.title}»`, title: 'Статус', onclick: (e) => { e.stopPropagation(); pickStatus({ line: l }, l.title, e.currentTarget); } }, '⋯') : null);
    if (!t && canEdit) draggable(node, { canStart: () => !isPhone(), targetSel: '.db-cols .col', scroller: colsEl, sourceClass: 'is-lifted', onDrop: (c) => dropOn({ line: l }, c) });
    return node;
  }

  function orderEl(o) {
    const open = S.expanded.has(o.orderId);
    const c = o.counts;
    const chev = h('button', { type: 'button', class: 'db-chev', 'aria-expanded': String(open), 'aria-label': `${open ? 'Скрыть' : 'Показать'} изделия заказа ${orderName(o)}`,
      onclick: () => toggle(o.orderId) }, open ? '▾' : '▸');
    const counts = [...COLS.filter((k) => c[k]).map((k) => h('span', { class: 'db-cnt ' + k, title: COL_LABEL[k] }, `${SHORT[k]} ${c[k]}`)),
      c.free ? h('span', { class: 'db-cnt free', title: 'Изделия, которые ещё не взяты в проектирование' }, `не взято ${c.free}`) : null];
    const items = [{ label: 'Открыть', run: () => openOrder(o.orderId) },
      ...(canEdit ? [{ label: 'На распределение все позиции', run: () => act(() => distributeOrder(o.orderId)) }, { label: 'Убрать из проектирования', danger: true, run: () => act(() => dropOrder(o)) }] : [])];
    const lines = S.lines.get(o.orderId);
    const body = !open ? null : h('div', { class: 'db-lines' }, S.loadingLines.has(o.orderId) && !lines ? busyBlock('изделия', { cls: 'db-hint' })
      : lines && lines.length ? lines.map((l) => lineEl(o, l)) : h('div', { class: 'db-hint' }, 'В заказе нет позиций.'));
    return paintOrder(h('article', { class: 'db-order' + (open ? ' open' : ''), dataset: { order: o.orderId } },
      h('div', { class: 'db-oh' }, chev,
        h('button', { type: 'button', class: 'db-oname', title: 'Открыть заказ справа', onclick: () => openOrder(o.orderId) }, h('b', null, orderName(o)), o.customer ? h('span', { class: 'db-cust' }, ' · ' + o.customer) : null),
        menuBtn(`Действия с заказом ${orderName(o)}`, items)),
      h('div', { class: 'db-ometa' }, env.dueNode({ deadline: o.deadline, status: 'queue' }), o.priority && o.priority !== 'normal' ? badge(ORDER_PRIORITY, o.priority) : null),
      h('div', { class: 'db-ocnt' }, counts), body), o.orderId);
  }

  function toggle(id) {
    if (S.expanded.has(id)) S.expanded.delete(id); else { S.expanded.add(id); fetchLines(id); }
    paintLeft(); setO();
  }
  async function fetchLines(id) {
    S.loadingLines.add(id);
    try { S.lines.set(id, await loadLines(id, boardOrder(id))); }
    catch (e) { S.lines.set(id, []); toastError(e, 'открыть изделия заказа'); }
    finally { S.loadingLines.delete(id); afterDrag(() => paintAll()); }
  }

  function closeAdd() { addBox?.close(); }
  function addPicker() {
    const host = h('span', { class: 'rel db-add-host' });
    const btn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', onclick: (e) => { e.stopPropagation(); if (pop.hidden) show(); else close(); } }, '+ Добавить заказ');
    const search = h('input', { type: 'text', placeholder: '№ заказа или заказчик', 'aria-label': 'Найти заказ', autocomplete: 'off', oninput: () => paint() });
    const list = h('div', { class: 'db-add-list', role: 'listbox' });
    const pop = h('div', { class: 'db-add', role: 'dialog', 'aria-label': 'Добавить заказ в проектирование', hidden: true, onclick: (e) => e.stopPropagation() },
      h('div', { class: 'db-add-head' }, search, h('button', { type: 'button', class: 'btn btn-ghost btn-icon db-add-x', 'aria-label': 'Закрыть', onclick: () => close() }, '✕')), list);
    let all = null, sel = null;
    function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); sel = null; document.removeEventListener('keydown', onKey, true); }
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } };
    async function show() {
      closeMenus();
      pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); document.addEventListener('keydown', onKey, true);
      list.replaceChildren(busyBlock('заказы', { cls: 'db-hint' }));
      try { all = await env.activeOrders(); } catch (e) { list.replaceChildren(failBlock(e, show, { cls: 'db-hint', text: 'Заказы не загрузились' })); return; }
      search.value = ''; paint(); search.focus();
    }
    async function add(o, distribute) {
      close(); el.classList.add('loading');
      try {
        if (distribute) { const r = await addToBoard(o.id, true); toast(`Заказ ${orderName({ orderNo: o.orderNo })} добавлен${r.created ? `, на распределение: ${r.created} поз.` : ''}`); }
        else { await addToBoard(o.id, false); toast(`Заказ ${orderName({ orderNo: o.orderNo })} добавлен в проектирование`); }
        S.expanded.add(o.id); setO();
      } catch (e) { toastError(e, 'добавить заказ'); } finally { await load(true); }
    }
    function paint() {
      const have = new Set(S.orders.map((o) => o.orderId));
      const q = plain(search.value);
      const rows = (all || []).filter((o) => !have.has(String(o.id)) && (!q || plain(dotted(o.orderNo, o.customer)).includes(q)));
      if (!rows.length) { list.replaceChildren(h('div', { class: 'db-hint' }, 'Нет подходящих заказов. Добавлены все заказы в работе, либо заказа нет — проверьте раздел «Заказы».')); return; }
      list.replaceChildren(...rows.slice(0, 40).map((o) => {
        const on = sel === o.id;
        return h('div', { class: 'db-add-row' + (on ? ' on' : ''), role: 'option', 'aria-selected': String(on) },
          h('button', { type: 'button', class: 'db-add-pick', onclick: () => { sel = on ? null : o.id; paint(); } },
            h('b', null, orderName(o)), clean(o.customer) ? ' · ' + clean(o.customer) : '',
            h('small', null, [o.shipDate ? 'отгрузка ' + String(o.shipDate).slice(0, 10).split('-').reverse().join('.') : '', o.lines?.length ? o.lines.length + ' поз.' : ''].filter(Boolean).join(' · '))),
          on ? h('div', { class: 'db-add-acts' }, h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => add(o, true) }, 'Добавить и на распределение'),
            h('button', { type: 'button', class: 'btn btn-sm', onclick: () => add(o, false) }, 'Только добавить')) : null);
      }).concat(rows.length > 40 ? [h('div', { class: 'db-hint' }, `Ещё ${rows.length - 40} — уточните поиск.`)] : []));
    }
    addBox = { close, paint, isHidden: () => pop.hidden };
    host.append(btn, pop);
    return host;
  }

  function paintLeft() {
    const vis = visibleOrders();
    ordersHead.replaceChildren(h('h2', { class: 'db-h' }, 'Заказы · ', h('span', { class: 'num' }, String(vis.length))), picker);
    if (!S.ready) { ordersList.replaceChildren(busyBlock('заказы', { cls: 'db-hint' })); return; }
    if (S.error) { ordersList.replaceChildren(failBlock(S.error, () => load(true), { cls: 'db-hint', text: 'Доска не загрузилась' })); return; }
    ordersList.replaceChildren(...(vis.length ? vis.map(orderEl) : [h('div', { class: 'db-empty' }, S.orders.length ? 'По вашему поиску заказов нет.' : 'Добавьте заказ, который нужно проектировать — кнопка выше.')]));
  }

  // ---------- правая часть: колонки статусов ----------
  function taskEl(t) {
    const title = clean(t.productName) || clean(t.title) || 'Без названия';
    const node = h('article', { class: 'tcard db-task' + (canEdit ? ' movable' : ''), tabindex: '0', role: 'button', dataset: { task: t.id },
      'aria-label': `${t.orderNo ? 'ЗНП ' + t.orderNo + ', ' : ''}${title}, ${COL_LABEL[t.status] || ''}`,
      onclick: () => openTask(t), onkeydown: (e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openTask(t); } } },
    h('div', { class: 'db-ttop' }, chip(t.orderId, t.orderNo),
      canEdit ? h('button', { type: 'button', class: 'btn btn-ghost btn-icon db-more', 'aria-label': `Статус: перенести «${title}»`, title: 'Статус', onclick: (e) => { e.stopPropagation(); pickStatus({ task: t }, title, e.currentTarget); } }, '⋯') : null),
    h('div', { class: 'db-tbody' }, photo(t.photo),
      h('div', { class: 't-main' }, h('div', { class: 't-title', title }, title),
        h('div', { class: 't-sub', title: t.pauseReason || '' }, dotted(t.status === 'paused' && t.pauseReason, t.sku && '№ ' + t.sku, t.lineNo != null && 'поз. ' + t.lineNo, t.code)))),
    h('div', { class: 't-foot' }, env.dueNode(t), t.priority && t.priority !== 'normal' ? badge(ORDER_PRIORITY, t.priority) : null,
      t.assignee ? h('span', { class: 'avatar sm', title: clean(t.assignee.name), 'aria-label': 'Исполнитель: ' + clean(t.assignee.name) }, clean(t.assignee.initials) || '?') : h('span', { class: 't-none' }, 'не назначен')));
    if (t.orderId) paintOrder(node, t.orderId); else paintOrder(node, '');
    if (canEdit) {
      const item = { task: t, node };
      draggable(node, { canStart: () => !isPhone(), targetSel: '.db-cols .col', scroller: colsEl, onDrop: (c) => dropOn(item, c) });
    }
    return node;
  }

  function groups(list) {
    const order = new Map(visibleOrders().map((o, i) => [o.orderId, i]));
    const by = new Map();
    for (const t of list) { const k = t.orderId || ''; if (!by.has(k)) by.set(k, []); by.get(k).push(t); }
    return [...by.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : (order.get(a) ?? 999) - (order.get(b) ?? 999)));
  }
  function colEl(key) {
    const list = (key === 'done' ? S.done : S.tasks.filter((t) => t.status === key)).filter(wantTask);
    const n = key === 'done' ? S.doneTotal : list.length;
    const body = h('div', { class: 'col-body' });
    if (!list.length) body.append(h('div', { class: 'col-more muted db-colempty' }, key === 'paused' ? 'Пусто' : canEdit ? 'Перетащите сюда изделие из заказа слева' : 'Здесь пока пусто'));
    for (const [oid, ts] of groups(list)) {
      const o = oid && boardOrder(oid);
      const g = h('div', { class: 'db-group' });
      paintOrder(g, oid);
      g.append(h('div', { class: 'db-ghead' }, h('i', { class: 'db-dot' }), oid ? [h('b', null, 'ЗНП ' + (clean(o?.orderNo) || clean(ts[0].orderNo) || 'без номера')), o?.customer ? h('span', { class: 'muted' }, ' · ' + o.customer) : null] : 'Без заказа'),
        ...ts.sort((a, b) => (key === 'done' ? 0 : (a.seq || 0) - (b.seq || 0))).map(taskEl));
      body.append(g);
    }
    if (key === 'done' && S.doneTotal > S.done.length) {
      body.append(h('button', { type: 'button', class: 'col-more link-btn', onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try { const r = await fetchDone(S.donePage + 1); S.donePage++; S.done = S.done.concat(r.items); S.doneTotal = r.total; paintRight(); } catch (ex) { b.disabled = false; toastError(ex, 'показать завершённые'); }
      } }, `ещё ${qty(Math.min(PER_DONE, S.doneTotal - S.done.length))} из ${qty(S.doneTotal - S.done.length)} →`));
    }
    const count = h('span', { class: 'n' }, S.ready ? qty(n) : '…');
    return h('section', { class: `col tone-${DESIGN_STATUS[key].tone} db-col${key === 'paused' && !list.length ? ' is-collapsed' : ''}`, role: 'region', 'aria-label': COL_LABEL[key], dataset: { key } },
      h('div', { class: 'col-head' }, h('span', { class: 'dot' }), h('span', null, COL_LABEL[key]), count), body);
  }
  function paintRight() {
    chipsEl.replaceChildren(...COLS.map((k) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(chipCol === k), class: 'chip' + (chipCol === k ? ' active' : ''),
      onclick: () => { chipCol = k; el.dataset.col = k; paintRight(); } }, COL_LABEL[k], h('b', null, k === 'done' ? qty(S.doneTotal) : String(S.tasks.filter((t) => t.status === k).filter(wantTask).length)))));
    if (!S.ready) { colsEl.replaceChildren(h('div', { class: 'skel', style: { margin: '8px 4px' } })); return; }
    colsEl.replaceChildren(...COLS.map(colEl));
  }
  function paintTabs() {
    tabsEl.replaceChildren(...[['orders', 'Заказы'], ['board', 'Доска']].map(([k, label]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(tab === k), class: tab === k ? 'active' : '',
      onclick: () => { tab = k; el.dataset.tab = k; paintTabs(); } }, label)));
  }
  function paintAll() { paintTabs(); paintLeft(); paintRight(); }

  // ---------- загрузка ----------
  const fetchDone = (page) => api('/design-tasks', { query: { status: 'done', sort: '-completedAt', limit: PER_DONE, page, search: query.search, assigneeId: query.assigneeId, orderId: query.orderId } });
  async function load(quiet) {
    const my = ++seq;
    syncUrl();
    if (!quiet) el.classList.add('loading');
    try {
      const [b, d] = await Promise.all([api('/design-board'), fetchDone(1).catch(() => ({ items: [], total: 0 }))]);
      if (my !== seq) return;
      const nb = normBoard(b);
      S.orders = nb.orders.sort((a, z) => (a.deadline ? 0 : 1) - (z.deadline ? 0 : 1) || String(a.deadline).localeCompare(String(z.deadline)) || String(a.orderNo).localeCompare(String(z.orderNo), 'ru', { numeric: true }));
      lastOrders = new Map(S.orders.map((o) => [o.orderId, o]));
      S.tasks = nb.tasks;
      S.done = (d.items || []).map((t) => normTask(t, lastOrders.get(String(t.orderId)))); S.doneTotal = d.total ?? S.done.length; S.donePage = 1;
      S.expanded = new Set([...S.expanded].filter((id) => lastOrders.has(id)));
      S.error = null;
      if (!S.ready && !S.tasks.length && !S.doneTotal) { tab = 'orders'; el.dataset.tab = 'orders'; } // телефон: нечего показывать на доске — начинаем с заказов
      S.ready = true;
      if (addBox && !addBox.isHidden()) addBox.paint();
      await Promise.all([...S.expanded].map(async (id) => { try { S.lines.set(id, await loadLines(id, lastOrders.get(id))); } catch { /* строки покажут «нет позиций» */ } }));
      S.loadingLines.clear();
      if (my !== seq) return;
      onTotal?.(S.tasks.length + S.doneTotal);
    } catch (e) {
      if (my !== seq) return;
      S.error = e; S.ready = true;
    } finally { if (my === seq) { el.classList.remove('loading'); afterDrag(paintAll); } }
  }

  const picker = canEdit ? addPicker() : null; // один на всё время: открытый список не закрывается от перерисовки
  syncUrl();
  S.expanded.forEach((id) => { S.loadingLines.add(id); });
  paintAll();
  load();
  let lastKey = JSON.stringify(query);
  return {
    el,
    reload: () => afterDrag(() => load(true)),
    /** Новые параметры адреса: фильтры шапки — перерисовать по загруженному; раскрытые заказы (?o=) — подгрузить позиции; панели справа данных не меняют. */
    setQuery: (q) => {
      query = q;
      const key = JSON.stringify(q);
      const before = [...S.expanded].join(',');
      syncUrl();
      for (const id of S.expanded) if (!S.lines.has(id) && !S.loadingLines.has(id) && lastOrders.has(id)) fetchLines(id);
      if (key !== lastKey) { lastKey = key; load(true); } else if ([...S.expanded].join(',') !== before) afterDrag(paintAll);
    },
  };
}
