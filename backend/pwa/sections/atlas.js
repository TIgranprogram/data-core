// «Карта сайта» (#atlas, кнопка «?» в шапке): весь сайт одной схемой сверху вниз — от заказчика до денег.
// Нажатие на блок не уводит со страницы: справа открывается окно «что внутри» — части раздела, откуда приходят
// сведения, куда уходят, что учитывать при изменении, шаги и где описано (для ИИ). Данные — atlas-data.js.
// Пошаговые инструкции по разделам остались на #help («Работа с сайтом»).
import { h } from '../core/dom.js';
import { guide, button, toolbar, entityPanel, card, tileGrid } from '../ui/kit/index.js';
import { SECTIONS } from './help-guide-data.js';
import { diagram as productDiagram } from './help-product-map.js';
import { BANDS, NODES, LINKS, COMMON } from './atlas-data.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  e.append(...kids.flat().filter((k) => k != null)); return e;
};

const byId = new Map(NODES.map((n) => [n.id, n]));
const bandOf = new Map(BANDS.map((b, i) => [b.id, { ...b, i }]));
const tone = (n) => bandOf.get(n.band).tok;
const nameOf = (n) => (n.t === 'ИЗДЕЛИЕ' ? 'Изделие' : n.t);
const hrefOf = (n) => n.href || (n.sec ? SECTIONS[n.sec]?.href : null);

// ---------- общая схема: слой = полоса, блок = раздел ----------
const W = 1230, LBL = 150, COL0 = 180, COLW = 262, NW = 222, NH = 92, BAND_H = 168, TOP = 36;
const geo = (n) => {
  const b = bandOf.get(n.band);
  return { x: COL0 + n.col * COLW, y: TOP + b.i * BAND_H + 38, w: NW, h: NH, row: b.i };
};
const cx = (g) => g.x + g.w / 2;

/** Пути связей — только прямые отрезки под прямым углом (просьба 2026-11-12): горизонтали идут в промежутках
 *  между рядами, вертикали через ряды — в промежутках между колонками; у каждой линии своя дорожка, чтобы не сливались. */
const rowTop = (r) => TOP + r * BAND_H + 38;
const chX = (c) => COL0 + c * COLW + NW + (COLW - NW) / 2; // промежуток справа от колонки c
function routes() {
  const ports = {}; // node:side → список [linkIndex, x другого конца]
  const put = (id, side, k, other) => { (ports[`${id}:${side}`] ||= []).push([k, other]); };
  const plan = LINKS.map(([a, b], k) => {
    const A = geo(byId.get(a)), B = geo(byId.get(b));
    if (A.row === B.row) {
      const near = Math.abs(byId.get(a).col - byId.get(b).col) === 1;
      if (!near) { put(a, 'top', k, cx(B)); put(b, 'top', k, cx(A)); }
      return { k, a, b, A, B, kind: near ? 'side' : 'arc' };
    }
    const down = B.row > A.row;
    put(a, down ? 'bottom' : 'top', k, cx(B)); put(b, down ? 'top' : 'bottom', k, cx(A));
    return { k, a, b, A, B, kind: down ? 'down' : 'up' };
  });
  const portX = (id, side, k) => {
    const list = (ports[`${id}:${side}`] || []).slice().sort((p, q) => p[1] - q[1]);
    const i = list.findIndex((p) => p[0] === k), n = list.length;
    // верхние и нижние гнёзда сдвинуты на 8 px: линия, уходящая вниз, не ложится на линию, входящую в блок ниже
    return cx(geo(byId.get(id))) + (side === 'top' ? 4 : -4) + (i - (n - 1) / 2) * Math.min(26, (NW - 40) / Math.max(1, n - 1));
  };
  // дорожки: в промежутке над рядом r — горизонтали, в промежутке справа от колонки c — вертикали
  const gapUsed = {}, chUsed = {};
  const gapY = (r) => {
    const k = (gapUsed[r] = (gapUsed[r] || 0) + 1) - 1;
    const top = r ? rowTop(r - 1) + NH : TOP - 8, bottom = rowTop(r), n = Math.max(1, Math.floor((bottom - top - 20) / 8));
    return top + 12 + (k % n) * 8;
  };
  const chanX = (c) => { const k = (chUsed[c] = (chUsed[c] || 0) + 1) - 1; return chX(c) + ((k % 5) - 2) * 7; };
  return plan.map((p) => {
    const { A, B, a, b, k } = p;
    let pts;
    if (p.kind === 'side') {
      const right = B.x > A.x, y = A.y + A.h / 2;
      pts = [[right ? A.x + A.w : A.x, y], [right ? B.x : B.x + B.w, y]];
    } else if (p.kind === 'arc') {
      const x1 = portX(a, 'top', k), x2 = portX(b, 'top', k), y = gapY(A.row);
      pts = [[x1, A.y], [x1, y], [x2, y], [x2, B.y]];
    } else {
      const down = p.kind === 'down';
      const x1 = portX(a, down ? 'bottom' : 'top', k), x2 = portX(b, down ? 'top' : 'bottom', k);
      const y1 = down ? A.y + A.h : A.y, y2 = down ? B.y : B.y + B.h;
      const gA = down ? A.row + 1 : A.row, gB = down ? B.row : B.row + 1; // промежутки у начала и у конца
      if (gA === gB) { const y = gapY(gA); pts = [[x1, y1], [x1, y], [x2, y], [x2, y2]]; }
      else {
        let c = 0, best = Infinity; // ближайший к обоим концам коридор между колонками
        for (let i = 0; i < 4; i++) { const d = Math.abs(chX(i) - x1) + Math.abs(chX(i) - x2); if (d < best) { best = d; c = i; } }
        const xc = chanX(c), ya = gapY(gA), yb = gapY(gB);
        pts = [[x1, y1], [x1, ya], [xc, ya], [xc, yb], [x2, yb], [x2, y2]];
      }
    }
    return { a, b, label: LINKS[k][2], d: roundPath(pts, 6) };
  });
}

/** Ломаная с чуть скруглёнными углами (радиус r): прямые отрезки, без дуг-«макарон». */
function roundPath(pts, r) {
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const [px, py] = pts[i - 1], [x, y] = pts[i], [nx, ny] = pts[i + 1];
    const r1 = Math.min(r, Math.hypot(x - px, y - py) / 2, Math.hypot(nx - x, ny - y) / 2);
    const ax = x - Math.sign(x - px) * r1, ay = y - Math.sign(y - py) * r1, bx = x + Math.sign(nx - x) * r1, by = y + Math.sign(ny - y) * r1;
    d += ` L${ax},${ay} Q${x},${y} ${bx},${by}`;
  }
  const [lx, ly] = pts[pts.length - 1];
  return d + ` L${lx},${ly}`;
}

function bigMap(open) {
  const H = TOP + BANDS.length * BAND_H + 6;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'group', 'aria-label': 'Карта сайта: разделы и связи сверху вниз' });
  const toks = [...new Set(BANDS.map((b) => b.tok))];
  svg.append(s('defs', {}, ...toks.map((t) => s('marker', { id: `at-arr-${t}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' },
    s('path', { d: 'M0,0 L10,5 L0,10 z', fill: `var(--sec-${t})` })))));
  BANDS.forEach((b, i) => {
    const y = TOP + i * BAND_H;
    svg.append(s('g', { 'aria-hidden': 'true' },
      i ? s('line', { x1: 0, x2: W, y1: y + 4, y2: y + 4, stroke: 'var(--border)', 'stroke-dasharray': '2 6' }) : null,
      s('rect', { x: 0, y: y + 38, width: 6, height: NH, rx: 3, fill: `var(--sec-${b.tok})` }),
      s('text', { x: 16, y: y + 72, fill: 'var(--heading)', 'font-size': 15, 'font-weight': 700 }, b.name),
      ...wrap(b.hint, 18).map((t, j) => s('text', { x: 16, y: y + 94 + j * 17, fill: 'var(--muted)', 'font-size': 13 }, t))));
  });
  const R = routes();
  const lines = R.map((r) => s('path', { d: r.d, fill: 'none', stroke: `var(--sec-${tone(byId.get(r.a))})`, 'stroke-width': 1.7, opacity: '.42', 'marker-end': `url(#at-arr-${tone(byId.get(r.a))})` }));
  svg.append(...lines);
  const boxes = new Map();
  let pinned = null;
  const light = (id) => {
    const on = id || pinned;
    const near = new Set(on ? [on, ...R.filter((r) => r.a === on || r.b === on).flatMap((r) => [r.a, r.b])] : []);
    R.forEach((r, i) => {
      const hit = on && (r.a === on || r.b === on);
      lines[i].setAttribute('opacity', !on ? '.42' : hit ? '1' : '.07');
      lines[i].setAttribute('stroke-width', hit ? '2.6' : '1.7');
    });
    // подпись связи — внутри карточки соседа, на месте её описания: так тексты не налезают друг на друга (просьба 2026-11-12)
    boxes.forEach((b, nid) => {
      b.g.setAttribute('opacity', !on || near.has(nid) ? '1' : '.38');
      const rel = on && nid !== on ? R.filter((r) => (r.a === on && r.b === nid) || (r.b === on && r.a === nid))
        .map((r) => (r.b === nid ? 'получает: ' : 'даёт: ') + r.label).join('; ') : '';
      b.desc.setAttribute('visibility', rel ? 'hidden' : 'visible');
      b.rel.forEach((t, i) => { t.textContent = rel ? fit(rel, 27, 2)[i] || '' : ''; });
    });
  };
  for (const n of NODES) {
    const g0 = geo(n), tok = tone(n), parts = n.inside?.length || 0;
    const desc = s('g', {}, ...n.l.map((t, i) => s('text', { x: g0.x + 12, y: g0.y + 47 + i * 17, fill: 'var(--muted)', 'font-size': 13 }, t)));
    const rel = [0, 1].map((i) => s('text', { x: g0.x + 12, y: g0.y + 47 + i * 17, fill: 'var(--heading)', 'font-size': 13, 'font-weight': 600 }));
    const g = s('g', { tabindex: 0, role: 'button', cursor: 'pointer', 'aria-label': `${nameOf(n)}: открыть, что внутри` },
      s('rect', { x: g0.x, y: g0.y, width: g0.w, height: g0.h, rx: 10, fill: n.big ? 'var(--primary-soft)' : `var(--sec-${tok}-soft)`,
        stroke: n.big ? 'var(--primary)' : `var(--sec-${tok})`, 'stroke-width': n.big ? 2.6 : 1.4 }),
      s('text', { x: g0.x + 12, y: g0.y + 25, fill: 'var(--heading)', 'font-size': n.big ? 17 : 15, 'font-weight': 700 }, n.t),
      desc, ...rel,
      parts ? s('text', { x: g0.x + g0.w - 10, y: g0.y + g0.h - 9, 'text-anchor': 'end', fill: n.big ? 'var(--primary)' : `var(--sec-${tok})`, 'font-size': 12, 'font-weight': 700 }, `внутри: ${parts} ›`) : null);
    g.addEventListener('mouseenter', () => light(n.id)); g.addEventListener('mouseleave', () => light(null));
    g.addEventListener('focus', () => light(n.id)); g.addEventListener('blur', () => light(null));
    g.addEventListener('click', () => open(n.id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(n.id); } });
    boxes.set(n.id, { g, desc, rel }); svg.append(g);
  }
  const pin = (id) => { pinned = id; light(null); };
  return { svg, pin };
}

/** Легенда над картой (просьба 2026-11-12): цветные стрелки слоёв с подписями, затем что значат блок и «внутри». */
function legend() {
  const items = [];
  for (const b of BANDS) {
    const same = items.find((it) => it.tok === b.tok);
    if (same) same.name += ' и ' + b.name.toLowerCase(); else items.push({ tok: b.tok, name: b.name });
  }
  const svg = s('svg', { viewBox: `0 0 ${W} 62`, width: '100%', role: 'img', 'aria-label': 'Легенда: цвет стрелки — из какого слоя идут сведения' });
  svg.append(s('defs', {}, ...items.map((it) => s('marker', { id: `at-lg-${it.tok}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' },
    s('path', { d: 'M0,0 L10,5 L0,10 z', fill: `var(--sec-${it.tok})` })))));
  svg.append(s('text', { x: 0, y: 19, fill: 'var(--muted)', 'font-size': 13 }, 'Стрелка — куда идут сведения. Цвет — откуда:'));
  let x = 340;
  for (const it of items) {
    svg.append(s('path', { d: `M${x},15 L${x + 34},15`, stroke: `var(--sec-${it.tok})`, 'stroke-width': 2.4, 'marker-end': `url(#at-lg-${it.tok})` }),
      s('text', { x: x + 42, y: 19, fill: 'var(--heading)', 'font-size': 13, 'font-weight': 600 }, it.name));
    x += 42 + it.name.length * 7.6 + 26;
  }
  // вторая строка: блок, «внутри», наведение
  svg.append(s('rect', { x: 0, y: 36, width: 34, height: 20, rx: 5, fill: 'var(--surface-3)', stroke: 'var(--border-strong)' }),
    s('text', { x: 42, y: 51, fill: 'var(--heading)', 'font-size': 13, 'font-weight': 600 }, 'раздел — нажмите, откроется, что внутри'),
    s('text', { x: 350, y: 51, fill: 'var(--primary)', 'font-size': 12, 'font-weight': 700 }, 'внутри: 5 ›'),
    s('text', { x: 432, y: 51, fill: 'var(--heading)', 'font-size': 13, 'font-weight': 600 }, 'сколько шагов и частей'),
    s('text', { x: 640, y: 51, fill: 'var(--muted)', 'font-size': 13 }, 'Наведите на блок — останутся только его связи, в соседях — что передаётся.'));
  return svg;
}

// ---------- окно «что внутри»: шаги сверху вниз; слева — что и в какой шаг приходит, справа — откуда уходит ----------
function inner(n, open) {
  const parts = n.inside || [], chain = parts.filter((p) => !p.alt), extra = parts.filter((p) => p.alt);
  const ins = LINKS.filter(([, b]) => b === n.id), outs = LINKS.filter(([a]) => a === n.id);
  const W2 = 960, SW = 210, SH = 58, PW = 300, PH = 58, CX = 330, RX = W2 - 10 - SW;
  const GAP = n.seq ? 30 : 14, TOPY = 70;
  // где стоит каждая часть: цепочка, затем «ещё в разделе»
  const pos = new Map();
  let y = TOPY;
  chain.forEach((p) => { pos.set(p, y); y += PH + GAP; });
  const extraY = y + (extra.length ? 10 : 0);
  if (extra.length) y = extraY + 22;
  extra.forEach((p) => { pos.set(p, y); y += PH + 14; });
  const partsBottom = y - (extra.length ? 14 : GAP);
  const partOf = (key, id) => parts.find((p) => (p[key] || []).includes(id)) || (key === 'in' ? parts[0] : parts[parts.length - 1]);
  // соседи: напротив своего шага, без наложений
  const place = (list, key) => {
    const rows = list.map((l) => ({ l, id: key === 'in' ? l[0] : l[1], part: partOf(key, key === 'in' ? l[0] : l[1]) }))
      .map((r) => ({ ...r, want: pos.get(r.part) + PH / 2 - SH / 2 })).sort((a, b) => a.want - b.want);
    let next = 10;
    rows.forEach((r) => { r.y = Math.max(r.want, next); next = r.y + SH + 10; });
    return rows;
  };
  const L = place(ins, 'in'), R = place(outs, 'out');
  const H = Math.max(partsBottom, ...L.map((r) => r.y + SH), ...R.map((r) => r.y + SH)) + 16;
  const svg = s('svg', { viewBox: `0 0 ${W2} ${H}`, width: '100%', role: 'group', 'aria-label': `${nameOf(n)}: шаги и связи` });
  const toks = [...new Set([tone(n), ...BANDS.map((b) => b.tok)])];
  svg.append(s('defs', {}, ...toks.map((t) => s('marker', { id: `at-in-${t}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' },
    s('path', { d: 'M0,0 L10,5 L0,10 z', fill: `var(--sec-${t})` })))));
  const tok = tone(n);
  // рамка раздела
  svg.append(s('rect', { x: CX - 18, y: 8, width: PW + 36, height: partsBottom - 8 + 14, rx: 14, fill: n.big ? 'var(--primary-soft)' : `var(--sec-${tok}-soft)`, stroke: n.big ? 'var(--primary)' : `var(--sec-${tok})`, 'stroke-width': 2 }),
    s('text', { x: CX, y: 36, fill: 'var(--heading)', 'font-size': 18, 'font-weight': 700 }, nameOf(n)),
    s('text', { x: CX, y: 55, fill: 'var(--muted)', 'font-size': 12 }, n.seq ? 'шаги по порядку, сверху вниз' : 'из чего состоит'));
  if (extra.length) svg.append(s('text', { x: CX, y: extraY + 12, fill: 'var(--muted)', 'font-size': 12, 'font-weight': 700 }, 'Ещё в разделе'));
  // линии соседей: прямые отрезки, у каждой своя вертикаль
  const lines = (rows, left) => {
    const per = new Map(); rows.forEach((r) => per.set(r.part, (per.get(r.part) || 0) + 1));
    const seen = new Map();
    rows.forEach((r, k) => {
      const m = per.get(r.part), q = (seen.set(r.part, (seen.get(r.part) || 0) + 1).get(r.part)) - 1;
      const yp = pos.get(r.part) + PH / 2 + (q - (m - 1) / 2) * 12, ys = r.y + SH / 2;
      const t = tone(byId.get(r.id));
      const xa = left ? 10 + SW : CX + PW, xb = left ? CX : RX;
      const xc = left ? 10 + SW + 22 + k * 11 : CX + PW + 22 + k * 11;
      const pts = Math.abs(yp - ys) < 1 ? [[xa, ys], [xb, ys]] : left ? [[xa, ys], [xc, ys], [xc, yp], [xb, yp]] : [[xa, yp], [xc, yp], [xc, ys], [xb, ys]];
      svg.append(s('path', { d: roundPath(pts, 6), fill: 'none', stroke: `var(--sec-${t})`, 'stroke-width': 1.8, 'marker-end': `url(#at-in-${t})` }));
    });
  };
  lines(L, true); lines(R, false);
  // шаги
  chain.forEach((p, i) => {
    const py = pos.get(p);
    if (n.seq && i < chain.length - 1) svg.append(s('path', { d: `M${CX + PW / 2},${py + PH} L${CX + PW / 2},${py + PH + GAP}`, stroke: `var(--sec-${tok})`, 'stroke-width': 2, 'marker-end': `url(#at-in-${tok})` }));
  });
  parts.forEach((p, i) => {
    const py = pos.get(p), num = n.seq && !p.alt ? chain.indexOf(p) + 1 : null, tx = CX + (num ? 38 : 12);
    svg.append(s('g', {}, s('rect', { x: CX, y: py, width: PW, height: PH, rx: 9, fill: 'var(--surface)', stroke: p.alt ? 'var(--border)' : 'var(--border-strong)', 'stroke-dasharray': p.alt ? '4 3' : null }),
      num ? s('circle', { cx: CX + 19, cy: py + PH / 2, r: 11, fill: `var(--sec-${tok})` }) : null,
      num ? s('text', { x: CX + 19, y: py + PH / 2 + 4, 'text-anchor': 'middle', fill: 'var(--surface)', 'font-size': 12, 'font-weight': 700 }, String(num)) : null,
      s('text', { x: tx, y: py + 22, fill: 'var(--heading)', 'font-size': 13, 'font-weight': 700 }, p.t),
      ...fit(p.l, num ? 37 : 41, 2).map((t, j) => s('text', { x: tx, y: py + 39 + j * 14, fill: 'var(--muted)', 'font-size': 12 }, t))));
  });
  // соседи
  const sideBox = (r, x, left) => {
    const m = byId.get(r.id), t = tone(m);
    const g = s('g', { tabindex: 0, role: 'button', cursor: 'pointer', 'aria-label': `Перейти: ${nameOf(m)}` },
      s('rect', { x, y: r.y, width: SW, height: SH, rx: 9, fill: `var(--sec-${t}-soft)`, stroke: `var(--sec-${t})` }),
      s('text', { x: x + 10, y: r.y + 21, fill: 'var(--heading)', 'font-size': 14, 'font-weight': 700 }, nameOf(m)),
      ...fit((left ? 'даёт: ' : 'получает: ') + r.l[2], 28, 2).map((tt, j) => s('text', { x: x + 10, y: r.y + 38 + j * 14, fill: 'var(--muted)', 'font-size': 12 }, tt)));
    g.addEventListener('click', () => open(r.id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(r.id); } });
    return g;
  };
  L.forEach((r) => svg.append(sideBox(r, 10, true)));
  R.forEach((r) => svg.append(sideBox(r, RX, false)));
  return svg;
}

/** Узкий экран: та же декомпозиция словами — откуда, что внутри, куда (соседи — кнопки). */
function innerList(n, open) {
  const ins = LINKS.filter(([, b]) => b === n.id), outs = LINKS.filter(([a]) => a === n.id);
  const near = (list, pick) => h('ul', null, ...list.map((l) => h('li', null, button({ label: nameOf(byId.get(pick(l))), size: 'S', onClick: () => open(pick(l)) }), ' — ', l[2])));
  return h('div', null,
    ins.length ? guide.unit({ name: 'Откуда приходят сведения', foot: near(ins, (l) => l[0]) }) : null,
    guide.unit({ name: n.seq ? 'Шаги по порядку' : 'Из чего состоит', foot: h(n.seq ? 'ol' : 'ul', null, ...(n.inside || []).map((p) => h('li', null, h('b', null, p.t), ' — ', p.l, p.alt ? ' (ещё в разделе)' : ''))) }),
    outs.length ? guide.unit({ name: 'Куда уходят', foot: near(outs, (l) => l[1]) }) : null);
}

/** Перенос по словам в lines строк; не влезло — многоточие в последней. */
function fit(t, max, lines) {
  const out = wrap(t, max);
  if (out.length > lines) { out.length = lines; out[lines - 1] = out[lines - 1].slice(0, max - 1).replace(/[\s;,]+$/, '') + '…'; }
  return out;
}

function wrap(t, max) {
  const out = [];
  for (const w of t.split(' ')) { const last = out[out.length - 1]; if (last && (last + ' ' + w).length <= max) out[out.length - 1] = last + ' ' + w; else out.push(w); }
  return out;
}

function detail(n, open, back, close) {
  const sec = n.sec ? SECTIONS[n.sec] : null, href = hrefOf(n);
  const what = sec?.what || n.l.join(' ');
  const go = href ? button({ label: `Открыть раздел «${nameOf(n)}»`, kind: 'primary', onClick: () => { close(); location.hash = href; } })
    : h('span', { class: 'muted small' }, `Где найти: ${n.where || 'из карточек и поиска'}`);
  const nav = toolbar(back ? button({ label: `← ${nameOf(back)}`, onClick: () => open(back.id, true) }) : null, go);
  const ins = LINKS.filter(([, b]) => b === n.id).length, outs = LINKS.filter(([a]) => a === n.id).length;
  return [
    nav,
    h('p', null, what),
    h('p', { class: 'muted small' }, `${n.seq ? 'Шаги идут сверху вниз по порядку. ' : ''}Слева — что приходит (${ins}) и в какой шаг, справа — что уходит (${outs}) и откуда. Нажмите соседний блок — окно перейдёт к нему.`),
    window.matchMedia('(min-width: 1100px)').matches ? inner(n, open) : innerList(n, open),
    n.productMap ? guide.cat({ title: 'Подробно: из чего состоит изделие', what: 'PDM, модули, детали, сырьё, файлы — и куда они уходят', count: 'схема', body: [productDiagram()] }) : null,
    n.rules?.length ? h('div', null, ...n.rules.map((t) => guide.note({ label: 'Учитывать', text: t, tone: 'warn' }))) : null,
    sec?.steps?.length ? guide.cat({ title: 'Как работать — по шагам', what: 'Что за чем нажимать в этом разделе', count: `${sec.steps.length} шаг.`, body: [guide.chain(sec.steps)] }) : null,
    n.docs?.length || n.tech ? guide.cat({ title: 'Где описано', what: 'Документы проекта — для ИИ и разработчика', count: 'доки',
      body: [h('ul', null, ...(n.docs || []).map((d) => h('li', null, d))), n.tech ? h('p', { class: 'muted small' }, `Таблицы базы: ${n.tech}`) : null] }) : null,
  ];
}

// ---------- телефон и узкий экран: те же блоки плитками по слоям ----------
function narrowList(open) {
  return h('div', null, ...BANDS.map((b) => h('section', null, h('h2', null, b.name),
    tileGrid(...NODES.filter((n) => n.band === b.id).map((n) => card({ size: 'S', title: nameOf(n), meta: n.l.join(' '), onClick: () => open(n.id) }))))));
}

export const atlas = {
  id: 'atlas',
  title: 'Карта сайта',
  mount(el, { params } = {}) {
    let panelEl = null, backEl = null, current = null, prev = null, map = null, returnTo = null;
    const close = () => {
      panelEl?.remove(); panelEl = backEl = null; document.removeEventListener('mousedown', onOutside, true); current = prev = null;
      document.removeEventListener('keydown', onKey, true); map?.pin(null);
      if (returnTo?.isConnected) returnTo.focus(); returnTo = null;
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onOutside = (e) => { if (panelEl && !panelEl.contains(e.target) && !e.target.closest?.('[role="button"]')) close(); };
    const open = (id, goingBack = false) => {
      const n = byId.get(id); if (!n) return;
      prev = goingBack ? null : (current && current !== id ? byId.get(current) : prev);
      current = id; map?.pin(id);
      const p = entityPanel({ section: bandOf.get(n.band).name, title: nameOf(n), kind: 'Раздел сайта', main: detail(n, open, prev, close), onClose: close });
      // .k-panel — образец для витрины (static); без него действует общий .drawer: окно справа поверх карты, ширина — --detail-w
      p.el.classList.remove('k-panel');
      p.el.style.setProperty('--detail-w', 'min(1080px, 100vw)');
      if (!backEl) {
        returnTo = document.activeElement;
        backEl = true; // нажатие мимо окна закрывает его (как у правой панели)
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousedown', onOutside, true);
      }
      if (panelEl) panelEl.replaceWith(p.el); else document.body.append(p.el);
      panelEl = p.el;
      p.el.querySelector('.drawer-body')?.scrollTo(0, 0);
      p.el.querySelector('.drawer-head button')?.focus({ preventScroll: true });
    };
    window.addEventListener('hashchange', close, { once: true });

    const wide = window.matchMedia('(min-width: 1240px)').matches; // схема рассчитана на 1200: уже — шрифт меньше 12 px, поэтому плитки
    if (wide) map = bigMap(open);
    el.append(
      h('div', { class: 'page-head' }, h('h1', null, 'Карта сайта'),
        h('span', { class: 'muted small' }, 'Как устроен сайт сверху вниз: от заказчика до денег. Нажмите блок — справа откроется, что внутри и с чем он связан.')),
      wide ? legend() : null,
      wide ? map.svg : narrowList(open),
      h('section', null, h('h2', null, 'Всегда под рукой'), h('p', { class: 'muted small' }, 'Работают со всеми разделами сразу.'),
        tileGrid(...COMMON.map((c) => card({ size: 'S', title: c.t, meta: c.l, onClick: () => { location.hash = c.href; } })))));
    if (params?.n && byId.has(params.n)) open(params.n);
    return { destroy: close };
  },
};
