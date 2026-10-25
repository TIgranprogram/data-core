import { api, PREFIX } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay } from '../core/format.js';
import { current, go } from '../core/router.js';
import { badge, DESIGN_STATUS, ORDER_PRIORITY } from '../ui/badges.js';
import { modal } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';
import { targetPicker } from '../ui/target-picker.js';
import { activeOrders, orderLabel } from './salesorders.js';

/**
 * Раздел «Проектирование» (ПРЖ-5): задачи чертёжного отдела по позициям заказов.
 * Доска по стадиям (перенос мышью, долгим нажатием и кнопками в карточке) и таблица (?view=table).
 * Двигает задачи менеджер (права записи — как везде); исполнитель — сотрудник из «Справочников».
 * Срок и приоритет по умолчанию берутся из заказа (серым «из заказа»), их можно заменить своими.
 */
export const STATUS = DESIGN_STATUS;
const ORDER = ['queue', 'work', 'done', 'paused'];
const PRIO_OPTS = Object.entries(ORDER_PRIORITY).map(([value, p]) => ({ value, label: p.label }));
const STATUS_OPTS = ORDER.map((value) => ({ value, label: STATUS[value].label }));

// ---------- сотрудники (исполнители) ----------
let peopleP = null;
const people = () => (peopleP ||= api('/dicts/persons').then((r) => (r.items || []).filter((p) => p.status !== 'fired')
  .map((p) => ({ value: p.id, label: p.name })).sort((a, b) => a.label.localeCompare(b.label, 'ru'))).catch(() => { peopleP = null; return []; }));

// ---------- мелкие элементы ----------
const title = (r) => r.productName || r.title;
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
const avatar = (r) => (r.assignee ? h('span', { class: 'avatar sm', title: r.assignee.name }, r.assignee.initials) : null);
const subLine = (r, withCode = true) => [r.sku && '№ ' + r.sku, r.lineNo != null && 'поз. ' + r.lineNo, r.orderNo && 'ЗНП ' + r.orderNo, withCode && r.code].filter(Boolean).join(' · ');
const pic = (r) => (r.photo ? h('img', { class: 't-pic', src: PREFIX + r.photo, alt: '', loading: 'lazy', draggable: 'false', onerror: (e) => e.target.replaceWith(h('div', { class: 't-pic-none' }, 'нет фото')) }) : h('div', { class: 't-pic-none' }, 'нет фото'));

function boardBody(r, c) {
  if (c.compact) {
    return [pic(r), h('div', { class: 't-main' },
      h('div', { class: 't-title', title: title(r) }, title(r)),
      h('div', { class: 't-sub', title: r.pauseReason || '' }, (c.key === 'paused' && r.pauseReason ? r.pauseReason + ' · ' : '') + subLine(r)),
      h('div', { class: 't-foot' }, dueNode(r), prioBadge(r), avatar(r)))];
  }
  return [pic(r),
    h('div', { class: 't-title', title: title(r) }, title(r)),
    h('div', { class: 't-sub' }, subLine(r)),
    h('div', { class: 't-foot' }, dueNode(r), prioBadge(r), avatar(r))];
}

// ---------- перенос между стадиями ----------
const askReason = () => {
  const inp = h('input', { maxlength: 500, placeholder: 'Например: ждём размеры от заказчика', 'aria-label': 'Причина паузы' });
  return modal({ title: 'Приостановить задачу', body: h('label', { class: 'field' }, h('span', null, 'Причина паузы'), inp), okText: 'Приостановить',
    onOk: () => { const v = inp.value.trim(); if (!v) throw new Error('Впишите причину паузы.'); return v; } });
};
/** Сменить стадию. Возвращает обновлённую задачу или null (отказались в окне причины). Ошибка — как есть (покажет вызывающий). */
export async function moveTask(r, to) {
  if (r.status === to) return r;
  const body = { status: to };
  if (to === 'paused') { const why = await askReason(); if (!why) return null; body.pauseReason = why; }
  if (to === 'work' && !r.assigneeId) throw new Error('Сначала назначьте исполнителя: откройте задачу → «Изменить» → «Исполнитель».');
  const saved = await api(`/design-tasks/${r.id}`, { method: 'PATCH', body });
  toast(`${r.code} → ${STATUS[to].label}`, { undo: async () => {
    await api(`/design-tasks/${r.id}`, { method: 'PATCH', body: { status: r.status, ...(r.status === 'paused' ? { pauseReason: r.pauseReason || 'Возврат после отмены' } : {}) } });
    window.dispatchEvent(new CustomEvent('data-changed'));
  } });
  return saved;
}

// ---------- форма: заказ → позиция ----------
function targetWidget(v) {
  const tp = targetPicker({ mode: 'reserve' });
  if (v?.orderId && v.lineId) tp.preset({ id: v.orderId, label: v.orderNo ? '№ ' + v.orderNo : 'Заказ', orderNo: v.orderNo }, v.lineId);
  return {
    el: tp.el,
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
    emptyText: 'Задач проектирования пока нет. В карточке заказа есть кнопка «Передать в проектирование».',
    query: (P) => ({ status: P.status || 'queue,work' }),
    filters: [
      { key: 'status', label: 'Стадия', type: 'chips', noAll: true, defaultValue: 'queue,work',
        options: () => [{ value: 'queue,work', label: 'Открытые' }, ...STATUS_OPTS.map((o) => ({ value: o.value, label: o.label })), { value: 'queue,work,done,paused', label: 'Все' }],
        count: (resp, v) => (v === 'queue,work' ? (resp.counts?.queue || 0) + (resp.counts?.work || 0) : v === 'queue,work,done,paused' ? resp.counts?.all : resp.counts?.[v]) },
      { key: 'assigneeId', label: 'Все исполнители', type: 'select', options: () => people() },
      { key: 'orderId', label: 'Все заказы', type: 'select', options: () => activeOrders().then((os) => os.map((o) => ({ value: o.id, label: orderLabel(o) }))) },
    ],
    columns: [
      { key: 'code', label: 'Код', sort: 'seq', cls: 'nowrap', render: (r) => h('b', null, r.code) },
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => (r.photo ? h('img', { class: 'pic', src: PREFIX + r.photo, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null) },
      { key: 'title', label: 'Что проектируем', cls: 'clip', render: (r) => h('span', { title: title(r) }, title(r), h('small', { class: 'muted' }, ' ' + subLine(r, false))) },
      { key: 'due', label: 'Срок', cls: 'nowrap', render: dueNode },
      { key: 'priority', label: 'Приоритет', cls: 'nowrap md-hide', render: (r) => prioBadge(r) || '' },
      { key: 'assignee', label: 'Исполнитель', cls: 'nowrap md-hide', render: (r) => (r.assignee ? r.assignee.name : h('span', { class: 'muted' }, 'не назначен')) },
      { key: 'status', label: 'Стадия', cls: 'nowrap', render: (r) => badge(STATUS, r.status) },
    ],
    card: {
      title: (r) => `${r.code} · ${title(r)}`,
      sub: (r) => [subLine(r, false), r.deadline ? 'срок ' + date(r.deadline) : '', r.assignee?.name].filter(Boolean).join(' · '),
      side: (r) => [badge(STATUS, r.status), prioBadge(r)],
      thumb: (r) => (r.photo ? h('img', { class: 'thumb', src: PREFIX + r.photo, alt: '', loading: 'lazy' }) : null),
    },
    board: {
      default: true,
      headCount: true,
      cls: 'board-pics',
      columns: [
        { key: 'queue', label: STATUS.queue.label, tone: 'dim', query: { status: 'queue', sort: 'seq' } },
        { key: 'work', label: STATUS.work.label, tone: 'info', query: { status: 'work', sort: 'seq' } },
        { key: 'done', label: STATUS.done.label, tone: 'ok', compact: true, portion: true, per: 20, query: { status: 'done', sort: '-completedAt' } },
        { key: 'paused', label: STATUS.paused.label, tone: 'warn', compact: true, portion: true, per: 20, query: { status: 'paused', sort: 'seq' } },
      ],
      card: (r, c) => ({ body: boardBody(r, c) }),
      move: async (r, to) => !!(await moveTask(r, to)),
      addLabel: '+ Добавить задачу',
      add: (key) => go('design', { ...current().params, new: '1', dstatus: key, open: undefined }, { replace: true }),
    },
  },

  card: {
    heading: (r) => `${r.code} · ${title(r)}`,
    subheading: (r) => STATUS[r.status]?.label || '',
    gallery: (r) => (r.photo ? [{ id: 'p', url: r.photo, thumb: r.photo }] : []),
    stats: (r) => [['Стадия', STATUS[r.status]?.label || r.status], ['Приоритет', ORDER_PRIORITY[r.priority]?.label || r.priority], ['Срок', r.deadline ? date(r.deadline) : '—']],
    view: (r) => [
      ['Заказ', r.orderId ? h('a', { href: '#salesorders?open=' + r.orderId }, 'ЗНП ' + (r.orderNo || '—')) : null],
      ['Позиция', [r.lineNo != null && 'поз. ' + r.lineNo, r.customerTitle].filter(Boolean).join(' · ')],
      ['Изделие', [r.sku && '№ ' + r.sku, r.productName].filter(Boolean).join(' · ')],
      ['Название', r.title],
      ['Исполнитель', r.assignee ? r.assignee.name : h('span', { class: 'muted' }, 'не назначен')],
      ['Срок', r.deadline ? h('span', null, dueNode(r), r.deadlineFromOrder ? h('span', { class: 'muted' }, ' · из заказа') : null) : ''],
      ['Приоритет', h('span', null, ORDER_PRIORITY[r.priority]?.label || r.priority, r.priorityFromOrder ? h('span', { class: 'muted' }, ' · из заказа') : null)],
      ['Причина паузы', r.pauseReason],
      ['Примечание', r.note],
      ['Завершена', r.completedAt ? date(r.completedAt) : ''],
    ],
    actions: (r) => {
      const go2 = (to, label, primary) => ({ label, primary, run: async (row, ctx) => { const saved = await moveTask(row, to); if (saved) ctx.setRow(saved); } });
      if (r.status === 'queue') return [go2('work', 'Взять в работу', true), go2('paused', 'Приостановить')];
      if (r.status === 'work') return [go2('done', 'Завершить', true), go2('paused', 'Приостановить'), go2('queue', 'Вернуть на распределение')];
      if (r.status === 'paused') return [go2(r.assigneeId ? 'work' : 'queue', r.assigneeId ? 'Возобновить' : 'Вернуть на распределение', true), go2('done', 'Завершить')];
      return [go2('work', 'Вернуть в работу')];
    },
  },

  form: {
    fields: async (row) => {
      const ppl = await people();
      const fromOrderDl = row?.deadlineFromOrder && row.deadline ? ` Сейчас — из заказа: ${date(row.deadline)}.` : '';
      const fromOrderPr = row?.priorityFromOrder ? ` Сейчас — из заказа: ${ORDER_PRIORITY[row.priority]?.label.toLowerCase()}.` : '';
      return [
        ...(!row ? [
          { section: 'Позиция заказа', tone: 'main', fixed: true },
          { key: 'target', type: 'widget', label: '', wide: true, widget: targetWidget, summary: () => '' },
          { note: 'Название, фото, срок и приоритет возьмутся из позиции и заказа. Задача без заказа — впишите название ниже.' },
        ] : []),
        { section: 'Задача', tone: row ? 'main' : 'info', fixed: true },
        { key: 'title', label: 'Название', wide: true, max: 300, hint: row ? undefined : 'Можно оставить пустым, если выбрана позиция: «Чертежи 3410 ЗНП 20-26 поз 7».' },
        { key: 'assigneeId', label: 'Исполнитель', type: 'select', options: ppl },
        { key: 'status', label: 'Стадия', type: 'select', required: true, options: STATUS_OPTS },
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
        if (v.status === 'work' && !v.assigneeId) throw new Error('Для стадии «В работе» выберите исполнителя.');
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

  open: (id) => go('design', { open: id }),
};
