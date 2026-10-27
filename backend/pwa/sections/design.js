import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay } from '../core/format.js';
import { current, go } from '../core/router.js';
import { badge, DESIGN_STATUS, ORDER_PRIORITY } from '../ui/badges.js';
import { mountBoard } from '../ui/board.js';
import { askAssignee, askReason, mountDesignBoard } from '../ui/design-board.js';
import { carousel } from '../ui/gallery.js';
import { discussionBlock, questionBadge } from '../ui/design-notes.js';
import { photosBlock, stickersBlock, visibleStickers } from '../ui/design-stickers.js';
import { toast, toastError } from '../ui/toast.js';
import { targetPicker } from '../ui/target-picker.js';
import { activeOrders, orderLabel, STAGE } from './salesorders.js';

/**
 * Раздел «Проектирование» (ПРЖ-5): задачи чертёжного отдела по позициям заказов.
 * Доска заказов (ui/design-board.js: заказы слева, статусы справа; вид по умолчанию), таблица (?view=table) и прежняя плоская доска (?view=flat, запасной путь).
 * Двигает задачи менеджер (права записи — как везде); исполнитель — сотрудник из «Справочников».
 * Срок и приоритет по умолчанию берутся из заказа (серым «из заказа»), их можно заменить своими.
 */
export const STATUS = DESIGN_STATUS;
const ORDER = ['queue', 'work', 'paused', 'done'];
const PRIO_OPTS = Object.entries(ORDER_PRIORITY).map(([value, p]) => ({ value, label: p.label }));
const STATUS_OPTS = ORDER.map((value) => ({ value, label: STATUS[value].label }));

// ---------- сотрудники (исполнители) ----------
let peopleP = null;
export const people = () => (peopleP ||= api('/dicts/persons').then((r) => (r.items || []).filter((p) => p.status !== 'fired')
  .map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label, 'ru'))).catch(() => { peopleP = null; return []; }));

// ---------- мелкие элементы ----------
const clean = (v) => { const s = v === null || v === undefined ? '' : String(v).trim(); return s === 'null' || s === 'undefined' ? '' : s; };
const title = (r) => clean(r.productName) || clean(r.title) || 'Без названия';
const dayDiff = (d) => Math.round((new Date(String(d).slice(0, 10)) - new Date(isoDay())) / 864e5);
/** Срок: просрочен — красный и «просрочено N дн.» текстом, ≤ 2 дней — золото, у завершённых серый. */
export function dueNode(r) {
  if (!r.deadline) return h('span', { class: 'due none' }, 'без срока');
  const d = dayDiff(r.deadline);
  const closed = r.status === 'done';
  const cls = closed ? 'done' : d < 0 ? 'over' : d <= 2 ? 'soon' : '';
  const text = closed || d > 2 ? date(r.deadline) : d < 0 ? `${date(r.deadline)} · просрочено ${-d} дн.` : d === 0 ? `${date(r.deadline)} · сегодня` : `${date(r.deadline)} · ещё ${d} дн.`;
  return h('span', { class: 'due ' + cls, title: r.deadlineFromOrder ? 'Срок взят из заказа' : 'Свой срок задачи' }, text);
}
const prioBadge = (r) => (r.priority && r.priority !== 'normal' ? badge(ORDER_PRIORITY, r.priority) : null);
const avatar = (r) => (r.assignee ? h('span', { class: 'avatar sm', title: r.assignee.name, 'aria-label': 'Исполнитель: ' + r.assignee.name }, r.assignee.initials) : h('span', { class: 't-none' }, 'не назначен'));
const subLine = (r, withCode = true) => [clean(r.sku) && '№ ' + clean(r.sku), r.lineNo != null && 'поз. ' + r.lineNo, clean(r.orderNo) && 'ЗНП ' + clean(r.orderNo), withCode && r.code].filter(Boolean).join(' · ');
const pic = (r) => (r.photo ? h('img', { class: 't-pic', src: PREFIX + r.photo, alt: '', loading: 'lazy', draggable: 'false', onerror: (e) => e.target.replaceWith(h('div', { class: 't-pic-none' }, 'нет фото')) }) : h('div', { class: 't-pic-none' }, 'нет фото'));

function boardBody(r, c) {
  if (c.compact) {
    return [pic(r), h('div', { class: 't-main' },
      h('div', { class: 't-title', title: title(r) }, title(r)),
      h('div', { class: 't-sub', title: r.pauseReason || '' }, [c.key === 'paused' && r.pauseReason, subLine(r)].filter(Boolean).join(' · ')),
      h('div', { class: 't-foot' }, dueNode(r), prioBadge(r), questionBadge(r), avatar(r)))];
  }
  return [pic(r),
    h('div', { class: 't-title', title: title(r) }, title(r)),
    h('div', { class: 't-sub' }, subLine(r)),
    h('div', { class: 't-foot' }, dueNode(r), prioBadge(r), questionBadge(r), avatar(r))];
}

// ---------- перенос между стадиями ----------
/** Сменить стадию. Возвращает обновлённую задачу или null (отказались в окне причины). Ошибка — как есть (покажет вызывающий). */
export async function moveTask(r, to) {
  if (r.status === to) return r;
  const body = { status: to };
  if (to === 'paused') { const why = await askReason(); if (!why) return null; body.pauseReason = why; }
  if (to === 'work' && !r.assigneeId) { const who = await askAssignee(await people()); if (!who) return null; body.assigneeId = who; } // окно «Кто проектирует?» вместо ошибки
  const saved = await api(`/design-tasks/${r.id}`, { method: 'PATCH', body });
  toast(`${r.code} → ${STATUS[to].label}`, { undo: async () => {
    await api(`/design-tasks/${r.id}`, { method: 'PATCH', body: { status: r.status, ...(r.status === 'paused' ? { pauseReason: r.pauseReason || 'Возврат после отмены' } : {}) } });
    window.dispatchEvent(new CustomEvent('data-changed'));
  } });
  return saved;
}

// ---------- форма: заказ → позиция ----------
function targetWidget(v) {
  const skuBox = h('div', { class: 'tp-sku', hidden: true });
  const onLineChange = (line) => {
    const pn = line?.productName, sku = line?.sku;
    if (pn || sku) { skuBox.textContent = [sku && '№ ' + sku, pn].filter(Boolean).join(' · '); skuBox.hidden = false; }
    else skuBox.hidden = true;
  };
  const tp = targetPicker({ mode: 'reserve', onChange: onLineChange });
  if (v?.orderId && v.lineId) tp.preset({ id: v.orderId, label: v.orderNo ? '№ ' + v.orderNo : 'Заказ', orderNo: v.orderNo }, v.lineId);
  const wrap = h('div', null, tp.el, skuBox);
  return {
    el: wrap,
    get value() { return JSON.stringify({ orderId: tp.orderId(), incomeId: tp.line()?.id || null, check: tp.check() }); },
    set value(_) { /* только ввод */ },
    focus: () => tp.el.querySelector('input')?.focus(),
  };
}

const norm = (x) => (x === null || x === undefined ? '' : String(x));
const toInitial = (r) => ({
  title: r.title || '', assigneeId: r.assigneeId || '', status: r.status, pauseReason: r.pauseReason || '', note: r.note || '',
  deadline: r.deadlineFromOrder || !r.deadline ? '' : String(r.deadline).slice(0, 10),
  priority: r.priorityFromOrder || r.priority === 'normal' ? '' : r.priority,
});

// ---------- карточка: шапка, сводка, галерея ----------
const pair = (k, v, cls) => (v === null || v === undefined || v === '' ? [] : [h('dt', { class: cls }, k), h('dd', { class: cls }, v)]);
/** Фото для карусели: свои фото задачи (в т. ч. из сообщений), иначе фото изделия; без дублей. */
export function taskPics(r) {
  const seen = new Set();
  const out = [];
  for (const p of r.photos || []) if (p.url && !seen.has(p.url)) { seen.add(p.url); out.push(p); }
  if (!out.length && r.photo) out.push({ url: r.photo, thumb: r.photo });
  return out;
}
function topBlock(r, ctx) {
  const can = session.canEdit;
  const znp = clean(r.productionNo) || clean(r.orderNo);
  const znpText = [znp, r.lineNo != null ? String(r.lineNo) : ''].filter(Boolean).join(' / ');
  const assign = async () => {
    const who = await askAssignee(await people(), { okText: 'Назначить' });
    if (!who) return;
    try { ctx.setRow(await api('/design-tasks/' + r.id, { method: 'PATCH', body: { assigneeId: who } })); } catch (e) { toastError(e, 'назначить исполнителя'); }
  };
  const who = r.assignee
    ? h(can ? 'button' : 'span', { class: 'dc-who', type: can ? 'button' : undefined, onclick: can ? assign : undefined }, h('span', { class: 'avatar sm', title: r.assignee.name, 'aria-label': 'Исполнитель: ' + r.assignee.name }, r.assignee.initials), ' ' + r.assignee.name)
    : h(can ? 'button' : 'span', { class: 'dc-who t-none', type: can ? 'button' : undefined, onclick: can ? assign : undefined }, 'не назначен');
  const qty = r.qty ?? r.spec?.qty ?? null;
  const unit = clean(r.unit) || clean(r.spec?.unit) || 'шт';
  const ask = async (e) => {
    const b = e.currentTarget; b.classList.add('is-busy'); b.disabled = true;
    try { await api(`/design-tasks/${r.id}/notes`, { method: 'POST', body: { text: 'Уточните, пожалуйста, сколько изделий нужно изготовить.', kind: 'question' } }); toast('Вопрос менеджеру отправлен'); b.textContent = 'Вопрос отправлен'; b.classList.remove('is-busy'); }
    catch (err) { toastError(err, 'отправить вопрос'); b.classList.remove('is-busy'); b.disabled = false; }
  };
  const made = qty ? h('span', { class: 'kv-qty' }, `${qty} ${unit}`)
    : h('span', { class: 'kv-warn' }, 'не указано ', can ? h('button', { type: 'button', class: 'link-btn', onclick: ask }, 'Уточнить у менеджера') : null);
  const grid = h('dl', { class: 'kv-grid' },
    ...pair('Изготовить', made, 'kv-full'),
    ...pair('Арт.', clean(r.sku)),
    ...pair('ЗНП / поз.', znpText ? (r.orderId ? h('a', { class: 'ref-orders', href: '#salesorders?open=' + r.orderId }, znpText) : znpText) : ''),
    ...pair('Заказчик', clean(r.customerTitle), 'kv-full'),
    ...pair('Срок', h('span', null, dueNode(r), r.deadline && r.deadlineFromOrder ? h('span', { class: 'muted' }, ' · из заказа') : null)),
    ...pair('Исполнитель', who));
  const gal = carousel(taskPics(r), { onAdd: can ? () => {
    const d = document.querySelector('.dc-photos'); if (!d) return;
    d.open = true; d.scrollIntoView({ block: 'center', behavior: 'smooth' });
  } : null });
  return h('div', { class: 'dc-top' },
    h('div', { class: 'dc-chips' }, badge(STATUS, r.status), prioBadge(r)),
    r.status === 'paused' && r.pauseReason ? h('div', { class: 'dc-pause' }, 'Пауза: ' + r.pauseReason) : null,
    grid, gal.el);
}
/** «Изделие» из разбора ЗНП: пустые поля скрыты, нет ни одного — блока нет. Исходный текст — свёрнуто. */
function specBlock(r) {
  const sp = r.spec;
  if (!sp) return null;
  const kids = [['Габариты', clean(sp.size)], ['Крепление', clean(sp.mount)], ['Покрытие', clean(sp.cover)], ['RAL', clean(sp.ral)], ['Доп.', clean(sp.extra)]].flatMap(([k, v]) => pair(k, v));
  const raw = clean(sp.raw);
  if (!kids.length && !raw) return null;
  return h('section', { class: 'dc-prod' }, h('h3', null, 'Изделие'),
    kids.length ? h('dl', { class: 'kv-grid' }, ...kids) : null,
    raw ? h('details', { class: 'dc-raw' }, h('summary', null, 'Исходный текст ЗНП'), h('div', { class: 'dc-note' }, raw)) : null);
}
function noteBlock(text) {
  const p = h('div', { class: 'dc-note clip3' }, text);
  const btn = h('button', { type: 'button', class: 'link-btn', onclick: () => { const on = p.classList.toggle('clip3'); btn.textContent = on ? 'Показать' : 'Свернуть'; } }, 'Показать');
  return h('details', { class: 'db-blk' }, h('summary', null, 'Примечание'), h('div', { class: 'db-blk-body' }, p, btn));
}

export const design = {
  id: 'design',
  title: 'Проектирование',
  newTitle: 'Новая задача',
  entityType: 'DesignTask',
  historyLabels: { 'designtask.created': 'Создана', 'designtask.updated': 'Изменена', 'designtask.deleted': 'Удалена', 'designtask.restored': 'Восстановлена', 'designtask.from-order': 'Создана из заказа' },
  get: (id) => api(`/design-tasks/${id}`),

  list: {
    path: '/design-tasks',
    sortDefault: 'seq',
    createLabel: 'Задача',
    export: false,
    searchPlaceholder: 'Поиск: D-12, название, № заказа, заказчик, артикул…',
    emptyText: 'Задач проектирования пока нет. Добавьте заказ на доске или нажмите «Передать в проектирование» в карточке заказа.',
    query: (P) => ({ status: P.status || 'queue,work' }),
    filters: [
      { key: 'status', label: 'Статус', type: 'chips', noAll: true, defaultValue: 'queue,work',
        options: () => [{ value: 'queue,work', label: 'Открытые' }, ...STATUS_OPTS.map((o) => ({ value: o.value, label: o.label })), { value: 'queue,work,done,paused', label: 'Все' }],
        count: (resp, v) => (v === 'queue,work' ? (resp.counts?.queue || 0) + (resp.counts?.work || 0) : v === 'queue,work,done,paused' ? resp.counts?.all : resp.counts?.[v]) },
      { key: 'needsAnswer', label: 'Вопросы', type: 'chips', options: () => [{ value: '1', label: 'Требует ответа' }] },
      { key: 'assigneeId', label: 'Все исполнители', type: 'select', options: () => people() },
      { key: 'orderId', label: 'Все заказы', type: 'select', options: () => activeOrders().then((os) => os.map((o) => ({ value: o.id, label: orderLabel(o) }))) },
    ],
    columns: [
      { key: 'code', label: 'Код', sort: 'seq', cls: 'nowrap', render: (r) => h('b', null, r.code) },
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => (r.photo ? h('img', { class: 'pic', src: PREFIX + r.photo, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null) },
      { key: 'title', label: 'Изделие', cls: 'clip', render: (r) => h('span', { title: title(r) }, title(r), subLine(r, false) ? h('small', { class: 'muted' }, ' ' + subLine(r, false)) : null, questionBadge(r) ? ' ' : null, questionBadge(r)) },
      { key: 'due', label: 'Срок', cls: 'nowrap', render: dueNode },
      { key: 'priority', label: 'Приоритет', cls: 'nowrap md-hide', render: (r) => prioBadge(r) || '' },
      { key: 'assignee', label: 'Исполнитель', cls: 'nowrap md-hide', render: (r) => (r.assignee ? r.assignee.name : h('span', { class: 'muted' }, 'не назначен')) },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => badge(STATUS, r.status) },
    ],
    card: {
      title: (r) => `${r.code} · ${title(r)}`,
      sub: (r) => [subLine(r, false), r.deadline ? 'срок ' + date(r.deadline) : '', r.assignee?.name].filter(Boolean).join(' · '),
      side: (r) => [badge(STATUS, r.status), prioBadge(r), questionBadge(r)],
      thumb: (r) => (r.photo ? h('img', { class: 'thumb', src: PREFIX + r.photo, alt: '', loading: 'lazy' }) : null),
    },
    board: {
      default: true,
      alt: 'flat', // ?view=flat — прежняя плоская доска (запасной путь на время приёмки)
      mount: (b, path, q, o) => (current().params.view === 'flat' ? mountBoard : mountDesignBoard)(b, path, q, o),
      env: { people, moveTask: (r, to) => moveTask(r, to), dueNode, activeOrders, stageLabel: (s) => STAGE[s]?.label || s },
      headCount: true,
      cls: 'board-pics',
      columns: [
        { key: 'queue', label: STATUS.queue.label, tone: 'dim', emptyText: 'Пусто. Задачи приходят из заказов: кнопка «Передать в проектирование»', query: { status: 'queue', sort: 'seq' } },
        { key: 'work', label: STATUS.work.label, tone: 'info', query: { status: 'work', sort: 'seq' } },
        { key: 'paused', label: STATUS.paused.label, tone: 'warn', compact: true, portion: true, per: 20, query: { status: 'paused', sort: 'seq' } },
        { key: 'done', label: STATUS.done.label, tone: 'ok', compact: true, portion: true, per: 20, query: { status: 'done', sort: '-completedAt' } },
      ],
      card: (r, c) => ({ body: boardBody(r, c) }),
      move: async (r, to) => !!(await moveTask(r, to)),
      addLabel: '+ Добавить задачу',
      add: (key) => go('design', { ...current().params, new: '1', dstatus: key, open: undefined }, { replace: true }),
    },
  },

  card: {
    heading: (r) => `${r.code} · ${title(r)}`,
    subheading: () => '',
    gallery: () => [],
    top: (r, ctx) => topBlock(r, ctx),
    view: () => [],
    extra: (r, ctx) => {
      const host = h('div', { class: 'db-blocks' });
      const can = session.canEdit;
      const prod = specBlock(r);
      if (prod) host.append(prod);
      host.append(discussionBlock(r, ctx, () => { const i = Math.max(0, taskPics(r).findIndex((p) => p.source === 'note')); (document.querySelectorAll('.pgal-th:not(.pgal-add)')[i] || document.querySelector('.pgal-img'))?.click(); document.querySelector('.pgal')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); }));
      const ph = photosBlock(r, ctx, can);
      ph.classList.add('dc-photos');
      ph.open = false;
      host.append(ph);
      if (r.note) host.append(noteBlock(r.note));
      visibleStickers().then((list) => { const b = stickersBlock(r, list, ctx, can); if (b) host.append(b); });
      return host;
    },
    actions: (r) => {
      const go2 = (to, label, primary, more) => ({ label, primary, more, run: async (row, ctx) => { const saved = await moveTask(row, to); if (saved) ctx.setRow(saved); } });
      if (r.status === 'queue') return [go2('work', 'Взять в работу', true), go2('paused', 'Приостановить', false, true)];
      if (r.status === 'work') return [go2('done', 'Завершить', true), go2('paused', 'Приостановить', false, true), go2('queue', 'Вернуть на распределение', false, true)];
      if (r.status === 'paused') return [go2(r.assigneeId ? 'work' : 'queue', r.assigneeId ? 'Возобновить' : 'Вернуть на распределение', true), go2('done', 'Завершить')];
      return [go2('work', 'Вернуть в работу')];
    },
  },

  form: {
    fields: async (row) => {
      const ppl = await people();
      const fromOrderDl = row?.deadlineFromOrder && row.deadline ? ` Сейчас — из заказа: ${date(row.deadline)}.` : '';
      const fromOrderPr = row?.priorityFromOrder ? ` Сейчас — из заказа: ${(ORDER_PRIORITY[row.priority]?.label || '').toLowerCase()}.` : '';
      return [
        ...(!row ? [
          { section: 'Позиция заказа', tone: 'main', fixed: true },
          { key: 'target', type: 'widget', label: '', wide: true, widget: targetWidget, summary: () => '' },
          { note: 'Название, фото, срок и приоритет возьмутся из позиции и заказа. Задача без заказа — впишите название ниже.' },
        ] : []),
        { section: 'Задача', tone: row ? 'main' : 'info', fixed: true },
        { key: 'title', label: 'Название', wide: true, max: 300, hint: row ? undefined : 'Можно оставить пустым, если выбрана позиция: «Чертежи 3410 ЗНП 20-26 поз 7».' },
        { key: 'assigneeId', label: 'Исполнитель', type: 'select', options: ppl },
        { key: 'status', label: 'Статус', type: 'select', required: true, options: STATUS_OPTS },
        { key: 'pauseReason', label: 'Причина паузы', wide: true, max: 500,
          mount: (fa) => { const sync = () => { const f = fa.field('pauseReason'); if (f) f.hidden = fa.input('status')?.value !== 'paused'; }; fa.on('status', sync); sync(); } },
        { section: 'Срок и приоритет', tone: 'info' },
        { key: 'deadline', label: 'Срок', type: 'date', hint: 'Пусто — срок берётся из заказа.' + fromOrderDl },
        { key: 'priority', label: 'Приоритет', type: 'select', options: PRIO_OPTS, hint: '«—» — как в заказе.' + fromOrderPr },
        { section: 'Примечание', tone: 'who', collapsed: !row?.note },
        { key: 'note', label: 'Примечание', type: 'textarea', wide: true },
      ];
    },
    initial: () => ({ status: ['queue', 'work', 'done', 'paused'].includes(current().params.dstatus) ? current().params.dstatus : 'queue',
      target: current().params.orderId ? { orderId: current().params.orderId, orderNo: current().params.orderNo, lineId: current().params.lineId } : undefined }),
    toInitial,
    toBody: (v, row) => {
      const needs = () => {
        if (v.status === 'work' && !v.assigneeId) throw new Error('Для статуса «В работе» выберите исполнителя.');
        if (v.status === 'paused' && !v.pauseReason) throw new Error('Для паузы впишите причину.');
      };
      needs();
      if (!row) {
        const t = v.target || {};
        if (t.check) throw new Error(t.check);
        if (t.orderId && !t.incomeId) throw new Error('Выберите позицию заказа. Сразу все позиции — кнопка «Передать в проектирование» в карточке заказа.');
        if (!t.incomeId && !v.title) throw new Error('Впишите название задачи или выберите позицию заказа.');
        return {
          ...(t.incomeId ? { incomeId: t.incomeId } : {}), ...(v.title ? { title: v.title } : {}), ...(v.assigneeId ? { assigneeId: v.assigneeId } : {}),
          status: v.status, ...(v.status === 'paused' ? { pauseReason: v.pauseReason } : {}),
          ...(v.deadline ? { deadline: v.deadline } : {}), ...(v.priority ? { priority: v.priority } : {}), ...(v.note ? { note: v.note } : {}),
        };
      }
      // правка: уходят только изменённые поля (срок и приоритет «из заказа» случайно своими не станут)
      const was = toInitial(row), body = {};
      for (const k of ['title', 'assigneeId', 'status', 'pauseReason', 'deadline', 'priority', 'note']) {
        if (norm(v[k]) === norm(was[k])) continue;
        body[k] = k === 'assigneeId' ? v[k] || null : norm(v[k]);
      }
      if (body.status === 'paused' && !body.pauseReason) body.pauseReason = v.pauseReason;
      return body;
    },
    create: (body) => api('/design-tasks', { method: 'POST', body }),
    update: (id, body) => api(`/design-tasks/${id}`, { method: 'PATCH', body }),
  },

  remove: {
    text: (r) => `Удалить задачу ${r.code} «${title(r)}»?`,
    run: (r) => api(`/design-tasks/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/design-tasks/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: `${r.code} · ${title(r)}`, sub: [r.orderNo && 'заказ ' + r.orderNo, r.customer].filter(Boolean).join(' · '), side: badge(STATUS, r.status) }),
  open: (id) => go('design', { open: id }),
};
