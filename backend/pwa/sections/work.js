import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { badge, ORDER_PRIORITY } from '../ui/kit/badges.js';
import { mountBoard } from '../ui/board.js';
import { mountScheduleView } from './work-schedule.js';
import { failBlock } from '../ui/kit/busy.js';
import { boardCard } from '../ui/kit/screens/blocks.js';
import { toast } from '../ui/kit/toast.js';
import { workCard } from './work-card.js';
import { activeOrders, orderLabel } from './salesorders.js';
export { workPlan } from './work-composition.js'; // панель «Позиция заказа» (of=workplan)
export { workLaunch } from './work-launch.js'; // панель «Запуск в работу» (of=worklaunch)

/**
 * Раздел «В работе»: карточки изделий едут по доске слева направо — «Ждёт запуска» → виды работ из маршрута изделия → «Готово».
 * Карточку создаёт «Запустить в работу» в заказе (sections/order-work.js); маршрут задаётся в изделии («Маршрут изготовления», sections/work-route.js).
 * Колонки зависят от данных (какие виды работ есть в маршрутах) — их отдаёт сервер (`columns`), доска строится по ним.
 * Двигать, назначать, отменять — admin / manager (session.canEdit); остальные смотрят.
 */
export const STATUS = {
  waiting: { label: 'Ждёт запуска', tone: 'dim' }, work: { label: 'В работе', tone: 'info' },
  done: { label: 'Готово', tone: 'ok' }, cancelled: { label: 'Отменена', tone: 'dim' },
};
const clean = (v) => { const s = v === null || v === undefined ? '' : String(v).trim(); return s === 'null' || s === 'undefined' ? '' : s; };
const dayDiff = (d) => Math.round((new Date(String(d).slice(0, 10)) - new Date(isoDay())) / 864e5);

// ---------- мелкие элементы ----------
/** Срок из заказа: просрочен — красный и «просрочено N дн.» текстом, ≤ 2 дней — золото, у готовых серый. */
export function dueNode(r) {
  if (!r.deadline) return h('span', { class: 'due none' }, 'без срока');
  const d = dayDiff(r.deadline);
  const closed = r.status === 'done' || r.status === 'cancelled';
  const cls = closed ? 'done' : d < 0 ? 'over' : d <= 2 ? 'soon' : '';
  const text = closed || d > 2 ? date(r.deadline) : d < 0 ? `${date(r.deadline)} · просрочено ${-d} дн.` : d === 0 ? `${date(r.deadline)} · сегодня` : `${date(r.deadline)} · ещё ${d} дн.`;
  return h('span', { class: 'due ' + cls, title: 'Срок взят из заказа' }, text);
}
const prioBadge = (r) => (r.priority && r.priority !== 'normal' ? badge(ORDER_PRIORITY, r.priority) : null);
const avatar = (r) => (r.assignee ? h('span', { class: 'avatar sm', title: r.assignee.name, 'aria-label': 'Исполнитель: ' + r.assignee.name }, r.assignee.initials) : h('span', { class: 't-none' }, 'Без исполнителя'));
const pic = (r) => (r.photo ? h('img', { class: 't-pic', src: PREFIX + r.photo, alt: '', loading: 'lazy', draggable: 'false', onerror: (e) => e.target.remove() }) : null);
/** Точки маршрута: сделано / сейчас / впереди. */
export function dots(r) {
  const route = r.route || [];
  return h('span', { class: 'wk-dots', title: route.length ? route.map((s) => s.name).join(' → ') : 'Маршрут не задан' },
    // waiting: пустые точки (не «next»), чтобы не казалось, что шаг уже впереди по маршруту
    ...route.map((s) => h('i', { class: 'wk-dot' + (r.status === 'done' ? ' done' : r.status === 'waiting' ? '' : ' ' + s.state), title: s.name })));
}
/** Где сейчас карточка словами. */
export const stepText = (r) => (r.status === 'waiting' ? 'Ждёт запуска' : r.status === 'done' ? 'Готово' : r.status === 'cancelled' ? 'Отменена' : r.currentStep || 'В работе');
const colKey = (r) => (r.status === 'waiting' ? 'waiting' : r.status === 'done' ? 'done' : r.stepKey);
const subLine = (r) => [clean(r.customer), clean(r.productionNo) && 'заказ № ' + clean(r.productionNo), r.qty ? `${qty(r.qty)} ${clean(r.unit) || 'шт'}` : ''].filter(Boolean).join(' · ');

// ---------- люди ----------
let peopleP = null;
const people = () => (peopleP ||= api('/work-tasks/people').then((r) => (r.items || []).map((p) => ({ value: p.id, label: p.name }))).catch(() => { peopleP = null; return []; }));

// ---------- перенос ----------
const stepIdx = (r, key) => (r.route || []).findIndex((s) => (s.workTypeId || 'generic') === key);
const canGo = (r, key) => (r.status === 'cancelled' ? false : key === 'waiting' || key === 'done' || stepIdx(r, key) >= 0);
const call = (r, key) => {
  if (key === 'done') return api(`/work-tasks/${r.id}/done`, { method: 'POST' });
  if (key === 'waiting') return api(`/work-tasks/${r.id}/move`, { method: 'POST', body: { to: 'waiting' } });
  const i = stepIdx(r, key);
  if (i < 0) throw new Error('Этого вида работ нет в маршруте изделия');
  return api(`/work-tasks/${r.id}/move`, { method: 'POST', body: { stepIndex: i } });
};
const label = (r, key) => (key === 'waiting' ? 'Ждёт запуска' : key === 'done' ? 'Готово' : r.route.find((s) => (s.workTypeId || 'generic') === key)?.name || 'Следующий шаг');
/** Перенести на колонку (key = 'waiting' | 'done' | id вида работ | 'generic'). Возвращает обновлённую карточку; «Отменить» — в тосте. */
export async function moveTo(r, key) {
  const saved = await call(r, key);
  const prev = colKey(r);
  toast(`${r.code} → ${label(saved, key)}`, { undo: async () => { await call(saved, prev); window.dispatchEvent(new CustomEvent('data-changed')); } });
  return saved;
}
const nextStep = (r) => api(`/work-tasks/${r.id}/move`, { method: 'POST', body: { to: 'next' } });

// ---------- доска ----------
function boardBody(r, c) {
  const stepLine = h('div', { class: 'wk-step' }, dots(r), h('span', { class: 'wk-step-name' }, r.status === 'work' ? (r.currentStep || '') : ''));
  return boardCard({ pic: pic(r), title: r.title, sub: [r.code, subLine(r)].filter(Boolean).join(' · '), compact: c.compact,
    extra: c.compact ? [] : [stepLine], meta: c.compact ? [dots(r), avatar(r)] : [dueNode(r), prioBadge(r), avatar(r)] });
}

/** Колонки приходят с сервером, поэтому доска строится после первого ответа; набор колонок поменялся — собирается заново. */
function columnsOf(resp) {
  return (resp.columns || []).map((c) => {
    if (c.key === 'waiting') return { key: 'waiting', label: c.title, tone: 'dim', hint: 'Запущены, но ещё не начаты', emptyText: 'Пусто. Карточки приходят из заказов: «Запустить в работу»', query: { status: 'waiting', sort: 'seq' } };
    if (c.key === 'done') return { key: 'done', label: c.title, tone: 'ok', compact: true, portion: true, per: 20, emptyText: 'Пусто. Готовые за последнюю неделю появятся здесь', query: { status: 'done', doneDays: 7, sort: '-completedAt' } };
    return { key: c.key, label: c.title, tone: 'info', emptyText: 'Пусто', query: { status: 'work', workTypeId: c.key, sort: 'seq' } };
  });
}

function mountWorkBoard(board, path, query, hooks) {
  const el = h('div', { class: 'wk-wrap' }, h('div', { class: 'skel', style: { margin: '8px 4px' } }));
  let q = query, inner = null, sig = '', mine = 0;
  async function sync() {
    const n = ++mine;
    let resp;
    try { resp = await api(path, { query: { ...q, limit: 1 } }); }
    catch (e) { if (n !== mine) return; inner = null; sig = ''; el.replaceChildren(failBlock(e, sync)); return; }
    if (n !== mine) return;
    const cols = columnsOf(resp);
    const filtered = !!(q.search || q.orderId || q.assigneeId);
    if (!resp.counts?.all && !filtered) { // ни одной карточки — подсказка вместо пустых колонок
      inner = null; sig = 'empty'; hooks.onTotal?.(0);
      el.replaceChildren(h('div', { class: 'state wk-empty' }, h('b', null, 'В работе пока ничего нет'),
        h('p', { class: 'muted' }, 'Откройте заказ → «Запустить в работу»: изделия встанут на доску и пойдут по своим видам работ.'),
        h('a', { class: 'btn btn-primary', href: '#salesorders' }, 'Открыть заказы')));
      return;
    }
    const s = JSON.stringify(cols.map((c) => [c.key, c.label]));
    if (inner && s === sig) { inner.setQuery(q); return; }
    sig = s;
    inner = mountBoard({ ...board, columns: cols }, path, q, hooks);
    el.replaceChildren(inner.el);
  }
  sync();
  return { el, reload: () => sync(), reloadFor: (row) => (inner ? inner.reloadFor(row) : sync()), setQuery: (nq) => { q = nq; sync(); } };
}

export const work = {
  id: 'work',
  kind: 'Задача в работе',
  title: 'В работе',
  noun: 'задание',
  entityType: 'WorkTask',
  historyLabels: { 'worktask.launched': 'Запущено', 'worktask.moved': 'Перемещено', 'worktask.done': 'Готово', 'worktask.cancelled': 'Отменено', 'worktask.updated': 'Изменено', 'worktask.deleted': 'Удалено', 'worktask.restored': 'Восстановлено' },
  get: (id) => api(`/work-tasks/${id}`),

  list: {
    viewKey: 'work', path: '/work-tasks',
    sortDefault: 'seq',
    createLabel: false, // карточки создаёт «Запустить в работу» в заказе
    export: false,
    searchPlaceholder: 'Поиск: W-12, изделие, № заказа, заказчик, артикул…',
    emptyText: 'Заданий пока нет.', emptyHint: 'Откройте заказ и нажмите «Запустить в работу».',
    filters: [
      { key: 'status', label: 'Статус', type: 'chips', noAll: true, defaultValue: 'waiting,work',
        options: () => [{ value: 'waiting,work', label: 'Открытые' }, { value: 'waiting', label: STATUS.waiting.label }, { value: 'work', label: STATUS.work.label }, { value: 'done', label: STATUS.done.label }, { value: 'cancelled', label: STATUS.cancelled.label }, { value: 'waiting,work,done', label: 'Все' }],
        count: (resp, v) => (v === 'waiting,work' ? (resp.counts?.waiting || 0) + (resp.counts?.work || 0) : v === 'waiting,work,done' ? resp.counts?.all : resp.counts?.[v]) },
      { key: 'assigneeId', label: 'Все исполнители', type: 'select', options: () => people() },
      { key: 'orderId', label: 'Все заказы', type: 'select', options: () => activeOrders().then((os) => os.map((o) => ({ value: o.id, label: orderLabel(o) }))) },
    ],
    columns: [
      { key: 'code', label: 'Код', sort: 'seq', cls: 'nowrap', render: (r) => h('b', null, r.code) },
      { key: 'pic', label: '', cls: 'pic-cell', render: (r) => (r.photo ? h('img', { class: 'pic', src: PREFIX + r.photo, alt: '', loading: 'lazy', onerror: (e) => e.target.remove() }) : null) },
      { key: 'title', label: 'Изделие', cls: 'clip', render: (r) => h('span', { title: r.title }, r.title, subLine(r) ? h('small', { class: 'muted' }, ' ' + subLine(r)) : null) },
      { key: 'step', label: 'Где сейчас', cls: 'nowrap', render: (r) => h('span', { class: 'wk-where' }, dots(r), ' ', stepText(r)) },
      { key: 'due', label: 'Срок', cls: 'nowrap', render: dueNode },
      { key: 'assignee', label: 'Исполнитель', cls: 'nowrap md-hide', render: (r) => (r.assignee ? r.assignee.name : h('span', { class: 'muted' }, 'Без исполнителя')) },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => badge(STATUS, r.status) },
    ],
    card: {
      title: (r) => `${r.code} · ${r.title}`,
      sub: (r) => [subLine(r), r.deadline ? 'срок ' + date(r.deadline) : '', r.assignee?.name].filter(Boolean).join(' · '),
      side: (r) => [badge(STATUS, r.status), r.status === 'work' ? h('span', { class: 'muted' }, ' ' + stepText(r)) : null],
      thumb: (r) => (r.photo ? h('img', { class: 'thumb', src: PREFIX + r.photo, alt: '', loading: 'lazy' }) : null),
    },
    gantt: { mount: mountScheduleView, searchPlaceholder: 'Заказ, изделие, работа, исполнитель…' },
    board: {
      default: true,
      mount: mountWorkBoard,
      headCount: true,
      prefKey: 'work',
      cls: 'board-pics',
      // свёрнуто по умолчанию: в колонках видны заказы; ▸ раскрывает позиции (как доска проектирования)
      groupOpen: false,
      group: (r) => {
        const id = r.orderId || r.productionNo;
        if (!id) return null;
        const no = clean(r.productionNo);
        return {
          key: String(id),
          label: no ? '№ ' + no : 'Заказ',
          sub: clean(r.customer),
          // open.href → группа даже из одной позиции + чип ведёт в заказ
          open: { href: '#salesorders?open=' + encodeURIComponent(no || String(r.orderId || '')) },
        };
      },
      columns: [], // собираются по ответу сервера (mountWorkBoard)
      card: (r, c) => ({ body: boardBody(r, c) }),
      canDrop: (r, key) => canGo(r, key),
      move: async (r, to) => !!(await moveTo(r, to)),
    },
  },

  card: workCard({ status: STATUS, clean, dueNode, prioBadge, people, call, nextStep }),

  remove: {
    text: (r) => `Удалить задание ${r.code} «${r.title}»? Позицию можно будет запустить заново.`,
    run: (r) => api(`/work-tasks/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/work-tasks/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: `${r.code} · ${r.title}`, sub: [r.productionNo && 'заказ ' + r.productionNo, r.customer].filter(Boolean).join(' · '), side: badge(STATUS, r.status) }),
  open: (id) => go('work', { open: id }),
};
