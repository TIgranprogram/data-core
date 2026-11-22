import { h } from '../../core/dom.js';
import { mark } from './mark.js';
import { plannerBar } from './planner-bar.js';
import { plannerAxis } from './planner-axis.js';
import { buildTree, visible } from './planner-tree.js';

const PX = { day: 36, week: 18, month: 6 };
const CALENDAR_PX = { day: 36, week: 36, month: 24 };
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
const dayNum = (v) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5) : null;
};
const isoOf = (n) => new Date(n * 864e5).toISOString().slice(0, 10);
const dow = (n) => new Date(n * 864e5).getUTCDay();
const dmy = (n) => isoOf(n).split('-').reverse().join('.');
const todayNum = () => { const d = new Date(); return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5); };

/** fitPx(width, from, to) — «Уместить»: ширина одного дня (не меньше 4 px), чтобы лента from…to влезла в width пикселей. */
export const fitPx = (width, from, to) => Math.max(4, (Number(width) || 0) / Math.max(1, (dayNum(to) ?? 0) - (dayNum(from) ?? 0) + 1));

/** Дорожки внутри строки: пересекающиеся полосы — друг под другом. */
function lanes(items) {
  const ends = [];
  return items.slice().sort((a, b) => a.s - b.s || a.e - b.e).map((b) => {
    let i = ends.findIndex((e) => e < b.s);
    if (i < 0) { i = ends.length; ends.push(0); }
    ends[i] = b.e;
    return { ...b, lane: i };
  });
}

/**
 * planner — эталон «планировщик цеха» (C041 Э2, C053 Э2): строки — люди или заказы (можно деревом), полосы — шаги работ, под полосами подсвечена перегрузка дня.
 * Стили — .gt-* (шапка, сетка, «сегодня») и .k-pl-* в kit/timeline.css, цвета видов работ --wt-1..7 в tokens.css.
 *
 * planner({ lead? (элемент в начале панели), rowsTitle? (заголовок колонки строк), rows, bars, load?, from, to, scale?: 'day'|'week'|'month'|'fit', fitWidth?, canEdit?, rowsMovable?, onOpen(bar), onMove(bar, { start, end, rowId }) → Promise, empty?,
 *           expanded?: Set<id>, onToggle?(id, open, set), legend?: [{ id, name, hue }], onScale?(scale), onShift?(±1), onToday?() })
 *   rows  [{ id, label, sub?, cap?, parentId?, drop? }] — строка; cap — часов в день (подсветка перегрузки по load);
 *         parentId → дерево: у узла (есть дети) вместо полос рисуется сводная полоса min..max детей (не двигается), дети скрыты, пока узел не в expanded;
 *         drop — куда переносится полоса, брошенная на эту строку (по умолчанию id; null — сюда бросать нельзя)
 *   bars  [{ id, rowId, start, end, title, sub?, tone?: 'info'|'ok'|'warn'|'danger'|'dim', hue?: 1..7 (цвет вида работ), wt? (id вида работ, для подсветки из легенды),
 *           locked? (не перетаскивается), status?: 'plan'|'work'|'done' (рамка: пунктир / сплошная / бледнее с ✓), overdue? (красная рамка), deadline? ('ГГГГ-ММ-ДД' — ромб срока), ownerId? (что вернуть как rowId, если строку не меняли), hint? }]
 *   load  { [rowId]: { 'ГГГГ-ММ-ДД': часы } } — занятость по дням (видна и на свёрнутой строке человека)
 *   expanded — раскрытые узлы (по умолчанию всё свёрнуто); панель над лентой появляется, если есть onScale/onShift/дерево/legend
 * Перетаскивание (мышь; палец — после долгого нажатия): по горизонтали — сдвиг дат (длительность сохраняется), по вертикали — другая строка.
 * segments задаёт видимые отрезки дней. calendar включает дневные ячейки. period отображает даты, onPickDate выбирает дату.
 * onResize(bar, { start, end }) меняет правый край. Клавиши: ←/→ сдвиг, Shift + ←/→ конец, Enter открыть.
 * → { el, scroller, scrollToDate(date), scrollToToday(flash?), expandAll(), collapseAll() }
 */
const KINDS = ['info', 'ok', 'warn', 'danger', 'dim'];
const STATUSES = { plan: 'запланировано', work: 'в работе', done: 'сделано' };

export function planner({ lead, rowsTitle, rows = [], bars = [], load = {}, from, to, scale = 'week', fitWidth, autoScroll = true, canEdit = false, rowsMovable = false, onOpen, onMove, onResize, empty, expanded, onToggle, legend = [], onScale, onShift, onToday, calendar = false, period, onPickDate, segments } = {}) {
  const min = dayNum(from), max = dayNum(to) + 1;
  const axis = plannerAxis(min, max, segments);
  const days = Math.max(1, axis.dates.length);
  const px = segments ? Math.max(3, (fitWidth || 720) / days)
    : scale === 'fit' ? fitPx(fitWidth || 720, from, to)
      : Math.max((calendar ? CALENDAR_PX : PX)[scale] || PX.week, (fitWidth || 0) / days);
  const W = days * px;
  const dayCols = scale === 'day' || (calendar && scale !== 'fit');
  const coarse = touch(), LANE = coarse ? 44 : 40;
  const today = todayNum();
  const xOf = (n) => axis.column(n) * px;
  const rangeWidth = (s, e) => Math.max(0, xOf(e + 1) - xOf(s));
  const todayX = xOf(today) + px / 2;
  const dailyGrid = dayCols || !!segments;
  const track = (t) => {
    t.style.width = W + 'px';
    t.style.setProperty('--gt-line', (dailyGrid ? px : px * 7) + 'px');
    t.style.setProperty('--gt-off', xOf(dailyGrid ? min : min + ((8 - dow(min)) % 7)) + 'px');
    t.style.setProperty('--gt-day', px + 'px');
    t.style.setProperty('--gt-we', xOf(min + ((13 - dow(min)) % 7)) + 'px');
    return t;
  };

  // шапка: месяцы и числа
  const headers = [], nums = [];
  const weekly = segments && scale === 'week';
  for (const n of axis.dates) {
    const d = new Date(n * 864e5), wd = dow(n), gap = axis.gapBefore.get(n) || 0;
    const key = weekly ? n - ((wd + 6) % 7) : d.getUTCFullYear() * 12 + d.getUTCMonth();
    if (headers.at(-1)?.key !== key || gap) headers.push({ key, date: d, from: n, to: n });
    else headers.at(-1).to = n;
    if (dayCols) {
      const date = isoOf(n), picked = period?.date === date, name = 'Выбрать дату ' + dmy(n);
      const control = onPickDate ? { type: 'button', 'aria-label': name, 'aria-pressed': String(picked), onclick: () => onPickDate(date) } : {};
      const label = !segments || px >= 15 || picked || gap || wd === 1 ? String(d.getUTCDate()) : '';
      const title = gap ? `${name}. Пропущено дней: ${gap}` : name;
      nums.push(h(onPickDate ? 'button' : 'i', { ...control, dataset: { date }, title,
        class: 'gt-n' + (wd === 0 || wd === 6 ? ' we' : '') + (n === today ? ' today' : '') + (picked ? ' is-picked' : ''),
        style: { left: xOf(n) + 'px', width: px + 'px' } }, label, px >= 23 ? h('small', null, WD[wd]) : null));
    } else if ((wd === 1 || gap) && px * 7 >= 28) {
      const width = rangeWidth(n, Math.min(n + 6, max - 1));
      nums.push(h('i', { class: 'gt-n', dataset: { date: isoOf(n) }, style: { left: xOf(n) + 'px', width: width + 'px' } }, String(d.getUTCDate())));
    }
  }
  const headerNode = ({ date, from, to }) => {
    const width = rangeWidth(from, to), month = MONTHS[date.getUTCMonth()];
    const label = weekly ? dmy(from).slice(0, 5) + ' — ' + dmy(to).slice(0, 5)
      : width > 70 ? month + ' ' + date.getUTCFullYear() : month.slice(0, 3);
    return h('i', { class: 'gt-mo', style: { left: xOf(from) + 'px', width: width + 'px' } }, label);
  };
  const head = h('div', { class: 'gt-row gt-head' }, h('div', { class: 'gt-label' }, rowsTitle || 'Строки'),
    track(h('div', { class: 'gt-track gt-head-track' },
      h('div', { class: 'gt-months' }, ...headers.map(headerNode)),
      h('div', { class: 'gt-nums' }, ...nums))));

  // полосы по строкам и дерево
  const byRow = new Map(rows.map((r) => [String(r.id), []]));
  for (const b of bars) {
    const s = dayNum(b.start), e = dayNum(b.end) ?? s;
    if (s === null || !rangeWidth(s, Math.max(s, e)) || !byRow.has(String(b.rowId))) continue;
    byRow.get(String(b.rowId)).push({ b, s, e: Math.max(s, e), dl: dayNum(b.deadline), over: !!b.overdue });
  }
  const tree = buildTree(rows, byRow);
  const open = new Set([...(expanded || [])].map(String));
  const body = h('div', { class: 'gt-body' });
  const grid = h('div', { class: 'gt-grid' }, head, body);
  const rowEls = [];
  let hl = '';

  const diamond = (dl, late, tr, seen) => {
    if (!axis.has(dl) || seen.has(dl)) return;
    seen.add(dl);
    const d = h('i', { class: 'k-pl-dl' + (late ? ' over' : ''), title: 'Срок: ' + dmy(dl) + (late ? ' — работы заходят за срок' : '') });
    d.style.left = xOf(dl) + px / 2 + 'px'; tr.append(d);
  };

  function barNode(it, rowEl, nLanes) {
    const { b, s, e, lane } = it;
    const width = rangeWidth(s, e);
    const st = b.status === 'done' || b.status === 'work' || b.status === 'plan' ? b.status : '';
    const editable = canEdit && !b.locked && st !== 'done';
    const resizable = editable && !!onResize && axis.has(e);
    const state = [STATUSES[st], b.overdue && 'просрочено'].filter(Boolean).join(', ');
    const cls = ['gt-bar k-pl-bar', b.hue ? 'hue wt-' + b.hue : KINDS.includes(b.tone) ? b.tone : 'info', st ? 'st-' + st : '', b.overdue ? 'late' : '', editable ? 'drag' : '', resizable ? 'resizable' : '', width < Math.max(72, String(b.title).length * 7 + 16) ? 'narrow' : ''].filter(Boolean).join(' ');
    const node = h('button', { type: 'button', class: cls, 'data-bar': String(b.id), 'data-wt': b.wt == null ? null : String(b.wt),
      title: [b.title, b.sub, `${dmy(s)} — ${dmy(e)}`, state, b.hint, editable ? 'Потяните, чтобы переставить' : '', resizable ? 'Правый край или Shift + ←/→ — изменить конец' : ''].filter(Boolean).join('\n'),
      'aria-keyshortcuts': resizable ? 'Shift+ArrowLeft Shift+ArrowRight' : null,
      'aria-label': `${b.title}, ${dmy(s)} — ${dmy(e)}${state ? ', ' + state : ''}. Открыть` },
      h('span', { class: 'gt-bt' }, (st === 'done' ? '✓ ' : '') + b.title), b.sub && width >= 120 ? h('small', { class: 'k-pl-sub' }, b.sub) : null);
    node.style.left = xOf(Math.max(s, min)) + 'px';
    node.style.width = width + 'px';
    node.style.top = `calc(50% + ${(lane - (nLanes - 1) / 2) * LANE}px)`;
    if (hl) node.classList.toggle('hl-on', String(b.wt) === hl);
    let moved = false;
    node.addEventListener('click', (ev) => { if (moved) { moved = false; ev.preventDefault(); return; } onOpen?.(b); });
    if (resizable) bindResize(node, b, s, e);
    if (editable) {
      bindDrag(node, b, s, e, rowEl, () => { moved = true; });
      node.addEventListener('keydown', (ev) => {
        if ((ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        ev.preventDefault();
        const d = ev.key === 'ArrowRight' ? 1 : -1;
        if (ev.shiftKey) {
          if (resizable && e + d >= s) run(node, onResize, b, { start: isoOf(s), end: isoOf(e + d) });
        } else run(node, onMove, b, { start: isoOf(s + d), end: isoOf(e + d), rowId: b.ownerId ?? b.rowId });
      });
    }
    return node;
  }

  async function run(node, action, b, to2, revert) {
    node.classList.add('is-busy'); node.disabled = true;
    try { await action?.(b, to2); } catch { revert?.(); }
    finally { node.classList.remove('is-busy'); node.disabled = false; }
  }

  function bindResize(node, bar, start, originalEnd) {
    const handle = h('span', { class: 'gt-h', 'aria-hidden': 'true', title: 'Изменить конец работы' });
    node.append(handle);
    handle.addEventListener('click', (event) => { event.stopPropagation(); event.preventDefault(); });
    handle.addEventListener('pointerdown', (event) => {
      if (event.button > 0 || node.disabled) return;
      event.stopPropagation();
      event.preventDefault();
      const x = event.clientX, width = node.style.width;
      let end = originalEnd;
      handle.setPointerCapture(event.pointerId);
      node.classList.add('resizing');
      const preview = (move) => {
        end = Math.max(start, axis.shift(originalEnd, Math.round((move.clientX - x) / px)));
        node.style.width = rangeWidth(start, end) + 'px';
        node.dataset.hint = dmy(end);
      };
      const finish = (done) => {
        handle.removeEventListener('pointermove', preview);
        handle.removeEventListener('pointerup', finish);
        handle.removeEventListener('lostpointercapture', finish);
        node.classList.remove('resizing');
        delete node.dataset.hint;
        node.style.width = width;
        if (done.type === 'pointerup' && end !== originalEnd) run(node, onResize, bar, { start: isoOf(start), end: isoOf(end) });
      };
      handle.addEventListener('pointermove', preview);
      handle.addEventListener('pointerup', finish, { once: true });
      handle.addEventListener('lostpointercapture', finish, { once: true });
    });
  }

  function bindDrag(node, b, s, e, rowEl, markMoved) {
    node.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button > 0) return;
      const x0 = ev.clientX, y0 = ev.clientY; let dx = 0, dragging = false, target = rowEl, armed = ev.pointerType !== 'touch', tmr = null;
      const hold = (t) => { if (armed) t.preventDefault(); };
      if (!armed) { tmr = setTimeout(() => { armed = true; if (navigator.vibrate) navigator.vibrate(15); node.classList.add('armed'); }, 400); node.addEventListener('touchmove', hold, { passive: false }); }
      try { node.setPointerCapture(ev.pointerId); } catch { /* */ }
      const left0 = parseFloat(node.style.left);
      const rowAt = (cx, cy) => {
        node.style.pointerEvents = 'none';
        const hit = document.elementsFromPoint(cx, cy).find((el) => !el.closest('.toasts'));
        node.style.pointerEvents = '';
        const row = hit?.closest('.k-pl-row');
        return row?.dataset.drop && rowEls.includes(row) ? row : null;
      };
      const mv = (m) => {
        const ddx = m.clientX - x0, ddy = m.clientY - y0;
        if (!armed) { if (Math.abs(ddx) > 8 || Math.abs(ddy) > 8) { clearTimeout(tmr); tmr = null; } return; }
        if (!dragging && Math.abs(ddx) < 4 && Math.abs(ddy) < 4) return;
        dragging = true; node.classList.add('dragging');
        const hit = rowsMovable ? rowAt(m.clientX, m.clientY) || rowEl : rowEl;
        if (hit !== target) { target?.classList.remove('drop'); target = hit; }
        const slots = target === rowEl ? Math.round(ddx / px) : 0;
        dx = axis.shift(s, slots) - s;
        node.style.left = left0 + slots * px + 'px';
        if (rowsMovable) { target?.classList.toggle('drop', target !== rowEl); node.style.transform = `translateY(${target.getBoundingClientRect().top - rowEl.getBoundingClientRect().top}px)`; }
        node.dataset.hint = dmy(s + dx) + (target !== rowEl ? ' · ' + (target.dataset.label || '') : '');
      };
      const end = async (cancel) => {
        clearTimeout(tmr); node.classList.remove('armed'); node.removeEventListener('touchmove', hold);
        node.removeEventListener('pointermove', mv); node.removeEventListener('pointerup', up); node.removeEventListener('pointercancel', cn);
        try { node.releasePointerCapture(ev.pointerId); } catch { /* */ }
        rowEls.forEach((r) => r.classList.remove('drop')); node.classList.remove('dragging'); delete node.dataset.hint;
        if (!dragging) return;
        markMoved();
        const back = () => { node.style.left = left0 + 'px'; node.style.transform = ''; };
        if (cancel || (dx === 0 && target === rowEl)) { back(); return; }
        await run(node, onMove, b, { start: isoOf(s + dx), end: isoOf(e + dx), rowId: target === rowEl ? b.ownerId ?? b.rowId : target.dataset.drop }, back);
      };
      const up = () => end(false), cn = () => end(true);
      node.addEventListener('pointermove', mv); node.addEventListener('pointerup', up); node.addEventListener('pointercancel', cn);
    });
  }

  /** Одна строка: подпись (у узла — кнопка-шеврон) и дорожка с полосами / сводной полосой. */
  function rowNode({ row: r, depth, node, open: isOpen }) {
    const own = lanes(byRow.get(String(r.id)));
    const sum = node ? tree.range(r.id) : null;
    const nLanes = node ? 1 : Math.max(1, ...own.map((i) => i.lane + 1));
    const ld = Object.fromEntries(Object.entries(load[r.id] || {}).filter(([date]) => axis.has(dayNum(date))));
    const over = r.cap ? Object.values(ld).filter((v) => v > r.cap).length : 0;
    const full = r.cap ? Object.values(ld).filter((v) => v <= r.cap && v >= r.cap * 0.8).length : 0;
    const text = [h('b', null, r.label), r.sub || over || full ? h('small', { class: 'gt-ttitle' + (over ? ' over' : '') }, over ? `перегрузка: ${over} дн.` : full ? `почти полно: ${full} дн.` : r.sub) : null];
    const label = node
      ? h('button', { type: 'button', class: 'gt-label k-pl-label k-pl-node', title: r.label, 'aria-expanded': String(isOpen), 'aria-label': `${r.label}: ${isOpen ? 'свернуть' : 'раскрыть'}`, onclick: () => toggle(String(r.id)) }, h('i', { class: 'k-pl-chev', 'aria-hidden': 'true' }), h('span', { class: 'k-pl-lt' }, ...text))
      : h('div', { class: 'gt-label k-pl-label' + (tree.hasKids ? ' k-pl-leaf' : ''), title: r.label }, h('span', { class: 'k-pl-lt' }, ...text));
    label.style.setProperty('--gt-d', String(Math.min(depth, coarse ? 3 : 5)));
    const tr = track(h('div', { class: 'gt-track' }));
    if (r.cap) for (const [iso, hrs] of Object.entries(ld)) {
      const n = dayNum(iso); if (!(hrs > 0)) continue;
      const tone = hrs > r.cap ? 'over' : hrs >= r.cap * 0.8 ? 'full' : '';
      if (!tone) continue;
      const cell = h('i', { class: 'k-pl-load ' + tone, title: `${iso.split('-').reverse().join('.')}: ${Math.round(hrs * 10) / 10} из ${r.cap} ч` });
      cell.style.left = xOf(n) + 'px'; cell.style.width = px + 'px'; tr.append(cell);
    }
    const drop = r.drop === undefined ? String(r.id) : r.drop;
    const rowEl = h('div', { class: 'gt-row k-pl-row' + (node ? ' gt-group' : ''), 'data-row': String(r.id), 'data-drop': drop == null ? null : String(drop), 'data-label': r.label }, label, tr);
    rowEl.style.minHeight = 8 + nLanes * LANE + 'px';
    const seen = new Set();
    if (sum) {
      for (const [start, end] of axis.pieces(sum.s, sum.e)) {
        const bar = h('div', { class: 'gt-bar sum k-pl-sum lv' + Math.min(depth, 2) + (sum.over ? ' over' : ''), title: `${r.label}: ${dmy(sum.s)} — ${dmy(sum.e)} · шагов: ${sum.n}` });
        bar.style.left = xOf(start) + 'px'; bar.style.width = rangeWidth(start, end) + 'px'; tr.append(bar);
      }
      diamond(sum.dl, sum.dl != null && (sum.e > sum.dl || sum.over), tr, seen);
    } else for (const it of own) { tr.append(barNode(it, rowEl, nLanes)); if (!r.parentId) diamond(it.dl, it.over || (it.dl != null && it.e > it.dl), tr, seen); } // в дереве срок — ромбом только на строке-узле (не дублировать)
    return rowEl;
  }

  function renderRows() {
    rowEls.length = 0;
    for (const v of visible(tree, open)) rowEls.push(rowNode(v));
    body.replaceChildren(...rowEls);
  }
  function toggle(id) {
    if (open.has(id)) open.delete(id); else open.add(id);
    renderRows();
    body.querySelector(`.k-pl-row[data-row="${CSS.escape(id)}"] .k-pl-node`)?.focus();
    onToggle?.(id, open.has(id), open);
  }
  function setAll(on) {
    open.clear();
    if (on) tree.parents.forEach((id) => open.add(id));
    renderRows(); onToggle?.(null, on, open);
  }
  renderRows();
  grid.style.width = `calc(var(--gt-label) + ${W}px)`;
  if (axis.weekend) grid.style.setProperty('--gt-shown-weekends', axis.weekend);
  for (const [n, gap] of axis.gapBefore) {
    const marker = h('div', { class: 'gt-gap', dataset: { gapDays: String(gap) }, 'aria-hidden': 'true' });
    marker.style.left = `calc(var(--gt-label) + ${xOf(n)}px)`;
    grid.append(marker);
  }
  let line = null;
  if (axis.has(today)) { line = h('div', { class: 'gt-today', 'aria-hidden': 'true', title: 'Сегодня, ' + dmy(today) }); line.style.left = `calc(var(--gt-label) + ${todayX}px)`; grid.append(line); }

  const scroller = h('div', { class: 'gt-scroll', tabindex: '-1' }, grid);
  const wrap = h('div', { class: 'gt-wrap k-planner' + (tree.hasKids ? ' tree' : '') + (axis.weekend ? ' gt-discrete' : '') });
  const scrollToDay = (n, flash) => requestAnimationFrame(() => {
    const labelWidth = scroller.querySelector('.gt-label')?.offsetWidth || 0;
    scroller.scrollLeft = Math.max(0, xOf(n) + px / 2 - (scroller.clientWidth - labelWidth) / 2);
    if (flash && line) { line.classList.remove('flash'); void line.offsetWidth; line.classList.add('flash'); }
  });
  const scrollToToday = (flash) => scrollToDay(today, flash);
  const scrollToDate = (date) => {
    const n = dayNum(date);
    if (n != null) scrollToDay(axis.dates[Math.min(days - 1, axis.column(n))]);
  };
  const toToday = () => { if (!calendar && rows.length && today >= min && today < max) scrollToToday(true); else onToday?.(); };
  const paintBar = () => {
    const bar = plannerBar({ lead, scale, onScale, onShift, onToday: toToday, period, tree: tree.hasKids, onAll: setAll, legend, hl, onHl: (id) => { hl = id; paintBar(); applyHl(); } });
    wrap.replaceChildren(...[bar, rows.length && canEdit && coarse ? h('p', { class: 'k-pl-hint' }, 'Удерживайте полосу, чтобы переставить.') : null, rows.length ? scroller : empty || null].filter(Boolean));
  };
  function applyHl() {
    wrap.classList.toggle('hl', !!hl);
    for (const n of scroller.querySelectorAll('.k-pl-bar')) n.classList.toggle('hl-on', !!hl && n.dataset.wt === hl);
  }
  paintBar();
  const el = mark(wrap, 'planner');
  if (autoScroll) scrollToToday();
  return { el, scroller, scrollToDate, scrollToToday, expandAll: () => setAll(true), collapseAll: () => setAll(false) };
}
