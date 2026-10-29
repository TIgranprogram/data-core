// «Работа с сайтом» (#help): «С чего начать?» + карта-схема. Данные — help-flow-data.js; раскладка считается здесь.
import { h } from '../core/dom.js';
import { SCENARIOS, LANES, NODES, EDGES } from './help-flow-data.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs, ...kids) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null) el.setAttribute(k, v);
  for (const k of kids.flat()) if (k != null) el.append(k);
  return el;
};

// размеры раскладки. Ширина колонки — по самому длинному тексту в ней (7.2 px/символ для 12px, 8.2 — для 14px bold).
const LBL_W = 150, NW_MIN = 176, NH = 54, GX = 72, GY = 72, PAD = 14, REF_GAP = 56, REF_HEAD = 30;
const nodeW = (n) => Math.max(NW_MIN, Math.ceil(Math.max(n.label.length * 8.2, n.where.length * 7.2) + 24));
const LBL_PX = 7.6, LBL_H = 16; // подписи рёбер: 12px, 600

const laneTok = (l) => (l.tok ? `var(--sec-${l.tok})` : 'var(--muted)');
const laneSoft = (l) => (l.tok ? `var(--sec-${l.tok}-soft)` : 'var(--surface-3)');

/** Перенос названия дорожки по словам (≤ max символов в строке). */
function wrap(t, max) {
  const out = [];
  for (const w of t.split(' ')) {
    const last = out[out.length - 1];
    if (last && (last + ' ' + w).length <= max) out[out.length - 1] = last + ' ' + w; else out.push(w);
  }
  return out;
}

/** Положение узлов: дорожка = строка, шаг = колонка; справочники (H) — список справа, без линий. */
export function layout() {
  const steps = NODES.filter((n) => n.lane !== 'H'), refsN = NODES.filter((n) => n.lane === 'H').sort((a, b) => a.n - b.n);
  const maxN = Math.max(...steps.map((n) => n.n));
  const colW = Array.from({ length: maxN }, (_, i) => Math.max(NW_MIN, ...steps.filter((n) => n.n === i + 1).map(nodeW)));
  const colX = [PAD + LBL_W];
  for (let i = 1; i < maxN; i++) colX.push(colX[i - 1] + colW[i - 1] + GX);
  const rowY = (i) => PAD + i * (NH + GY);
  const right = colX[maxN - 1] + colW[maxN - 1];
  const refX = right + REF_GAP, refW = Math.max(NW_MIN, ...refsN.map(nodeW)), refH = 46, refGap = 10;
  const pos = {};
  for (const n of steps) {
    const c = n.n - 1, row = LANES.findIndex((l) => l.id === n.lane);
    pos[n.id] = { x: colX[c], y: rowY(row), w: colW[c], h: NH, n, col: c, row };
  }
  refsN.forEach((n, i) => { pos[n.id] = { x: refX, y: PAD + REF_HEAD + i * (refH + refGap), w: refW, h: refH, n, ref: true }; });
  const lanesH = rowY(LANES.length - 1) + NH;
  const refsH = PAD + REF_HEAD + refsN.length * (refH + refGap) - refGap;
  return { pos, colX, colW, rowY, right, refX, refW, maxN, width: refX + refW + PAD + 4, height: Math.max(lanesH, refsH) + PAD };
}

/**
 * Ребро идёт только по коридорам: горизонтали — между рядами, вертикали — в промежутках между колонками.
 * Внутри дорожки — прямая слева направо. k — номер межрядного ребра (сдвиг, чтобы линии не слипались).
 */
export function route(a, b, k, L) {
  if (a.row === b.row) { const y = a.y + NH / 2; return [[a.x + a.w, y], [b.x, y]]; }
  const off = ((k % 3) - 1) * 8;
  const down = b.row > a.row, sx = a.x + a.w / 2 + off, ex = b.x + b.w / 2 - off;
  const sy = down ? a.y + NH : a.y, ey = down ? b.y : b.y + NH;
  const ya = down ? a.y + NH + GY / 2 + off : a.y - GY / 2 + off;
  const yb = down ? b.y - GY / 2 + off : b.y + NH + GY / 2 + off;
  if (Math.abs(a.row - b.row) === 1) return [[sx, sy], [sx, ya], [ex, ya], [ex, ey]];
  // через ряды: вертикаль в промежутке между колонками (справа от левой из двух; одна колонка — слева от неё)
  const c = a.col === b.col ? Math.max(0, a.col - 1) : Math.min(a.col, b.col);
  const chX = L.colX[c] + L.colW[c] + GX / 2 + off;
  return [[sx, sy], [sx, ya], [chX, ya], [chX, yb], [ex, yb], [ex, ey]];
}

// геометрия для проверок: отрезок (оси) × прямоугольник, прямоугольник × прямоугольник
export const segHitsRect = ([x1, y1], [x2, y2], r) => {
  if (x1 === x2) return x1 > r.x && x1 < r.x + r.w && Math.max(y1, y2) > r.y && Math.min(y1, y2) < r.y + r.h;
  return y1 > r.y && y1 < r.y + r.h && Math.max(x1, x2) > r.x && Math.min(x1, x2) < r.x + r.w;
};
export const rectsHit = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;

/** Вся геометрия карты. Подпись ребра — у его начала в свободном месте (без линий, узлов и других подписей), иначе не рисуется. */
export function computeMap() {
  const L = layout();
  const edges = [];
  let k = 0;
  for (const e of EDGES) {
    const a = L.pos[e.from], b = L.pos[e.to];
    if (!a || !b || a.ref || b.ref) continue;
    edges.push({ e, pts: route(a, b, a.row === b.row ? 0 : k++, L) });
  }
  const segs = edges.flatMap((ed) => ed.pts.slice(1).map((p, i) => [ed.pts[i], p]));
  const nodeRects = Object.values(L.pos).map((p) => ({ x: p.x, y: p.y, w: p.w, h: p.h }));
  const placed = [];
  const free = (r) => r.x > PAD + LBL_W - 8 && r.x + r.w < L.right + 8 && r.y > 0 && r.y + r.h < L.height
    && !nodeRects.some((n) => rectsHit(r, n)) && !segs.some(([p, q]) => segHitsRect(p, q, r)) && !placed.some((q) => rectsHit(r, q));
  for (const ed of edges) {
    if (!ed.e.label) continue;
    const w = Math.ceil(ed.e.label.length * LBL_PX) + 6, hh = LBL_H, cands = [];
    ed.pts.slice(1).forEach((p, i) => {
      const q = ed.pts[i];
      if (q[1] === p[1]) {
        const x0 = Math.min(q[0], p[0]), x1 = Math.max(q[0], p[0]), dir = p[0] >= q[0] ? 1 : -1;
        for (const t of [0.08, 0.3, 0.55, 0.8]) {
          const cx = dir > 0 ? x0 + (x1 - x0) * t : x1 - (x1 - x0) * t;
          for (const dy of [-hh - 3, 3]) cands.push({ x: dir > 0 ? cx : cx - w, y: q[1] + dy });
        }
      } else {
        const y0 = Math.min(q[1], p[1]), y1 = Math.max(q[1], p[1]);
        for (const t of [0.5, 0.2, 0.8]) for (const dx of [6, -w - 6]) cands.push({ x: q[0] + dx, y: y0 + (y1 - y0) * t - hh / 2 });
      }
    });
    const got = cands.map((c) => ({ x: c.x, y: c.y, w, h: hh })).find(free);
    if (got) { placed.push(got); ed.label = { ...got, text: ed.e.label }; }
  }
  return { L, edges, segs, nodeRects, labels: placed };
}

/** Ломаная со скруглёнными углами. */
function pathD(pts, r = 8) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [cx, cy] = pts[i], [nx, ny] = pts[i + 1];
    const l1 = Math.hypot(cx - px, cy - py), l2 = Math.hypot(nx - cx, ny - cy), rr = Math.min(r, l1 / 2, l2 / 2);
    d += ` L${cx + ((px - cx) / l1) * rr},${cy + ((py - cy) / l1) * rr} Q${cx},${cy} ${cx + ((nx - cx) / l2) * rr},${cy + ((ny - cy) / l2) * rr}`;
  }
  const e = pts[pts.length - 1];
  return d + ` L${e[0]},${e[1]}`;
}

export function mapSvg() {
  const { L, edges } = computeMap();
  const laneOf = Object.fromEntries(LANES.map((l) => [l.id, l]));
  laneOf.H = { id: 'H', name: 'Справочники', tok: null };
  const svg = s('svg', { class: 'hp-svg', viewBox: `0 0 ${L.width} ${L.height}`, width: L.width, height: L.height, role: 'img', 'aria-label': 'Схема: как связаны заказ, проектирование, снабжение, склад, отгрузка, паспорт и деньги' });
  svg.append(s('defs', null,
    s('marker', { id: 'hp-arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'hp-arrow' }))));
  // полосы дорожек и название слева (крупно, перенос по словам)
  LANES.forEach((l, i) => {
    const g = s('g', { style: `--lc:${laneTok(l)};--ls:${laneSoft(l)}` });
    g.append(s('rect', { class: 'hp-band', x: PAD, y: L.rowY(i) - 8, width: L.right - PAD + 12, height: NH + 16, rx: 10 }));
    const lines = wrap(l.name, 13), y0 = L.rowY(i) + NH / 2 + 5 - (lines.length - 1) * 9;
    g.append(s('text', { class: 'hp-lane', x: PAD + 12, y: y0 }, lines.map((t, j) => s('tspan', { x: PAD + 12, dy: j ? 18 : 0 }, t))));
    svg.append(g);
  });
  // справочники — отдельный список без линий
  const refs = s('g', { style: '--lc:var(--muted);--ls:var(--surface-3)' });
  refs.append(s('rect', { class: 'hp-band hp-band-ref', x: L.refX - 12, y: PAD - 8, width: L.refW + 24, height: L.height - 2 * PAD + 14, rx: 10 }));
  refs.append(s('text', { class: 'hp-refhead', x: L.refX, y: PAD + 14 }, 'Используются везде'));
  svg.append(refs);
  const eg = s('g'), lg = s('g');
  for (const ed of edges) {
    eg.append(s('path', { class: 'hp-edge' + (ed.e.dashed ? ' is-dashed' : ''), d: pathD(ed.pts), 'marker-end': 'url(#hp-arr)' }));
    if (ed.label) lg.append(s('text', { class: 'hp-elabel', x: ed.label.x + 3, y: ed.label.y + 12 }, ed.label.text));
  }
  svg.append(eg, lg);
  for (const id of Object.keys(L.pos)) {
    const { x, y, w, h: hh, n, ref } = L.pos[id];
    const l = laneOf[n.lane];
    svg.append(s('g', { class: 'hp-node' + (ref ? ' is-ref' : ''), style: `--lc:${laneTok(l)};--ls:${laneSoft(l)}`, 'data-id': id, transform: `translate(${x},${y})` },
      s('title', null, `${n.label} — Меню: ${n.where}`),
      s('rect', { width: w, height: hh, rx: 9 }),
      s('text', { class: 'hp-t', x: w / 2, y: ref ? 19 : 22, 'text-anchor': 'middle' }, n.label),
      s('text', { class: 'hp-w', x: w / 2, y: ref ? 36 : 40, 'text-anchor': 'middle' }, n.where)));
  }
  return svg;
}

/** На узком экране вместо схемы — шаги по дорожкам. */
function mapList() {
  const box = h('div', { class: 'hp-list' });
  for (const l of [...LANES, { id: 'H', name: 'Справочники', tok: null }]) {
    const nodes = NODES.filter((n) => n.lane === l.id).sort((a, b) => a.n - b.n);
    const steps = nodes.map((n, i) => [i ? h('span', { class: 'hp-arr-s', 'aria-hidden': 'true' }, l.id === 'H' ? '·' : '→') : null,
      h('span', { class: 'hp-step', title: 'Меню: ' + n.where }, h('b', null, n.label), h('small', null, 'Меню: ' + n.where))]);
    box.append(h('div', { class: 'hp-lane-row', style: `--lc:${laneTok(l)};--ls:${laneSoft(l)}` }, h('div', { class: 'hp-lane-name' }, l.name), h('div', { class: 'hp-steps' }, steps)));
  }
  return box;
}

function legend() {
  const sw = (dashed) => s('svg', { width: 44, height: 12, 'aria-hidden': 'true' }, s('path', { class: 'hp-edge' + (dashed ? ' is-dashed' : ''), d: 'M2,6 L38,6', 'marker-end': 'url(#hp-arr)' }));
  return h('div', { class: 'hp-legend' },
    h('span', null, sw(false), ' следующий шаг'),
    h('span', null, sw(true), ' связь или «можно позже»'),
    h('span', null, h('i', { class: 'hp-chip' }), ' цвет — раздел меню; серая строка в блоке — где это в меню'));
}

function scenarioCard(sc) {
  const lane = LANES.find((l) => l.id === sc.lane);
  return h('article', { class: 'hp-card', style: `--lc:${laneTok(lane)};--ls:${laneSoft(lane)}` },
    h('h3', null, sc.want),
    h('div', { class: 'hp-row' }, h('span', { class: 'hp-k' }, 'Начните здесь'), h('a', { href: sc.href }, sc.menu)),
    h('p', null, sc.start),
    h('div', { class: 'hp-row' }, h('span', { class: 'hp-k' }, 'Дальше'), h('span', null, sc.next)),
    sc.later ? h('p', { class: 'hp-later' }, h('b', null, 'Можно потом: '), sc.later) : null,
    sc.strict ? h('p', { class: 'hp-strict' }, h('b', null, 'Порядок важен: '), sc.strict) : null);
}

/** Карта: по умолчанию вписана в ширину целиком; «Крупно» — в натуральный размер, двигать мышкой (зажать и тянуть) или прокруткой. */
function mapBox() {
  const svg = mapSvg();
  const box = h('div', { class: 'hp-map is-fit' }, svg);
  const btn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm' }, '🔍 Крупно');
  const setFit = (fit) => { box.classList.toggle('is-fit', fit); btn.textContent = fit ? '🔍 Крупно' : '⤢ Вся карта'; if (fit) box.scrollTo(0, 0); };
  btn.onclick = () => setFit(!box.classList.contains('is-fit'));
  // перетаскивание мышью в режиме «Крупно»
  let drag = null;
  box.addEventListener('pointerdown', (e) => { if (box.classList.contains('is-fit') || e.button !== 0) return; drag = { x: e.clientX, y: e.clientY, l: box.scrollLeft, t: box.scrollTop }; box.setPointerCapture(e.pointerId); box.classList.add('is-drag'); });
  box.addEventListener('pointermove', (e) => { if (!drag) return; box.scrollLeft = drag.l - (e.clientX - drag.x); box.scrollTop = drag.t - (e.clientY - drag.y); });
  const end = () => { drag = null; box.classList.remove('is-drag'); };
  box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  // клик по карте в режиме «вся карта» — сразу крупно
  box.addEventListener('dblclick', () => setFit(!box.classList.contains('is-fit')));
  return h('div', { class: 'hp-mapwrap' }, h('div', { class: 'hp-maptools' }, btn, h('span', { class: 'muted small' }, 'Двойной щелчок — крупно / вся карта; в «Крупно» карту можно тянуть мышкой')), box);
}

export const help = {
  id: 'help',
  title: 'Работа с сайтом',
  mount(el) {
    el.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Работа с сайтом'), h('span', { class: 'muted small' }, 'Откуда начать и что за чем идёт. Порядок почти везде не строгий — недостающее добавляется позже.')),
      h('section', { class: 'hp-sec' }, h('h2', null, 'С чего начать?'), h('div', { class: 'hp-cards' }, SCENARIOS.map(scenarioCard))),
      h('section', { class: 'hp-sec' }, h('h2', null, 'Карта работы'), legend(), mapBox(), mapList()));
    return {};
  },
};
