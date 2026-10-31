import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { date, isoDay } from '../core/format.js';
import { toast, toastError } from './toast.js';
import { failBlock } from './busy.js';

/**
 * Вид «Гант» для списка заданий (раздел «В работе»). Подключается как `list.gantt = { mount: mountGantt, … }` (ui/list.js).
 * Интерфейс как у доски: mountGantt(cfg, path, query, { onOpen, onChanged, onTotal }) → { el, setQuery(q), reload() }.
 * Строки — задания, группировка «По заказам» / «По исполнителям»; полосы — шаги маршрута (`plan[]` с сервера:
 * { stepIndex, workType, start, end, days, manual }) либо, если плана нет, факт (от запуска) и план (до срока заказа).
 * Масштаб день / неделя / месяц, закреплённая левая колонка, линия «сегодня», сводка «просрочено · идут · ждут».
 * Перетаскивание (мышь и касание): тело полосы — сдвиг начала шага, правый край — длительность;
 * по отпусканию PATCH {path}/:id/plan { stepIndex, start? , days? }; ошибка — тост и откат. Только тем, кто правит задания.
 * cfg: { prefKey?, canEdit?() , limit? }. Ничего, кроме h() и токенов: стили `.gt-*` в ui/screens.css.
 */
const SCALES = [{ id: 'day', label: 'День', px: 36 }, { id: 'week', label: 'Неделя', px: 18 }, { id: 'month', label: 'Месяц', px: 8 }];
const GROUPS = [{ id: 'order', label: 'По заказам' }, { id: 'assignee', label: 'По исполнителям' }];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const STEP_STATE_TEXT = { done: 'сделано', current: 'сейчас', next: 'впереди', cancel: 'отменена' };
const LIMIT = 200;

const dayNum = (v) => { // 'ГГГГ-ММ-ДД...' или Date → число дней от 1970 (местная дата)
  if (!v) return null;
  const s = v instanceof Date ? isoDay(v) : /^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10)) && String(v).length <= 10 ? String(v) : isoDay(new Date(v));
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null;
};
const isoOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const dmy = (n) => date(isoOf(n));
const clean = (v) => { const s = v === null || v === undefined ? '' : String(v).trim(); return s === 'null' || s === 'undefined' ? '' : s; };
const dow = (n) => new Date(n * 864e5).getUTCDay(); // 0 = вс

function loadPrefs(key) {
  try { const p = JSON.parse(localStorage.getItem(key) || '{}'); return { scale: SCALES.some((s) => s.id === p.scale) ? p.scale : 'week', group: GROUPS.some((g) => g.id === p.group) ? p.group : 'order' }; }
  catch { return { scale: 'week', group: 'order' }; }
}

/** Задание → модель строки: полосы, срок, просрочка. */
function model(r, today) {
  const closed = r.status === 'done' || r.status === 'cancelled';
  const dl = dayNum(r.deadline);
  const late = dl !== null && !closed && dl < today ? today - dl : 0;
  const bars = [];
  const plan = Array.isArray(r.plan) ? r.plan.filter((p) => p && p.start) : [];
  const stepName = (i) => r.route?.[i]?.name || '';
  if (plan.length) {
    for (const p of plan) {
      const start = dayNum(p.start);
      if (start === null) continue;
      const end = dayNum(p.end);
      const len = Math.max(1, Number(p.days) || (end !== null ? end - start : 1)); // end — исключающая граница (start + days)
      const i = Number(p.stepIndex);
      const state = r.status === 'cancelled' ? 'cancel' : r.status === 'done' ? 'done' : r.status === 'waiting' ? 'next' : i < r.stepIndex ? 'done' : i === r.stepIndex ? 'current' : 'next';
      bars.push({ start, len, state, text: clean(p.workType) || stepName(i) || 'Шаг', stepIndex: i, days: len, manual: !!p.manual, plan: true, late: late > 0 && state === 'current' });
    }
  } else {
    const from = dayNum(r.startedAt) ?? dayNum(r.createdAt) ?? today;
    if (r.status === 'waiting') {
      const to = dl !== null && dl > today ? dl : today;
      bars.push({ start: today, len: Math.max(1, to - today + 1), state: 'next', text: 'Ждёт запуска', plan: false, late: late > 0 });
    } else {
      const to = Math.max(from, dayNum(r.completedAt) ?? today);
      const cur = r.status === 'work' ? (stepName(r.stepIndex) || r.currentStep || 'В работе') : r.status === 'done' ? 'Готово' : 'Отменена';
      bars.push({ start: from, len: to - from + 1, state: r.status === 'done' ? 'done' : r.status === 'cancelled' ? 'cancel' : 'current', text: cur, plan: false, late: late > 0 });
      if (dl !== null && !closed && dl > to) bars.push({ start: to + 1, len: dl - to, state: 'next', text: 'до срока', plan: false, late: false });
    }
  }
  const lo = Math.min(...bars.map((b) => b.start), dl ?? Infinity);
  const hi = Math.max(...bars.map((b) => b.start + b.len), dl !== null ? dl + 1 : -Infinity);
  return { r, bars, dl, late, closed, lo, hi, noDeadline: dl === null && !closed };
}

function tip(m, bar) {
  const r = m.r;
  return [`${r.code} · ${r.title}`, clean(r.customer) && 'Заказчик: ' + clean(r.customer), bar ? `Шаг: ${bar.text} (${STEP_STATE_TEXT[bar.state] || ''}), ${dmy(bar.start)} — ${dmy(bar.start + bar.len - 1)}, ${bar.len} дн.` : '',
    m.dl !== null ? 'Срок: ' + dmy(m.dl) + (m.late ? ` · просрочено ${m.late} дн.` : '') : 'Срока нет', 'Исполнитель: ' + (r.assignee?.name || 'не назначен')].filter(Boolean).join('\n');
}

export function mountGantt(cfg, path, query, hooks = {}) {
  const prefKey = cfg?.prefKey || 'dc-gantt-work';
  let prefs = loadPrefs(prefKey);
  const savePrefs = () => { try { localStorage.setItem(prefKey, JSON.stringify(prefs)); } catch { /* */ } };
  const canEdit = () => (cfg?.canEdit ? cfg.canEdit() : !!session.canEdit);
  let q = query; let items = []; let total = 0; let seq = 0; let loaded = false;
  const collapsed = new Set();
  let scroller = null; let todayX = 0; let failed = false;

  const bar = h('div', { class: 'gt-bar-head' });
  const body = h('div', { class: 'gt-body' }, h('div', { class: 'skel', style: { margin: '8px 4px' } }));
  const el = h('div', { class: 'gt-wrap' }, bar, body);

  // ---------- загрузка ----------
  async function load(keepScroll = true) {
    const my = ++seq;
    let resp;
    try { resp = await api(path, { query: { ...q, limit: cfg?.limit || LIMIT, page: 1, sort: 'seq' } }); }
    catch (e) { if (my !== seq) return; failed = true; body.replaceChildren(failBlock(e, () => load(false))); bar.replaceChildren(); return; }
    if (my !== seq) return;
    failed = false;
    items = resp.items || []; total = resp.total ?? items.length;
    hooks.onTotal?.(total);
    render(keepScroll && loaded);
    loaded = true;
  }

  // ---------- панель: сводка, группировка, масштаб, «Сегодня» ----------
  function seg(list, cur, onPick, label) {
    return h('div', { class: 'seg', role: 'tablist', 'aria-label': label }, ...list.map((x) => h('button', { type: 'button', class: x.id === cur ? 'active' : '', onclick: () => onPick(x.id) }, x.label)));
  }
  function renderBar(models, today) {
    const over = models.filter((m) => m.late).length;
    const going = models.filter((m) => m.r.status === 'work').length;
    const wait = models.filter((m) => m.r.status === 'waiting').length;
    bar.replaceChildren(
      h('div', { class: 'gt-sum', role: 'status' },
        h('span', { class: 'gt-sum-i' + (over ? ' over' : '') }, `просрочено ${over}`), h('span', { class: 'gt-sum-i' }, `идут ${going}`), h('span', { class: 'gt-sum-i' }, `ждут ${wait}`)),
      h('span', { class: 'spacer' }),
      seg(GROUPS, prefs.group, (g) => { prefs.group = g; savePrefs(); render(true); }, 'Группировка'),
      seg(SCALES, prefs.scale, (s) => { prefs.scale = s; savePrefs(); render(false); }, 'Масштаб'),
      h('button', { type: 'button', class: 'btn btn-sm', title: 'Показать сегодняшний день', onclick: (e) => goToday(e.currentTarget) }, 'Сегодня'));
  }
  function goToday(btn) {
    if (!scroller) return;
    const lab = scroller.querySelector('.gt-label')?.offsetWidth || 0;
    scroller.scrollTo({ left: Math.max(0, todayX - (scroller.clientWidth + lab) / 2), behavior: 'smooth' });
    const line = scroller.querySelector('.gt-today');
    for (const n of [line, btn]) { if (!n) continue; n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash'); }
  }

  // ---------- построение ----------
  function groupsOf(models) {
    const by = new Map();
    for (const m of models) {
      const r = m.r;
      let key; let label; let last = false;
      if (prefs.group === 'assignee') { key = r.assigneeId || r.assignee?.id || 'none'; label = r.assignee?.name || 'Не назначен'; last = key === 'none'; }
      else { key = r.orderId || clean(r.productionNo) || 'none'; label = key === 'none' ? 'Без заказа' : ['Заказ № ' + (clean(r.productionNo) || '—'), clean(r.customer)].filter(Boolean).join(' · '); last = key === 'none'; }
      if (!by.has(key)) by.set(key, { key, label, last, items: [] });
      by.get(key).items.push(m);
    }
    const gs = [...by.values()];
    for (const g of gs) g.items.sort((a, b) => (b.late > 0) - (a.late > 0) || b.late - a.late);
    gs.sort((a, b) => a.last - b.last || (b.items.some((m) => m.late) - a.items.some((m) => m.late)));
    return gs;
  }

  function render(keep) {
    const prevL = keep && scroller ? scroller.scrollLeft : null; const prevT = keep && scroller ? scroller.scrollTop : null;
    const today = dayNum(new Date());
    const models = items.map((r) => model(r, today));
    renderBar(models, today);
    if (!models.length) {
      scroller = null;
      const filtered = !!(q.search || q.orderId || q.assigneeId);
      body.replaceChildren(h('div', { class: 'state wk-empty' }, h('b', null, filtered ? 'Ничего не найдено' : 'Заданий пока нет'),
        h('p', { class: 'muted' }, filtered ? 'Измените фильтры или поиск.' : 'Откройте заказ и нажмите «Запустить в работу».'),
        filtered ? null : h('a', { class: 'btn btn-primary', href: '#salesorders' }, 'Открыть заказы')));
      return;
    }
    const px = SCALES.find((s) => s.id === prefs.scale).px;
    const min = Math.min(today - 3, ...models.map((m) => m.lo)) - 2;
    const max = Math.max(today + 14, ...models.map((m) => m.hi)) + 5;
    const days = max - min;
    const W = days * px;
    const xOf = (n) => (n - min) * px;
    todayX = xOf(today) + px / 2;
    const editor = canEdit();

    const trackStyle = (t) => { t.style.width = W + 'px'; t.style.setProperty('--gt-px', px + 'px'); t.style.setProperty('--gt-line', (prefs.scale === 'day' ? px : px * 7) + 'px'); const first = prefs.scale === 'day' ? min : min + ((8 - dow(min)) % 7); t.style.setProperty('--gt-off', xOf(first) + 'px'); return t; };

    // шапка: месяцы и числа
    const months = []; const nums = [];
    for (let n = min; n < max; n++) {
      const d = new Date(n * 864e5);
      if (!months.length || months[months.length - 1].m !== d.getUTCMonth()) months.push({ m: d.getUTCMonth(), y: d.getUTCFullYear(), from: n, to: n + 1 });
      else months[months.length - 1].to = n + 1;
      const wd = dow(n);
      if (prefs.scale === 'day') nums.push(h('i', { class: 'gt-n' + (wd === 0 || wd === 6 ? ' we' : '') + (n === today ? ' today' : ''), style: { left: xOf(n) + 'px', width: px + 'px' } }, String(d.getUTCDate()), h('small', null, WD[wd])));
      else if (wd === 1) nums.push(h('i', { class: 'gt-n', style: { left: xOf(n) + 'px', width: px * 7 + 'px' } }, String(d.getUTCDate())));
    }
    const headTrack = trackStyle(h('div', { class: 'gt-track gt-head-track' },
      h('div', { class: 'gt-months' }, ...months.map((x) => h('i', { class: 'gt-mo', style: { left: xOf(x.from) + 'px', width: (x.to - x.from) * px + 'px' } }, (x.to - x.from) * px > 70 ? MONTHS[x.m] + ' ' + x.y : MONTHS[x.m].slice(0, 3)))),
      h('div', { class: 'gt-nums' }, ...nums)));
    const head = h('div', { class: 'gt-row gt-head' }, h('div', { class: 'gt-label' }, 'Задание'), headTrack);

    const rows = [];
    for (const g of groupsOf(models)) {
      const closedG = collapsed.has(g.key);
      const lo = Math.min(...g.items.map((m) => m.lo)); const hi = Math.max(...g.items.map((m) => m.hi));
      const gLate = g.items.filter((m) => m.late).length;
      rows.push(h('div', { class: 'gt-row gt-group' },
        h('button', { type: 'button', class: 'gt-label gt-glabel', 'aria-expanded': String(!closedG), title: g.label, onclick: () => { if (collapsed.has(g.key)) collapsed.delete(g.key); else collapsed.add(g.key); render(true); } },
          h('span', { class: 'gt-caret', 'aria-hidden': 'true' }, closedG ? '▸' : '▾'), h('span', { class: 'gt-gname' }, g.label), h('b', { class: 'gt-gn' }, String(g.items.length))),
        trackStyle(h('div', { class: 'gt-track' }, h('span', { class: 'gt-bar sum' + (gLate ? ' over' : ''), style: { left: xOf(lo) + 'px', width: Math.max(4, (hi - lo) * px - 2) + 'px' } }),
          gLate ? h('span', { class: 'gt-note over', style: { left: xOf(hi) + 4 + 'px' } }, `просрочено: ${gLate}`) : null))));
      if (closedG) continue;
      for (const m of g.items) rows.push(taskRow(m, xOf, px, trackStyle, editor, today));
    }
    const grid = h('div', { class: 'gt-grid' }, head, ...rows);
    grid.style.width = `calc(var(--gt-label) + ${W}px)`;
    // линия «сегодня» — одна на всю высоту
    const line = h('div', { class: 'gt-today', 'aria-hidden': 'true', title: 'Сегодня, ' + dmy(today) });
    line.style.left = `calc(var(--gt-label) + ${todayX}px)`;
    grid.append(line);
    const more = total > items.length ? h('div', { class: 'gt-more muted' }, `Показано ${items.length} из ${total} — уточните фильтр.`) : null;
    scroller = h('div', { class: 'gt-scroll', tabindex: '-1' }, grid);
    body.replaceChildren(scroller, more);
    if (prevL !== null) { scroller.scrollLeft = prevL; scroller.scrollTop = prevT; }
    else centerLater();
  }
  function centerLater(tries = 8) {
    requestAnimationFrame(() => {
      if (!scroller) return;
      if (!scroller.clientWidth && tries > 0) { centerLater(tries - 1); return; }
      const lab = scroller.querySelector('.gt-label')?.offsetWidth || 0;
      scroller.scrollLeft = Math.max(0, todayX - (scroller.clientWidth + lab) / 2);
    });
  }

  function taskRow(m, xOf, px, trackStyle, editor, today) {
    const r = m.r;
    const open = () => hooks.onOpen?.(r);
    const label = h('button', { type: 'button', class: 'gt-label gt-tlabel' + (m.late ? ' over' : ''), title: tip(m), 'aria-label': `${r.code}, ${r.title}. Открыть задание`, onclick: open },
      h('b', null, r.code), h('span', { class: 'gt-ttitle' }, r.title));
    const track = trackStyle(h('div', { class: 'gt-track' }));
    const last = m.bars[m.bars.length - 1];
    for (const b of m.bars) track.append(barNode(m, b, xOf, px, editor));
    if (m.dl !== null) track.append(h('i', { class: 'gt-dl' + (m.late ? ' over' : ''), style: { left: xOf(m.dl) + px - 2 + 'px' }, title: 'Срок: ' + dmy(m.dl) }));
    const end = Math.max(...m.bars.map((b) => b.start + b.len), m.dl !== null ? m.dl + 1 : -Infinity);
    const note = m.late ? { t: `просрочено ${m.late} дн.`, c: 'over' } : m.noDeadline ? { t: 'без срока', c: '' } : null;
    if (note && last) track.append(h('span', { class: 'gt-note ' + note.c, style: { left: xOf(end) + 6 + 'px' } }, note.t));
    return h('div', { class: 'gt-row gt-task' }, label, track);
  }

  function barNode(m, b, xOf, px, editor) {
    const r = m.r;
    const draggable = editor && b.plan && !m.closed;
    const cls = 'gt-bar ' + (b.late ? 'over' : b.state) + (draggable ? ' drag' : '') + (b.manual ? ' manual' : '');
    const node = h('button', { type: 'button', class: cls, title: tip(m, b) + (draggable ? '\nПотяните, чтобы сдвинуть; за правый край — изменить срок' : ''), 'aria-label': `${r.code}: ${b.text}, ${dmy(b.start)} — ${dmy(b.start + b.len - 1)}${m.late ? ', просрочено ' + m.late + ' дн.' : ''}. Открыть задание` },
      h('span', { class: 'gt-bt' }, b.text), draggable ? h('i', { class: 'gt-h', 'aria-hidden': 'true' }) : null);
    node.style.left = xOf(b.start) + 'px'; node.style.width = Math.max(6, b.len * px - 2) + 'px';
    let moved = false;
    node.addEventListener('click', (e) => { if (moved) { moved = false; e.preventDefault(); return; } hooks.onOpen?.(r); });
    if (draggable) {
      bindDrag(node, m, b, px, () => { moved = true; });
      node.addEventListener('keydown', (e) => { // ←/→ — сдвиг на день, Shift+←/→ — длительность
        if ((e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') || e.ctrlKey || e.metaKey || e.altKey) return;
        e.preventDefault();
        const d = e.key === 'ArrowRight' ? 1 : -1;
        if (e.shiftKey) { if (b.days + d >= 1) commit(node, m, b, { stepIndex: b.stepIndex, days: b.days + d }, `${m.r.code}: срок шага — ${b.days + d} дн.`, () => {}); }
        else commit(node, m, b, { stepIndex: b.stepIndex, start: isoOf(b.start + d) }, `${m.r.code}: шаг «${b.text}» начнётся ${dmy(b.start + d)}`, () => {});
      });
    }
    return node;
  }

  async function commit(node, m, b, body, okText, revert) {
    node.classList.add('is-busy'); node.disabled = true;
    try { await api(`${path}/${m.r.id}/plan`, { method: 'PATCH', body }); toast(okText); await load(true); hooks.onChanged?.(); }
    catch (err) { revert(); node.classList.remove('is-busy'); node.disabled = false; toastError(err, 'сдвинуть шаг'); }
  }

  function bindDrag(node, m, b, px, markMoved) {
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button > 0) return;
      const resize = !!e.target.closest('.gt-h');
      const x0 = e.clientX; let delta = 0; let dragging = false;
      const touch = e.pointerType === 'touch' && !resize; // касание телом полосы — только после долгого нажатия (иначе лента листается)
      let armed = !touch; let tmr = null;
      const hold = (ev) => { if (armed) ev.preventDefault(); }; // после долгого нажатия лента не листается
      if (touch) { tmr = setTimeout(() => { armed = true; if (navigator.vibrate) navigator.vibrate(15); node.classList.add('armed'); }, 400); node.addEventListener('touchmove', hold, { passive: false }); }
      const left0 = parseFloat(node.style.left); const w0 = parseFloat(node.style.width);
      try { node.setPointerCapture(e.pointerId); } catch { /* */ }
      const move = (ev) => {
        const dx = ev.clientX - x0;
        if (!armed) { if (Math.abs(dx) > 8) { clearTimeout(tmr); tmr = null; } return; }
        if (!dragging && Math.abs(dx) < 4) return;
        dragging = true; node.classList.add('dragging');
        delta = Math.round(dx / px);
        if (resize) { delta = Math.max(1 - b.days, delta); node.style.width = Math.max(6, (b.days + delta) * px - 2) + 'px'; }
        else node.style.left = left0 + delta * px + 'px';
        node.dataset.hint = resize ? `${b.days + delta} дн.` : dmy(b.start + delta);
      };
      const finish = async (ev, cancel) => {
        clearTimeout(tmr); node.classList.remove('armed'); node.removeEventListener('touchmove', hold);
        node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', cn);
        try { node.releasePointerCapture(e.pointerId); } catch { /* */ }
        node.classList.remove('dragging'); delete node.dataset.hint;
        if (!dragging) return;
        markMoved();
        if (cancel || delta === 0) { node.style.left = left0 + 'px'; node.style.width = w0 + 'px'; return; }
        const body = { stepIndex: b.stepIndex };
        if (resize) body.days = b.days + delta; else body.start = isoOf(b.start + delta);
        await commit(node, m, b, body, resize ? `${m.r.code}: срок шага — ${b.days + delta} дн.` : `${m.r.code}: шаг «${b.text}» начнётся ${dmy(b.start + delta)}`, () => { node.style.left = left0 + 'px'; node.style.width = w0 + 'px'; });
      };
      const up = (ev) => finish(ev, false); const cn = (ev) => finish(ev, true);
      node.addEventListener('pointermove', move); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', cn);
    });
  }

  load(false);
  return {
    el,
    reload: () => load(true),
    setQuery: (nq) => { q = nq; load(true); },
  };
}
