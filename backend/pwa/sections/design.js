import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay } from '../core/format.js';
import { current, go } from '../core/router.js';
import { badge, board as mountBoard, button, sku as kitSku, layout, section, toast, toastError, DESIGN_STATUS, ORDER_PRIORITY } from '../ui/kit/index.js';
import { designSide } from './design-side.js';
import { staffOptions } from './passports/common.js';
import { taskMenu } from './design-menu.js';
import { askAssignee, askReason, batchMoveTasks } from './design-data.js';
import { designTaskCard } from './design-card.js';
import { boardCard } from '../ui/kit/screens/blocks.js';
import { discussionBlock, questionBadge } from '../ui/design-notes.js';
import { photosBlock, stickerRow, stickersBlock, visibleStickers } from '../ui/design-stickers.js';
import { targetPicker } from '../ui/kit/target-picker.js';
import { withRequestsTab } from './design-requests.js';
import { activeOrders, orderLabel } from './salesorders.js';

/**
 * Раздел «Проектирование» (ПРЖ-5): задачи чертёжного отдела по позициям заказов.
 * Доска — эталон kit.board (колонки статусов, карточка .tcard, стикеры; вид по умолчанию) и таблица (?view=table). Данные заказов и окна — sections/design-data.js.
 * Двигает задачи менеджер (права записи — как везде); исполнитель — сотрудник из «Справочников».
 * Срок и приоритет по умолчанию берутся из заказа (серым «из заказа»), их можно заменить своими.
 */
export const STATUS = DESIGN_STATUS;
const ORDER = ['queue', 'work', 'paused', 'done', 'cancelled'];
const PRIO_OPTS = Object.entries(ORDER_PRIORITY).map(([value, p]) => ({ value, label: p.label }));
const STATUS_OPTS = ORDER.map((value) => ({ value, label: STATUS[value].label }));

// ---------- сотрудники (исполнители) ----------
export const people = async () => (await staffOptions()).filter((p) => !p.fired).map((p) => ({ value: p.value, label: p.name })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));

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
const skuSub = (sku, text) => h('span', null, kitSku(sku), sku && text ? ' · ' : null, text);
const subLine = (r, withCode = true) => [(r.seqNo ?? r.lineNo) != null && 'поз. ' + (r.seqNo ?? r.lineNo), clean(r.productionNo) && 'заказ № ' + clean(r.productionNo), withCode && r.code].filter(Boolean).join(' · ');
const pic = (r) => (r.photo ? h('img', { class: 't-pic', src: PREFIX + r.photo, alt: '', loading: 'lazy', draggable: 'false', onerror: (e) => e.target.remove() }) : null);

let stk = []; // видимые стикеры доски (грузятся один раз; пока нет — на карточке срок, приоритет, исполнитель)
const footOf = (r) => (stk.length ? stickerRow(r, stk) : h('div', { class: 't-foot' }, dueNode(r), prioBadge(r), questionBadge(r), avatar(r)));
function boardBody(r, c) {
  const sub = skuSub(clean(r.sku), (c.compact ? [c.key === 'paused' && r.pauseReason, subLine(r)] : [subLine(r)]).filter(Boolean).join(' · '));
  return boardCard({ pic: pic(r), title: title(r), sub, compact: c.compact, extra: [footOf(r)] });
}

// ---------- перенос между стадиями ----------
/** Сменить стадию. Возвращает обновлённую задачу или null (отказались в окне причины). Ошибка — как есть (покажет вызывающий). */
export async function moveTask(r, to) {
  if (r.status === to) return r;
  const body = { status: to };
  if (to === 'paused' || to === 'cancelled') { const why = await askReason(to); if (!why) return null; body.pauseReason = why; }
  if (to === 'work' && !r.assigneeId) { const who = await askAssignee(await people()); if (!who) return null; body.assigneeId = who; } // окно «Кто проектирует?» вместо ошибки
  const saved = await api(`/design-tasks/${r.id}`, { method: 'PATCH', body });
  toast(`${r.code} → ${STATUS[to].label}`, { undo: async () => {
    await api(`/design-tasks/${r.id}`, { method: 'PATCH', body: {
      status: r.status,
      assigneeId: r.assigneeId || null,
      ...(r.status === 'paused' || r.status === 'cancelled' ? { pauseReason: r.pauseReason || 'Возврат после отмены' } : {}),
    } });
    window.dispatchEvent(new CustomEvent('data-changed'));
  } });
  return saved;
}

// ---------- форма: заказ → позиция ----------
function targetWidget(v) {
  const skuBox = h('div', { class: 'tp-sku', hidden: true });
  const onLineChange = (line) => {
    const pn = line?.productName, sku = line?.sku;
    if (pn || sku) { skuBox.replaceChildren(kitSku(sku), sku && pn ? ' ' : null, pn); skuBox.hidden = false; }
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

// ---------- мультивыбор на доске (РУ-4) ----------
/** Какие столбцы доски сейчас отмечены чекбоксами: выделение живёт внутри mountBoard (kit), читаем по DOM. */
const pickedCols = () => [...document.querySelectorAll('.board .tcard.selected')].map((x) => x.closest('.col')?.dataset.key).filter(Boolean);
/** Чекбоксы в «Распределении» и «В работе»: из распределения — в работу одним исполнителем; из работы — завершить / пауза / отмена. */
const boardMulti = {
  get label() {
    const ks = [...new Set(pickedCols())];
    if (ks.length === 1 && ks[0] === 'queue') return 'Взять в работу';
    if (ks.length === 1 && ks[0] === 'work') return 'Перевести…';
    return 'Отметьте задачи в одном столбце';
  },
  run: (rows) => batchMoveTasks(rows, people),
};

export const design = {
  id: 'design',
  kind: 'Задача проектирования',
  title: 'Проектирование',
  newTitle: 'Новая задача',
  entityType: 'DesignTask',
  historyLabels: { 'designtask.created': 'Создана', 'designtask.updated': 'Изменена', 'designtask.deleted': 'Удалена', 'designtask.restored': 'Восстановлена', 'designtask.from-order': 'Создана из заказа' },
  get: (id) => api(`/design-tasks/${id}`),

  list: {
    viewKey: 'design', path: '/design-tasks',
    sortDefault: 'seq',
    createLabel: 'Задача',
    headActions: () => (session.role === 'admin' || session.user?.isOwner === true ? [button({ label: 'Настройки доски', title: 'Какие стикеры показывать на карточках', onClick: () => { const P = current().params; go('design', { ...P, of: 'designsettings', open: 'board', new: undefined }, { replace: !!P.open, kind: 'card' }); } })] : []),
    export: false,
    searchPlaceholder: 'Поиск: D-12, название, № заказа, заказчик, артикул…',
    emptyText: 'Задач проектирования пока нет.', emptyHint: 'В карточке заказа нажмите «Передать в проектирование» — задачи появятся здесь.',
    query: (P) => ({ status: P.status || 'queue,work' }),
    filters: [
      { key: 'status', label: 'Статус', type: 'chips', noAll: true, defaultValue: 'queue,work',
        options: () => [{ value: 'queue,work', label: 'Открытые' }, ...STATUS_OPTS.map((o) => ({ value: o.value, label: o.label })), { value: 'queue,work,done,paused', label: 'Без отменённых' }],
        count: (resp, v) => (v === 'queue,work' ? (resp.counts?.queue || 0) + (resp.counts?.work || 0) : v === 'queue,work,done,paused' ? resp.counts?.all : resp.counts?.[v]) },
      { key: 'needsAnswer', label: 'Вопросы', type: 'chips',
        options: () => [{ value: '1', label: 'Есть вопрос без ответа', hint: 'В задаче задан вопрос — ответьте в обсуждении карточки' }],
        count: (resp, v) => (v === '1' ? resp.counts?.needsAnswer : undefined) },
      { key: 'assigneeId', label: 'Все исполнители', type: 'select', options: () => people() },
      { key: 'orderId', label: 'Все заказы', type: 'select', options: () => activeOrders().then((os) => os.map((o) => ({ value: o.id, label: orderLabel(o) }))) },
    ],
    columns: [
      { key: 'code', label: 'Код', sort: 'seq', cls: 'nowrap', render: (r) => h('b', null, r.code) },
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => (r.photo ? h('img', { class: 'pic', src: PREFIX + r.photo, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null) },
      { key: 'title', label: 'Изделие', cls: 'clip', render: (r) => h('span', { title: title(r) }, kitSku(clean(r.sku)), r.sku ? ' ' : null, title(r), subLine(r, false) ? h('small', { class: 'muted' }, ' ' + subLine(r, false)) : null, questionBadge(r) ? ' ' : null, questionBadge(r)) },
      { key: 'due', label: 'Срок', cls: 'nowrap', render: dueNode },
      { key: 'priority', label: 'Приоритет', cls: 'nowrap md-hide', render: (r) => prioBadge(r) || '' },
      { key: 'assignee', label: 'Исполнитель', cls: 'nowrap md-hide', render: (r) => (r.assignee ? r.assignee.name : h('span', { class: 'muted' }, 'не назначен')) },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => badge(STATUS, r.status) },
    ],
    card: {
      title: (r) => `${r.code} · ${title(r)}`,
      sub: (r) => skuSub(clean(r.sku), [subLine(r, false), r.deadline ? 'срок ' + date(r.deadline) : '', r.assignee?.name].filter(Boolean).join(' · ')),
      side: (r) => [badge(STATUS, r.status), prioBadge(r), questionBadge(r)],
      thumb: (r) => (r.photo ? h('img', { class: 'thumb', src: PREFIX + r.photo, alt: '', loading: 'lazy' }) : null),
    },
    board: {
      default: true,
      mount: withRequestsTab((b, path, q, o) => {
        const inner = mountBoard(b, path, q, o);
        if (!stk.length) visibleStickers().then((l) => { if (l.length) { stk = l; inner.reload(); } });
        const side = designSide({ query: q, env: { people: b.env.people }, onBoard: () => inner.reload() });
        return {
          ...inner, el: layout.split({ side: side.el, main: inner.el, sideLabel: 'Заказы в проектировании' }),
          reload: () => { inner.reload(); side.reload(); },
          reloadFor: (row) => { inner.reloadFor?.(row); side.reload(); },
          setQuery: (qq) => { inner.setQuery(qq); side.setQuery(qq); },
        };
      }),
      env: { people },
      headCount: true,
      density: 'pics',
      groupOpen: true,
      group: (r) => (r.orderId ? { key: String(r.orderId), label: clean(r.productionNo) ? '№ ' + clean(r.productionNo) : 'Заказ, нет №', sub: clean(r.customer) } : null),
      cardMenu: (r) => taskMenu(r, { people, moveTask }),
      columns: [
        { key: 'queue', label: STATUS.queue.label, tone: 'dim', multi: boardMulti, emptyText: 'Пусто. Задачи приходят из заказов: кнопка «Передать в проектирование»', query: { status: 'queue', sort: 'seq' } },
        { key: 'work', label: STATUS.work.label, tone: 'info', multi: boardMulti, query: { status: 'work', sort: 'seq' } },
        { key: 'paused', label: STATUS.paused.label, tone: 'warn', compact: true, portion: true, per: 20, query: { status: 'paused', sort: 'seq' } },
        { key: 'done', label: STATUS.done.label, tone: 'ok', compact: true, portion: true, per: 20, query: { status: 'done', sort: '-completedAt' } },
        { key: 'cancelled', label: STATUS.cancelled.label, tone: 'dim', compact: true, portion: true, per: 20, emptyText: 'Пусто. Сюда — снятые задачи (расторжение договора и т. п.)', query: { status: 'cancelled', sort: '-createdAt' } },
      ],
      card: (r, c) => ({ body: boardBody(r, c), orderKey: r.orderId || '' }),
      move: async (r, to) => !!(await moveTask(r, to)),
      addLabel: '+ Задача',
      add: (key) => go('design', { ...current().params, new: '1', dstatus: key, open: undefined }, { replace: true }),
    },
  },

  card: designTaskCard({ title, dueNode, prioBadge, status: STATUS, moveTask, people,
    blocks: { discussionBlock, photosBlock, stickersBlock, visibleStickers } }),

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
        // у задачи с изделием заголовок — название изделия: правка своего поля на экране не была бы видна
        ...(row?.productName ? [{ key: '_name', type: 'widget', label: 'Название', wide: true, summary: () => '', widget: () => h('div', { class: 'hint' }, 'Название берётся из изделия. Изменить его можно в «Продукции»: ', row.productId ? h('a', { href: `#products?open=${row.productId}` }, clean(row.productName)) : clean(row.productName)) }] : []),
        ...(row?.productName ? [] : [{ key: 'title', label: 'Название', wide: true, max: 300, hint: row ? undefined : 'Можно оставить пустым, если выбрана позиция: «Чертежи 3410 ЗНП 20-26 поз 7».' }]),
        { key: 'assigneeId', label: 'Исполнитель', type: 'select', options: ppl },
        { key: 'status', label: 'Статус', type: 'select', required: true, options: STATUS_OPTS },
        { key: 'pauseReason', label: 'Причина (пауза / отмена)', wide: true, max: 500,
          mount: (fa) => { const sync = () => { const f = fa.field('pauseReason'); if (f) f.hidden = !['paused', 'cancelled'].includes(fa.input('status')?.value); }; fa.on('status', sync); sync(); } },
        { section: 'Срок и приоритет', tone: 'info' },
        { key: 'deadline', label: 'Срок', type: 'date', hint: 'Пусто — срок берётся из заказа.' + fromOrderDl },
        { key: 'priority', label: 'Приоритет', type: 'select', options: PRIO_OPTS, hint: '«—» — как в заказе.' + fromOrderPr },
        { section: 'Примечание', tone: 'who', collapsed: !row?.note },
        { key: 'note', label: 'Примечание', type: 'textarea', wide: true },
      ];
    },
    initial: () => ({ status: ['queue', 'work', 'done', 'paused', 'cancelled'].includes(current().params.dstatus) ? current().params.dstatus : 'queue',
      target: current().params.orderId ? { orderId: current().params.orderId, orderNo: current().params.orderNo, lineId: current().params.lineId } : undefined }),
    toInitial,
    toBody: (v, row) => {
      const needs = () => {
        if (v.status === 'work' && !v.assigneeId) throw new Error('Для статуса «В работе» выберите исполнителя.');
        if ((v.status === 'paused' || v.status === 'cancelled') && !v.pauseReason) throw new Error('Для паузы или отмены впишите причину.');
      };
      needs();
      if (!row) {
        const t = v.target || {};
        if (t.check) throw new Error(t.check);
        if (t.orderId && !t.incomeId) throw new Error('Выберите позицию заказа. Сразу все позиции — кнопка «Передать в проектирование» в карточке заказа.');
        if (!t.incomeId && !v.title) throw new Error('Впишите название задачи или выберите позицию заказа.');
        return {
          ...(t.incomeId ? { incomeId: t.incomeId } : {}), ...(v.title ? { title: v.title } : {}), ...(v.assigneeId ? { assigneeId: v.assigneeId } : {}),
          status: v.status, ...(v.status === 'paused' || v.status === 'cancelled' ? { pauseReason: v.pauseReason } : {}),
          ...(v.deadline ? { deadline: v.deadline } : {}), ...(v.priority ? { priority: v.priority } : {}), ...(v.note ? { note: v.note } : {}),
        };
      }
      // правка: уходят только изменённые поля (срок и приоритет «из заказа» случайно своими не станут)
      const was = toInitial(row), body = {};
      for (const k of [...(row.productName ? [] : ['title']), 'assigneeId', 'status', 'pauseReason', 'deadline', 'priority', 'note']) {
        if (norm(v[k]) === norm(was[k])) continue;
        body[k] = k === 'assigneeId' ? v[k] || null : norm(v[k]);
      }
      if ((body.status === 'paused' || body.status === 'cancelled') && !body.pauseReason) body.pauseReason = v.pauseReason;
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

  searchRow: (r) => ({ title: `${r.code} · ${title(r)}`, sub: [clean(r.productionNo) && 'заказ № ' + clean(r.productionNo), r.orderNo && 'договор ' + r.orderNo, r.customer].filter(Boolean).join(' · '), side: badge(STATUS, r.status) }),
  open: (id) => go('design', { open: id }),
};
