import { api, PREFIX, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay, qty } from '../core/format.js';
import { go } from '../core/router.js';
import { badge, ORDER_PRIORITY } from '../ui/badges.js';
import { mountBoard } from '../ui/board.js';
import { failBlock } from '../ui/busy.js';
import { enhanceSelect } from '../ui/select.js';
import { toast, toastError } from '../ui/toast.js';
import { activeOrders, orderLabel } from './salesorders.js';

/**
 * Раздел «В работе»: карточки изделий едут по доске слева направо — «Ждёт запуска» → виды работ из маршрута изделия → «Готово».
 * Карточку создаёт «Запустить в работу» в заказе (sections/order-work.js); маршрут задаётся в изделии («Как делается», sections/work-route.js).
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
const avatar = (r) => (r.assignee ? h('span', { class: 'avatar sm', title: r.assignee.name, 'aria-label': 'Исполнитель: ' + r.assignee.name }, r.assignee.initials) : h('span', { class: 't-none' }, 'не назначен'));
const pic = (r) => (r.photo ? h('img', { class: 't-pic', src: PREFIX + r.photo, alt: '', loading: 'lazy', draggable: 'false', onerror: (e) => e.target.replaceWith(h('div', { class: 't-pic-none' }, 'нет фото')) }) : h('div', { class: 't-pic-none' }, 'нет фото'));
/** Точки маршрута: сделано / сейчас / впереди. */
export function dots(r) {
  const route = r.route || [];
  return h('span', { class: 'wk-dots', title: route.length ? route.map((s) => s.name).join(' → ') : 'Маршрут не задан' },
    ...route.map((s) => h('i', { class: 'wk-dot ' + (r.status === 'done' ? 'done' : r.status === 'waiting' ? 'next' : s.state), title: s.name })));
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
  const foot = h('div', { class: 't-foot' }, dueNode(r), prioBadge(r), avatar(r));
  const stepLine = h('div', { class: 'wk-step' }, dots(r), h('span', { class: 'wk-step-name' }, r.status === 'work' ? (r.currentStep || '') : ''));
  if (c.compact) {
    return [pic(r), h('div', { class: 't-main' }, h('div', { class: 't-title', title: r.title }, r.title), h('div', { class: 't-sub' }, [r.code, subLine(r)].filter(Boolean).join(' · ')), h('div', { class: 't-foot' }, dots(r), avatar(r)))];
  }
  return [pic(r), h('div', { class: 't-title', title: r.title }, r.title), h('div', { class: 't-sub' }, [r.code, subLine(r)].filter(Boolean).join(' · ')), stepLine, foot];
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

// ---------- карточка ----------
function routeSteps(r) {
  if (!(r.route || []).length) return h('p', { class: 'muted' }, 'Маршрут не задан.');
  const mark = { done: '✓', current: '●', next: '○' };
  return h('ol', { class: 'wk-steps' }, ...r.route.map((s) => {
    const st = r.status === 'done' ? 'done' : r.status === 'waiting' ? 'next' : s.state;
    return h('li', { class: 'wk-st ' + st }, h('span', { class: 'wk-mark', 'aria-hidden': 'true' }, mark[st]),
      h('span', { class: 'wk-st-name' }, s.name, h('small', { class: 'muted' }, st === 'done' ? ' · сделано' : st === 'current' ? ' · сейчас' : ' · впереди', s.note ? ' · ' + s.note : '')));
  }));
}
const pair = (k, v) => (v === null || v === undefined || v === '' ? [] : [h('dt', null, k), h('dd', null, v)]);

function topBlock(r) {
  const can = session.canEdit;
  const znp = [clean(r.productionNo), r.seqNo ?? r.lineNo].filter((x) => x !== '' && x != null).join(' / ');
  const grid = h('dl', { class: 'kv-grid' },
    ...pair('Изготовить', r.qty ? h('span', { class: 'kv-qty' }, `${qty(r.qty)} ${clean(r.unit) || 'шт'}`) : ''),
    ...pair('Арт.', clean(r.sku)),
    ...pair('Изделие', r.productId ? h('a', { href: '#products?open=' + r.productId }, clean(r.productName) || clean(r.sku) || 'Открыть изделие') : ''),
    ...pair('Заказ / поз.', znp ? (r.orderId ? h('a', { class: 'ref-orders', href: '#salesorders?open=' + r.orderId }, '№ ' + znp) : znp) : ''),
    ...pair('Заказчик', clean(r.customer)),
    ...pair('Срок', dueNode(r)),
    ...(can ? [] : pair('Исполнитель', r.assignee ? r.assignee.name : 'не назначен')));
  return h('div', { class: 'dc-top' },
    h('div', { class: 'dc-chips' }, badge(STATUS, r.status), prioBadge(r)),
    r.status === 'cancelled' && r.cancelReason ? h('div', { class: 'dc-pause' }, 'Отменена: ' + r.cancelReason) : null,
    r.photo ? h('img', { class: 'wk-photo', src: PREFIX + r.photo, alt: '' }) : null,
    grid,
    h('section', { class: 'wk-route-now' }, h('h3', null, 'Маршрут'), routeSteps(r)));
}

/** Исполнитель (из тех, у кого есть вид работ текущего шага) и примечание — сохраняются одной кнопкой. */
function assignBlock(r, ctx) {
  const wt = r.status === 'work' ? r.route?.[r.stepIndex] : null;
  const sel = h('select', { 'aria-label': 'Исполнитель' }, h('option', { value: '' }, '— не назначен —'));
  const note = h('textarea', { rows: 3, maxlength: 500, 'aria-label': 'Примечание', placeholder: 'Примечание (необязательно)' });
  note.value = r.note || '';
  const hint = h('div', { class: 'hint' });
  const all = h('button', { type: 'button', class: 'link-btn', hidden: true, onclick: () => fill(true) }, 'Показать всех сотрудников');
  async function fill(everyone) {
    let list;
    try { list = everyone || !wt?.workTypeId ? await people() : (await api('/work-tasks/people', { query: { workTypeId: wt.workTypeId } })).items.map((p) => ({ value: p.id, label: p.name })); }
    catch { list = []; }
    if (r.assigneeId && !list.some((p) => p.value === r.assigneeId)) list = [{ value: r.assigneeId, label: r.assignee?.name || 'Исполнитель' }, ...list];
    sel.replaceChildren(h('option', { value: '' }, '— не назначен —'), ...list.map((p) => h('option', { value: p.value }, p.label)));
    sel.value = r.assigneeId || '';
    enhanceSelect(sel, { force: true });
    const limited = !everyone && !!wt?.workTypeId;
    hint.textContent = limited ? (list.length ? `Показаны сотрудники с видом работ «${wt.name}».` : `С видом работ «${wt.name}» сотрудников нет. Вид работ добавляется в «Справочники → Сотрудники».`) : '';
    all.hidden = !limited;
  }
  const save = h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: async (e) => {
    const b = e.currentTarget; b.disabled = true; b.classList.add('is-busy');
    try { const body = {}; if ((sel.value || null) !== (r.assigneeId || null)) body.assigneeId = sel.value || null; if (note.value.trim() !== (r.note || '')) body.note = note.value.trim();
      if (!Object.keys(body).length) { toast('Ничего не изменилось'); b.disabled = false; b.classList.remove('is-busy'); return; }
      const saved = await api('/work-tasks/' + r.id, { method: 'PATCH', body }); toast('Сохранено'); ctx.setRow(saved); }
    catch (err) { toastError(err, 'сохранить'); b.disabled = false; b.classList.remove('is-busy'); }
  } }, 'Сохранить');
  const box = h('section', { class: 'wk-assign' }, h('h3', null, 'Исполнитель и примечание'),
    h('label', { class: 'field' }, h('span', null, 'Исполнитель'), sel), hint, all,
    h('label', { class: 'field' }, h('span', null, 'Примечание'), note), h('div', { class: 'spec-acts' }, save));
  sel.disabled = true; fill(false).then(() => { sel.disabled = false; });
  return box;
}

/** «Отменить»: причина обязательна. Свёрнуто, чтобы не нажать случайно. */
function cancelBlock(r, ctx) {
  const why = h('textarea', { rows: 2, maxlength: 300, 'aria-label': 'Причина отмены', placeholder: 'Почему отменяем (например, заказчик отказался)' });
  const btn = h('button', { type: 'button', class: 'btn btn-sm btn-danger', onclick: async (e) => {
    if (!why.value.trim()) { toast('Впишите причину отмены'); why.focus(); return; }
    const b = e.currentTarget; b.disabled = true; b.classList.add('is-busy');
    try { const saved = await api(`/work-tasks/${r.id}/cancel`, { method: 'POST', body: { reason: why.value.trim() } }); toast(`${r.code} отменена`); ctx.setRow(saved); }
    catch (err) { toastError(err, 'отменить'); b.disabled = false; b.classList.remove('is-busy'); }
  } }, 'Отменить задание');
  return h('details', { class: 'db-blk wk-cancel' }, h('summary', null, 'Отменить задание'),
    h('div', { class: 'db-blk-body' }, h('p', { class: 'muted' }, 'Позиция освободится — её можно будет запустить заново.'), h('label', { class: 'field' }, h('span', null, 'Причина'), why), btn));
}

export const work = {
  id: 'work',
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
    emptyText: 'Заданий пока нет. Откройте заказ и нажмите «Запустить в работу».',
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
      { key: 'assignee', label: 'Исполнитель', cls: 'nowrap md-hide', render: (r) => (r.assignee ? r.assignee.name : h('span', { class: 'muted' }, 'не назначен')) },
      { key: 'status', label: 'Статус', cls: 'nowrap', render: (r) => badge(STATUS, r.status) },
    ],
    card: {
      title: (r) => `${r.code} · ${r.title}`,
      sub: (r) => [subLine(r), r.deadline ? 'срок ' + date(r.deadline) : '', r.assignee?.name].filter(Boolean).join(' · '),
      side: (r) => [badge(STATUS, r.status), r.status === 'work' ? h('span', { class: 'muted' }, ' ' + stepText(r)) : null],
      thumb: (r) => (r.photo ? h('img', { class: 'thumb', src: PREFIX + r.photo, alt: '', loading: 'lazy' }) : null),
    },
    board: {
      default: true,
      mount: mountWorkBoard,
      headCount: true,
      cls: 'board-pics',
      columns: [], // собираются по ответу сервера (mountWorkBoard)
      card: (r, c) => ({ body: boardBody(r, c) }),
      canDrop: (r, key) => canGo(r, key),
      move: async (r, to) => !!(await moveTo(r, to)),
    },
  },

  card: {
    heading: (r) => `${r.code} · ${r.title}`,
    subheading: (r) => stepText(r),
    gallery: () => [],
    top: (r) => topBlock(r),
    view: () => [],
    extra: (r, ctx) => {
      if (!session.canEdit) return r.note ? h('div', { class: 'dc-note' }, r.note) : null;
      return h('div', { class: 'db-blocks' }, r.status === 'cancelled' ? (r.note ? h('div', { class: 'dc-note' }, r.note) : null) : assignBlock(r, ctx), r.status === 'waiting' || r.status === 'work' ? cancelBlock(r, ctx) : null);
    },
    actions: (r) => {
      const run = (fn) => async (row, ctx) => { const saved = await fn(row); if (saved) ctx.setRow(saved); };
      const last = (r.route || []).length - 1;
      if (r.status === 'cancelled') return [];
      if (r.status === 'done') return [{ label: 'Вернуть в работу', primary: true, title: 'Вернуть на последний шаг маршрута', run: run((row) => call(row, row.route[last] ? (row.route[last].workTypeId || 'generic') : 'waiting')) }];
      const out = [];
      if (r.status === 'waiting') out.push({ label: 'Взять в работу', primary: true, title: 'Начать с первого шага маршрута', run: run((row) => nextStep(row)) });
      else if (r.stepIndex < last) out.push({ label: 'Следующий шаг: ' + r.route[r.stepIndex + 1].name, primary: true, run: run((row) => nextStep(row)) });
      out.push({ label: 'Готово', primary: r.status === 'work' && r.stepIndex >= last, title: 'Все работы сделаны', run: run((row) => call(row, 'done')) });
      if (r.status === 'work') out.push({ label: 'Вернуть в ожидание', more: true, run: run((row) => call(row, 'waiting')) });
      out.push({ label: 'Отменить…', more: true, run: async () => { const d = document.querySelector('.wk-cancel'); if (!d) return; d.open = true; d.scrollIntoView({ block: 'center', behavior: 'smooth' }); d.querySelector('textarea')?.focus(); } });
      return out;
    },
  },

  remove: {
    text: (r) => `Удалить задание ${r.code} «${r.title}»? Позицию можно будет запустить заново.`,
    run: (r) => api(`/work-tasks/${r.id}`, { method: 'DELETE' }),
    restore: (r) => api(`/work-tasks/${r.id}/restore`, { method: 'POST' }),
  },

  searchRow: (r) => ({ title: `${r.code} · ${r.title}`, sub: [r.productionNo && 'заказ ' + r.productionNo, r.customer].filter(Boolean).join(' · '), side: badge(STATUS, r.status) }),
  open: (id) => go('work', { open: id }),
};
