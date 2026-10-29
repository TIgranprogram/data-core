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

// размеры раскладки
const LBL_W = 150, NW = 176, NH = 54, GX = 64, GY = 56, PAD = 14, REF_GAP = 80;
const colX = (n) => PAD + LBL_W + (n - 1) * (NW + GX);
const rowY = (i) => PAD + i * (NH + GY);

const laneTok = (l) => (l.tok ? `var(--sec-${l.tok})` : 'var(--muted)');
const laneSoft = (l) => (l.tok ? `var(--sec-${l.tok}-soft)` : 'var(--surface-3)');
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);

/** Положение узла: дорожка = строка, номер шага = колонка; справочники (H) — колонка справа. */
export function layout() {
  const rows = LANES.length;
  const maxN = Math.max(...NODES.filter((n) => n.lane !== 'H').map((n) => n.n));
  const refX = colX(maxN) + NW + REF_GAP;
  const pos = {};
  for (const n of NODES) {
    if (n.lane === 'H') pos[n.id] = { x: refX, y: rowY(n.n - 1), n, col: maxN + 1 };
    else pos[n.id] = { x: colX(n.n), y: rowY(LANES.findIndex((l) => l.id === n.lane)), n, col: n.n };
  }
  const refRows = NODES.filter((n) => n.lane === 'H').length;
  return { pos, refX, maxN, width: refX + NW + PAD, height: rowY(Math.max(rows, refRows) - 1) + NH + PAD };
}

/**
 * Ребро идёт только по «коридорам»: горизонтали — в промежутках между рядами, вертикали — в промежутках между колонками.
 * Через узлы линия не проходит. k — номер ребра (небольшой сдвиг, чтобы линии не слипались).
 * Возвращает точки ломаной и позицию подписи.
 */
export function route(a, b, k, L) {
  const off = ((k % 5) - 2) * 4;
  const ax = a.x, ay = a.y, bx = b.x, by = b.y, laneA = a.n.lane, laneB = b.n.lane;
  let pts, label;
  if (laneA === 'H' && laneB === 'H') { // вертикаль справочников: дуга справа
    const x1 = ax + NW, y1 = ay + NH / 2, y2 = by + NH / 2, x2 = x1 + 30;
    pts = [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
    label = { x: x2 + 6, y: (y1 + y2) / 2, anchor: 'start' };
  } else if (laneA === laneB && bx > ax && bx - ax - NW <= GX + 1) { // соседний шаг: прямая, подпись над линией
    const y = ay + NH / 2;
    pts = [[ax + NW, y], [bx, y]];
    label = { x: (ax + NW + bx) / 2, y: ay - 8, anchor: 'middle' };
  } else if (laneA === laneB) { // через один шаг: дуга по коридору над рядом
    const cy = ay - GY / 2 + off, x1 = ax + NW / 2, x2 = bx + NW / 2;
    pts = [[x1, ay], [x1, cy], [x2, cy], [x2, by]];
    label = { x: (x1 + x2) / 2, y: cy - 5, anchor: 'middle' };
  } else if (laneA === 'H') { // справочник: влево по каналу, затем по коридору над целью
    const chX = L.refX - REF_GAP / 2 + off, yb = by - GY / 2 + off, ex = bx + NW / 2, sy = ay + NH / 2;
    pts = [[ax, sy], [chX, sy], [chX, yb], [ex, yb], [ex, by]];
    label = { x: (chX + ex) / 2, y: yb - 5, anchor: 'middle' };
  } else {
    const rowA = Math.round((ay - PAD) / (NH + GY)), rowB = Math.round((by - PAD) / (NH + GY));
    const down = rowB > rowA, sx = ax + NW / 2, ex = bx + NW / 2;
    const sy = down ? ay + NH : ay, ey = down ? by : by + NH;
    const ya = down ? ay + NH + GY / 2 + off : ay - GY / 2 + off;
    const yb = down ? by - GY / 2 + off : by + NH + GY / 2 + off;
    if (Math.abs(rowA - rowB) === 1) {
      pts = [[sx, sy], [sx, ya], [ex, ya], [ex, ey]];
      label = { x: (sx + ex) / 2, y: ya - 5, anchor: 'middle' };
    } else { // через ряды: вертикаль по каналу между колонками
      const chX = colX(Math.min(a.col, b.col)) + NW + GX / 2 + off;
      pts = [[sx, sy], [sx, ya], [chX, ya], [chX, yb], [ex, yb], [ex, ey]];
      const l1 = Math.abs(chX - sx), l2 = Math.abs(ex - chX);
      label = l1 >= l2 ? { x: (sx + chX) / 2, y: ya - 5, anchor: 'middle' } : { x: (chX + ex) / 2, y: yb - 5, anchor: 'middle' };
    }
  }
  return { pts, label };
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
  const L = layout();
  const laneOf = Object.fromEntries(LANES.map((l) => [l.id, l]));
  laneOf.H = { id: 'H', name: 'Справочники', tok: null };
  const svg = s('svg', { class: 'hp-svg', viewBox: `0 0 ${L.width} ${L.height}`, width: L.width, height: L.height, role: 'img', 'aria-label': 'Схема: как связаны заказ, проектирование, снабжение, склад, отгрузка, паспорт и деньги' });
  svg.append(s('defs', null,
    s('marker', { id: 'hp-arr', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0,0 L10,5 L0,10 z', class: 'hp-arrow' }))));
  // полосы дорожек и подписи слева
  LANES.forEach((l, i) => {
    const g = s('g', { style: `--lc:${laneTok(l)};--ls:${laneSoft(l)}` });
    g.append(s('rect', { class: 'hp-band', x: PAD, y: rowY(i) - 6, width: L.refX - PAD - REF_GAP / 2 + 10, height: NH + 12, rx: 10 }));
    g.append(s('text', { class: 'hp-lane', x: PAD + 12, y: rowY(i) + NH / 2 + 4 }, clip(l.name, 18)));
    svg.append(g);
  });
  // колонка справочников
  const refs = s('g', { style: '--lc:var(--muted);--ls:var(--surface-3)' });
  refs.append(s('rect', { class: 'hp-band hp-band-ref', x: L.refX - 14, y: PAD - 10, width: NW + 28, height: L.height - 2 * PAD + 20, rx: 10 }));
  svg.append(refs);
  // рёбра — под узлами; подписи с подложкой
  const edges = s('g'), labels = s('g');
  EDGES.forEach((e, k) => {
    const a = L.pos[e.from], b = L.pos[e.to];
    if (!a || !b) return;
    const r = route(a, b, k, L);
    edges.append(s('path', { class: 'hp-edge' + (e.dashed ? ' is-dashed' : ''), d: pathD(r.pts), 'marker-end': 'url(#hp-arr)' }));
    if (e.label) labels.append(s('text', { class: 'hp-elabel', x: r.label.x, y: r.label.y, 'text-anchor': r.label.anchor }, e.label));
  });
  svg.append(edges, labels);
  // узлы — поверх линий, с заливкой
  for (const id of Object.keys(L.pos)) {
    const { x, y, n } = L.pos[id];
    const l = laneOf[n.lane];
    svg.append(s('g', { class: 'hp-node', style: `--lc:${laneTok(l)};--ls:${laneSoft(l)}`, 'data-id': id, transform: `translate(${x},${y})` },
      s('title', null, `${n.label} — Меню: ${n.where}`),
      s('rect', { width: NW, height: NH, rx: 9 }),
      s('text', { class: 'hp-t', x: NW / 2, y: 22, 'text-anchor': 'middle' }, clip(n.label, 22)),
      s('text', { class: 'hp-w', x: NW / 2, y: 40, 'text-anchor': 'middle' }, clip(n.where, 27))));
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
