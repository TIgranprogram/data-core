import { h } from '../../core/dom.js';
import { mark } from './mark.js';
import { plannerBar } from './planner-bar.js';
import { buildTree, visible } from './planner-tree.js';

const PX = { day: 36, week: 18, month: 6 };
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
export const fitPx = (width, from, to) => Math.max(4, Math.floor((Number(width) || 0) / Math.max(1, (dayNum(to) ?? 0) - (dayNum(from) ?? 0) + 1)));

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
 * Клавиши на полосе: ←/→ сдвиг на день, Enter — открыть. Ошибка onMove — полоса возвращается на место.
 * → { el, scroller, scrollToToday(flash?), expandAll(), collapseAll() }
 */
const KINDS = ['info', 'ok', 'warn', 'danger', 'dim'];

export function planner({ lead, rowsTitle, rows = [], bars = [], load = {}, from, to, scale = 'week', fitWidth, canEdit = false, rowsMovable = false, onOpen, onMove, empty, expanded, onToggle, legend = [], onScale, onShift, onToday } = {}) {
  const px = scale === 'fit' ? fitPx(fitWidth || 720, from, to) : PX[scale] || PX.week;
  const dayCols = scale === 'day';
  const coarse = touch(), LANE = coarse ? 44 : 32;
  const min = dayNum(from), max = Math.max(dayNum(to) + 1, scale !== 'fit' && fitWidth ? min + Math.ceil(fitWidth / px) : 0), W = (max - min) * px; // лента не короче окна — справа нет пустого поля
  const today = todayNum();
  const xOf = (n) => (n - min) * px;
  const todayX = xOf(today) + px / 2;
  const track = (t) => { t.style.width = W + 'px'; t.style.setProperty('--gt-line', (dayCols ? px : px * 7) + 'px'); t.style.setProperty('--gt-off', xOf(dayCols ? min : min + ((8 - dow(min)) % 7)) + 'px'); t.style.setProperty('--gt-day', px + 'px'); t.style.setProperty('--gt-we', xOf(min + ((13 - dow(min)) % 7)) + 'px'); return t; }; // --gt-we — первая суббота: выходные полосой и в строках

  // шапка: месяцы и числа
  const months = []; const nums = [];
  for (let n = min; n < max; n++) {
    const d = new Date(n * 864e5), wd = dow(n);
    if (!months.length || months[months.length - 1].m !== d.getUTCMonth()) months.push({ m: d.getUTCMonth(), y: d.getUTCFullYear(), from: n, to: n + 1 }); else months[months.length - 1].to = n + 1;
    if (dayCols) nums.push(h('i', { class: 'gt-n' + (wd === 0 || wd === 6 ? ' we' : '') + (n === today ? ' today' : ''), style: { left: xOf(n) + 'px', width: px + 'px' } }, String(d.getUTCDate()), h('small', null, WD[wd])));
    else if (wd === 1 && px * 7 >= 28) nums.push(h('i', { class: 'gt-n', style: { left: xOf(n) + 'px', width: px * 7 + 'px' } }, String(d.getUTCDate())));
  }
  const head = h('div', { class: 'gt-row gt-head' }, h('div', { class: 'gt-label' }, rowsTitle || 'Строки'),
    track(h('div', { class: 'gt-track gt-head-track' },
      h('div', { class: 'gt-months' }, ...months.map((x) => h('i', { class: 'gt-mo', style: { left: xOf(x.from) + 'px', width: (x.to - x.from) * px + 'px' } }, (x.to - x.from) * px > 70 ? MONTHS[x.m] + ' ' + x.y : MONTHS[x.m].slice(0, 3)))),
      h('div', { class: 'gt-nums' }, ...nums))));

  // полосы по строкам и дерево
  const byRow = new Map(rows.map((r) => [String(r.id), []]));
  for (const b of bars) {
    const s = dayNum(b.start), e = dayNum(b.end) ?? s;
    if (s === null || !byRow.has(String(b.rowId))) continue;
    byRow.get(String(b.rowId)).push({ b, s, e: Math.max(s, e), dl: dayNum(b.deadline), over: !!b.overdue });
  }
  const tree = buildTree(rows, byRow);
  const open = new Set([...(expanded || [])].map(String));
  const body = h('div', { class: 'gt-body' });
  const grid = h('div', { class: 'gt-grid' }, head, body);
  const rowEls = [];
  let hl = '';

  const diamond = (dl, late, tr, seen) => {
    if (dl == null || dl < min || dl >= max || seen.has(dl)) return;
    seen.add(dl);
    const d = h('i', { class: 'k-pl-dl' + (late ? ' over' : ''), title: 'Срок: ' + dmy(dl) + (late ? ' — работы заходят за срок' : '') });
    d.style.left = xOf(dl) + px / 2 + 'px'; tr.append(d);
  };

  function barNode(it, rowEl) {
    const { b, s, e, lane } = it;
    const len = e - s + 1;
    const st = b.status === 'done' || b.status === 'work' || b.status === 'plan' ? b.status : '';
    const cls = ['gt-bar k-pl-bar', b.hue ? 'hue wt-' + b.hue : KINDS.includes(b.tone) ? b.tone : 'info', st ? 'st-' + st : '', b.overdue ? 'late' : '', canEdit && !b.locked ? 'drag' : '', len * px < 72 ? 'narrow' : ''].filter(Boolean).join(' '); // narrow — подпись справа от полосы (как в kppdf), не «И…»
    const node = h('button', { type: 'button', class: cls, 'data-bar': String(b.id), 'data-wt': b.wt == null ? null : String(b.wt),
      title: [b.title, b.sub, `${dmy(s)} — ${dmy(e)}`, b.hint, canEdit && !b.locked ? 'Потяните, чтобы переставить' : b.locked ? 'Задание без плана позиции — нажмите, чтобы открыть' : ''].filter(Boolean).join('\n'),
      'aria-label': `${b.title}, ${dmy(s)} — ${dmy(e)}${st === 'done' ? ', сделано' : b.overdue ? ', просрочено' : ''}. Открыть` },
      h('span', { class: 'gt-bt' }, (st === 'done' ? '✓ ' : '') + b.title), b.sub && len * px >= 120 ? h('small', { class: 'k-pl-sub' }, b.sub) : null); // узкая полоса — одна строка, подробности в подсказке
    node.style.left = xOf(s) + 'px'; node.style.width = Math.max(coarse ? 44 : 10, len * px - 2) + 'px'; node.style.top = 4 + lane * LANE + 'px';
    if (hl) node.classList.toggle('hl-on', String(b.wt) === hl);
    let moved = false;
    node.addEventListener('click', (ev) => { if (moved) { moved = false; ev.preventDefault(); return; } onOpen?.(b); });
    if (canEdit && !b.locked) { // locked — полоса только для просмотра (задание без плана позиции)
      bindDrag(node, b, s, e, rowEl, () => { moved = true; });
      node.addEventListener('keydown', (ev) => {
        if ((ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') || ev.ctrlKey || ev.metaKey || ev.altKey) return;
        ev.preventDefault();
        const d = ev.key === 'ArrowRight' ? 1 : -1;
        run(node, b, { start: isoOf(s + d), end: isoOf(e + d), rowId: b.ownerId ?? b.rowId }, () => {});
      });
    }
    return node;
  }

  async function run(node, b, to2, revert) {
    node.classList.add('is-busy'); node.disabled = true;
    try { await onMove?.(b, to2); } catch { revert(); node.classList.remove('is-busy'); node.disabled = false; }
  }

  function bindDrag(node, b, s, e, rowEl, markMoved) {
    node.addEventListener('pointerdown', (ev) => {
      if (ev.button !== undefined && ev.button > 0) return;
      const x0 = ev.clientX, y0 = ev.clientY; let dx = 0, dragging = false, target = rowEl, armed = ev.pointerType !== 'touch', tmr = null;
      const hold = (t) => { if (armed) t.preventDefault(); };
      if (!armed) { tmr = setTimeout(() => { armed = true; if (navigator.vibrate) navigator.vibrate(15); node.classList.add('armed'); }, 400); node.addEventListener('touchmove', hold, { passive: false }); }
      try { node.setPointerCapture(ev.pointerId); } catch { /* */ }
      const left0 = parseFloat(node.style.left);
      const rowAt = (cx, cy) => { node.style.pointerEvents = 'none'; const t = document.elementFromPoint(cx, cy)?.closest('.k-pl-row'); node.style.pointerEvents = ''; return t && t.dataset.drop ? t : null; };
      const mv = (m) => {
        const ddx = m.clientX - x0, ddy = m.clientY - y0;
        if (!armed) { if (Math.abs(ddx) > 8 || Math.abs(ddy) > 8) { clearTimeout(tmr); tmr = null; } return; }
        if (!dragging && Math.abs(ddx) < 4 && Math.abs(ddy) < 4) return;
        dragging = true; node.classList.add('dragging');
        dx = Math.round(ddx / px);
        node.style.left = left0 + dx * px + 'px';
        const hit = rowsMovable ? rowAt(m.clientX, m.clientY) || rowEl : rowEl;
        if (hit !== target) { target?.classList.remove('drop'); target = hit; }
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
        await run(node, b, { start: isoOf(s + dx), end: isoOf(e + dx), rowId: target === rowEl ? b.ownerId ?? b.rowId : target.dataset.drop }, back);
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
    const ld = load[r.id] || {};
    const over = r.cap ? Object.values(ld).filter((v) => v > r.cap).length : 0;
    const full = r.cap ? Object.values(ld).filter((v) => v <= r.cap && v >= r.cap * 0.8).length : 0;
    const text = [h('b', null, r.label), r.sub || over || full ? h('small', { class: 'gt-ttitle' + (over ? ' over' : '') }, over ? `перегрузка: ${over} дн.` : full ? `почти полно: ${full} дн.` : r.sub) : null];
    const label = node
      ? h('button', { type: 'button', class: 'gt-label k-pl-label k-pl-node', title: r.label, 'aria-expanded': String(isOpen), 'aria-label': `${r.label}: ${isOpen ? 'свернуть' : 'раскрыть'}`, onclick: () => toggle(String(r.id)) }, h('i', { class: 'k-pl-chev', 'aria-hidden': 'true' }), h('span', { class: 'k-pl-lt' }, ...text))
      : h('div', { class: 'gt-label k-pl-label' + (tree.hasKids ? ' k-pl-leaf' : ''), title: r.label }, h('span', { class: 'k-pl-lt' }, ...text));
    label.style.setProperty('--gt-d', String(Math.min(depth, coarse ? 3 : 5)));
    const tr = track(h('div', { class: 'gt-track' }));
    if (r.cap) for (const [iso, hrs] of Object.entries(ld)) {
      const n = dayNum(iso); if (n === null || n < min || n >= max || !(hrs > 0)) continue;
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
      const bar = h('div', { class: 'gt-bar sum k-pl-sum lv' + Math.min(depth, 2) + (sum.over ? ' over' : ''), title: `${r.label}: ${dmy(sum.s)} — ${dmy(sum.e)} · шагов: ${sum.n}` });
      bar.style.left = xOf(sum.s) + 'px'; bar.style.width = Math.max(6, (sum.e - sum.s + 1) * px - 2) + 'px'; tr.append(bar);
      diamond(sum.dl, sum.dl != null && (sum.e > sum.dl || sum.over), tr, seen);
    } else for (const it of own) { tr.append(barNode(it, rowEl)); if (!r.parentId) diamond(it.dl, it.over || (it.dl != null && it.e > it.dl), tr, seen); } // в дереве срок — ромбом только на строке-узле (не дублировать)
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
  let line = null;
  if (today >= min && today < max) { line = h('div', { class: 'gt-today', 'aria-hidden': 'true', title: 'Сегодня, ' + dmy(today) }); line.style.left = `calc(var(--gt-label) + ${todayX}px)`; grid.append(line); }

  const scroller = h('div', { class: 'gt-scroll', tabindex: '-1' }, grid);
  const wrap = h('div', { class: 'gt-wrap k-planner' + (tree.hasKids ? ' tree' : '') });
  const scrollToToday = (flash) => requestAnimationFrame(() => {
    const lab = scroller.querySelector('.gt-label')?.offsetWidth || 0;
    scroller.scrollLeft = Math.max(0, todayX - (scroller.clientWidth + lab) / 2);
    if (flash && line) { line.classList.remove('flash'); void line.offsetWidth; line.classList.add('flash'); }
  });
  const toToday = () => { if (today >= min && today < max) scrollToToday(true); else onToday?.(); };
  const paintBar = () => {
    const bar = plannerBar({ lead, scale, onScale, onShift, onToday: toToday, tree: tree.hasKids, onAll: setAll, legend, hl, onHl: (id) => { hl = id; paintBar(); applyHl(); } });
    wrap.replaceChildren(...[bar, rows.length && canEdit && coarse ? h('p', { class: 'k-pl-hint' }, 'Удерживайте полосу, чтобы переставить.') : null, rows.length ? scroller : empty || null].filter(Boolean));
  };
  function applyHl() {
    wrap.classList.toggle('hl', !!hl);
    for (const n of scroller.querySelectorAll('.k-pl-bar')) n.classList.toggle('hl-on', !!hl && n.dataset.wt === hl);
  }
  paintBar();
  const el = mark(wrap, 'planner');
  scrollToToday();
  return { el, scroller, scrollToToday, expandAll: () => setAll(true), collapseAll: () => setAll(false) };
}
