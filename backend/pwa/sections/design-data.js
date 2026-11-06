import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { plural } from '../core/format.js';
import { actions, button, confirmDlg, modal, enhanceSelect, toast, toastError } from '../ui/kit/index.js';

/**
 * Данные и окна «Проектирования» (сама доска — эталон ui/kit/board.js, настроена в sections/design.js).
 * Здесь: окна причины и исполнителя, приведение ответа GET /design-board, действия над заказом (панель sections/design-order.js).
 * Сервер: GET /design-board (заказы, счётчики), GET /design-board/:id/lines, POST /design-board {orderId, distribute?},
 * DELETE /design-board/:orderId, POST /design-tasks {incomeId, status, assigneeId?, pauseReason?}.
 */
export const COL_LABEL = { queue: 'Распределение', work: 'В работе', paused: 'Приостановлены', done: 'Завершены', cancelled: 'Отменены' };
/** Пустое значение (null, undefined, пустая строка, случайное слово «null») — ''. Такое на экране не печатаем. */
export const clean = (v) => { const s = v === null || v === undefined || v === false ? '' : String(v).trim(); return s === 'null' || s === 'undefined' || /^-{2,}$/.test(s) ? '' : s; };
// ---------- общие окна (их же использует sections/design.js) ----------
/** Окно причины паузы → строка или null (отмена). */
/** Причина паузы или отмены (to = 'paused' | 'cancelled'). */
export function askReason(to = 'paused') {
  const c = to === 'cancelled';
  const inp = h('input', { maxlength: 500, placeholder: c ? 'Например: договор расторгнут' : 'Например: ждём размеры от заказчика', 'aria-label': c ? 'Причина отмены' : 'Причина паузы' });
  return modal({ title: c ? 'Отменить задачу' : 'Приостановить задачу', body: h('div', null, h('label', { class: 'field' }, h('span', null, c ? 'Причина отмены' : 'Причина паузы'), inp), c ? h('p', { class: 'hint' }, 'Работа по изделию снята, документации нет. Вернуть можно — «На распределение».') : null), okText: c ? 'Отменить задачу' : 'Приостановить', danger: c,
    onOk: () => { const v = inp.value.trim(); if (!v) throw new Error(c ? 'Впишите причину отмены.' : 'Впишите причину паузы.'); return v; } });
}
/** Окно «Кто проектирует?» → id сотрудника или null (отмена — ничего не создаётся и не меняется). */
export function askAssignee(people, { okText = 'Назначить и взять в работу' } = {}) {
  const sel = h('select', { 'aria-label': 'Исполнитель' }, h('option', { value: '' }, '— выберите —'), ...people.map((p) => h('option', { value: p.value }, p.label)));
  queueMicrotask(() => enhanceSelect(sel));
  return modal({ title: 'Кто проектирует?', body: h('label', { class: 'field' }, h('span', null, 'Исполнитель'), sel), okText,
    onOk: () => { if (!sel.value) throw new Error('Выберите исполнителя.'); return sel.value; } });
}
/** Куда перевести отмеченные задачи «В работе»: 'done' | 'paused' | 'cancelled' | null (отмена). */
function askBatchMove(n) {
  const pick = (value) => (ev) => { const form = ev.target.closest('form'); form.dataset.choice = value; form.requestSubmit(); };
  // главная кнопка окна — «Завершить»; «Не переводить» — закрыть без изменений (дизайнер 2026-11-06: не путать с «Отменить»)
  return modal({ title: `Перевести ${n} ${plural(n, 'задачу', 'задачи', 'задач')}`, okText: 'Завершить', cancelText: 'Не переводить', body: h('div', null,
    h('p', { class: 'hint' }, 'Действие применится ко всем отмеченным задачам в работе. Или выберите другое:'),
    actions(
      button({ label: 'Приостановить', onClick: pick('paused') }),
      button({ label: 'Снять с проектирования', kind: 'danger', onClick: pick('cancelled') }))),
    onOk: (form) => form.dataset.choice || 'done' });
}
/**
 * Перевести несколько задач доски разом (РУ-4): из «Распределения» — в работу, исполнитель один на всех;
 * из «В работы» — завершить, приостановить или отменить, причина одна на всех. Отмена окон ничего не меняет.
 * Журнал — по каждой задаче, как при одиночном переносе. Возвращает число переведённых (0 — отменили).
 */
export async function batchMoveTasks(rows, people) {
  const from = [...new Set(rows.map((r) => r.status))];
  if (from.length !== 1) { toast('Отметьте задачи в одном столбце', { tone: 'warn' }); return 0; }
  const was = rows.map((r) => ({ id: r.id, status: r.status, assigneeId: r.assigneeId || null, pauseReason: r.pauseReason || null }));
  const body = {};
  if (from[0] === 'queue') {
    const who = await askAssignee(await people());
    if (!who) return 0;
    Object.assign(body, { status: 'work', assigneeId: who });
  } else if (from[0] === 'work') {
    const to = await askBatchMove(rows.length);
    if (!to) return 0;
    if (to === 'done') Object.assign(body, { status: 'done' });
    else {
      const why = await askReason(to);
      if (!why) return 0;
      Object.assign(body, { status: to, pauseReason: why });
    }
  } else { toast('Пачкой — задачи из «Распределения» и «В работе»', { tone: 'warn' }); return 0; }
  let n = 0;
  for (const r of rows) { await api(`/design-tasks/${r.id}`, { method: 'PATCH', body }); n++; }
  const label = { work: 'В работе', done: 'Завершено', paused: 'Приостановлено', cancelled: 'Отменено' }[body.status];
  toast(`${label}: ${n} ${plural(n, 'задача', 'задачи', 'задач')}`, { undo: async () => {
    for (const w of was) await api(`/design-tasks/${w.id}`, { method: 'PATCH', body: {
      status: w.status,
      assigneeId: w.assigneeId,
      ...(w.status === 'paused' || w.status === 'cancelled' ? { pauseReason: w.pauseReason || 'Возврат после отмены' } : {}),
    } });
    changed();
  } });
  return n;
}

// ---------- данные: приведение ответа сервера к одному виду ----------
const idOf = (x) => String(x?.orderId ?? x?.id ?? '');
export function normOrder(o) {
  const c = o.counts || {};
  return { orderId: idOf(o), orderNo: clean(o.orderNo), productionNo: clean(o.productionNo), customer: clean(o.customer), deadline: o.deadline ?? null, priority: o.priority || 'normal', stage: o.stage || '',
    note: o.note || '', addedAt: o.addedAt || null, counts: { queue: c.queue || 0, work: c.work || 0, paused: c.paused || 0, done: c.done || 0, free: c.free ?? null }, lines: o.lines };
}
/** Позиция заказа (с задачей или без) → единый вид. */
export function normLine(l, order) {
  const t = l.task ? normTask({ matched: l.matched ?? l.task.matched ?? null, ...l.task, incomeId: l.incomeId ?? l.id, lineNo: l.seqNo ?? l.lineNo, title: l.task.title ?? l.title, productName: l.productName, sku: l.sku, photo: l.photo }, order) : null;
  return { matched: l.matched ?? null, incomeId: String(l.incomeId ?? l.id ?? ''), lineNo: l.seqNo ?? l.lineNo ?? null, title: clean(l.title) || clean(l.productName) || 'Без названия', qty: l.qty ?? null, unit: l.unit ?? null, productId: l.productId || null, sku: clean(l.sku) || null, photo: l.photo || null, task: t };
}
/** Задача (из открытых задач или вложенная в позицию) → вид, который понимают moveTask и карточка. */
export function normTask(t, order) {
  return { ...t, lineNo: t.seqNo ?? t.lineNo ?? null, id: String(t.id), status: t.status, title: clean(t.title), productName: clean(t.productName) || null, sku: clean(t.sku) || null, customerTitle: clean(t.customerTitle) || null, orderId: String(t.orderId ?? order?.orderId ?? ''), orderNo: clean(t.orderNo) || clean(order?.orderNo) || null, productionNo: clean(t.productionNo) || clean(order?.productionNo) || null,
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
  if (to === 'done' || to === 'cancelled') { toast(to === 'done' ? 'Сначала возьмите изделие в работу' : 'Отменить можно только начатую задачу', { tone: 'warn' }); return false; }
  const body = { incomeId: line.incomeId, status: to };
  if (to === 'paused') { const why = await askReason(); if (!why) return false; body.pauseReason = why; }
  if (to === 'work') { const who = await askAssignee(await people()); if (!who) return false; body.assigneeId = who; }
  const t = await api('/design-tasks', { method: 'POST', body });
  toast(to === 'work' ? 'Взято в работу' : to === 'paused' ? 'Приостановлено' : 'Отправлено на распределение', { undo: async () => { await api(`/design-tasks/${t.id}`, { method: 'DELETE' }); changed(); } });
  return true;
}

// ЗНП — № заказа (производства, productionNo); № договора (orderNo) — справка
export const orderName = (o) => (clean(o.productionNo) ? '№ ' + clean(o.productionNo) : 'Заказ, нет №');
