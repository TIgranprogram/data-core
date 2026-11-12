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
const W = 1200, LBL = 150, COL0 = 178, COLW = 255, NW = 228, NH = 92, BAND_H = 168, TOP = 36;
const geo = (n) => {
  const b = bandOf.get(n.band);
  return { x: COL0 + n.col * COLW, y: TOP + b.i * BAND_H + 38, w: NW, h: NH, row: b.i };
};
const cx = (g) => g.x + g.w / 2;

/** Пути связей: соседи в слое — сбоку, дальние в слое — дугой сверху, между слоями — сверху вниз (или снизу вверх). */
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
    return cx(geo(byId.get(id))) + (i - (n - 1) / 2) * Math.min(26, (NW - 40) / Math.max(1, n - 1));
  };
  return plan.map((p) => {
    const { A, B, a, b, k } = p;
    let pts;
    if (p.kind === 'side') {
      const right = B.x > A.x, y = A.y + A.h / 2;
      const x1 = right ? A.x + A.w : A.x, x2 = right ? B.x : B.x + B.w;
      pts = [[x1, y], [(x1 + x2) / 2, y], [(x1 + x2) / 2, y], [x2, y]];
    } else if (p.kind === 'arc') {
      const x1 = portX(a, 'top', k), x2 = portX(b, 'top', k), lift = 26 + Math.abs(x2 - x1) / 30;
      pts = [[x1, A.y], [x1, A.y - lift], [x2, B.y - lift], [x2, B.y]];
    } else {
      const down = p.kind === 'down';
      const x1 = portX(a, down ? 'bottom' : 'top', k), x2 = portX(b, down ? 'top' : 'bottom', k);
      const y1 = down ? A.y + A.h : A.y, y2 = down ? B.y : B.y + B.h, m = (y1 + y2) / 2;
      pts = [[x1, y1], [x1, m], [x2, m], [x2, y2]];
    }
    const mid = [0, 1].map((j) => (pts[0][j] + 3 * pts[1][j] + 3 * pts[2][j] + pts[3][j]) / 8);
    return { a, b, label: LINKS[k][2], d: `M${pts[0]} C${pts[1]} ${pts[2]} ${pts[3]}`, mid };
  });
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
  const labels = R.map((r) => s('text', { x: r.mid[0], y: r.mid[1] + 4, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 600, fill: 'var(--heading)',
    stroke: 'var(--surface)', 'stroke-width': 4, 'paint-order': 'stroke', opacity: 0, 'pointer-events': 'none' }, r.label));
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
      labels[i].setAttribute('opacity', hit ? '1' : '0');
    });
    boxes.forEach((g, nid) => g.setAttribute('opacity', !on || near.has(nid) ? '1' : '.38'));
  };
  for (const n of NODES) {
    const g0 = geo(n), tok = tone(n), parts = n.inside?.length || 0;
    const g = s('g', { tabindex: 0, role: 'button', cursor: 'pointer', 'aria-label': `${nameOf(n)}: открыть, что внутри` },
      s('rect', { x: g0.x, y: g0.y, width: g0.w, height: g0.h, rx: 10, fill: n.big ? 'var(--primary-soft)' : `var(--sec-${tok}-soft)`,
        stroke: n.big ? 'var(--primary)' : `var(--sec-${tok})`, 'stroke-width': n.big ? 2.6 : 1.4 }),
      s('text', { x: g0.x + 12, y: g0.y + 25, fill: 'var(--heading)', 'font-size': n.big ? 17 : 15, 'font-weight': 700 }, n.t),
      ...n.l.map((t, i) => s('text', { x: g0.x + 12, y: g0.y + 47 + i * 17, fill: 'var(--muted)', 'font-size': 13 }, t)),
      parts ? s('text', { x: g0.x + g0.w - 10, y: g0.y + g0.h - 9, 'text-anchor': 'end', fill: n.big ? 'var(--primary)' : `var(--sec-${tok})`, 'font-size': 12, 'font-weight': 700 }, `внутри: ${parts} ›`) : null);
    g.addEventListener('mouseenter', () => light(n.id)); g.addEventListener('mouseleave', () => light(null));
    g.addEventListener('focus', () => light(n.id)); g.addEventListener('blur', () => light(null));
    g.addEventListener('click', () => open(n.id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(n.id); } });
    boxes.set(n.id, g); svg.append(g);
  }
  svg.append(...labels);
  const pin = (id) => { pinned = id; light(null); };
  return { svg, pin };
}

// ---------- окно «что внутри»: источники слева, раздел с частями в центре, результат справа ----------
function inner(n, open) {
  const ins = LINKS.filter(([, b]) => b === n.id), outs = LINKS.filter(([a]) => a === n.id);
  const parts = n.inside || [], cols = 2, PW = 190, PH = 56, GAP = 10;
  const rows = Math.ceil(parts.length / cols);
  const CW = cols * PW + (cols + 1) * GAP, CX = 255, CH = 52 + rows * (PH + GAP);
  const SW = 200, SH = 52, side = Math.max(ins.length, outs.length);
  const H = Math.max(CH, side * (SH + 12)) + 20, CY = (H - CH) / 2;
  const svg = s('svg', { viewBox: `0 0 ${CX * 2 + CW} ${H}`, width: '100%', role: 'group', 'aria-label': `${nameOf(n)}: что внутри и с чем связано` });
  svg.append(s('defs', {}, s('marker', { id: 'at-arr2', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, s('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--muted)' }))));
  const tok = tone(n);
  const sideBox = (id, x, y, label, left) => {
    const m = byId.get(id), t = tone(m);
    const g = s('g', { tabindex: 0, role: 'button', cursor: 'pointer', 'aria-label': `Перейти: ${nameOf(m)}` },
      s('rect', { x, y, width: SW, height: SH, rx: 9, fill: `var(--sec-${t}-soft)`, stroke: `var(--sec-${t})` }),
      s('text', { x: x + 10, y: y + 22, fill: 'var(--heading)', 'font-size': 14, 'font-weight': 700 }, nameOf(m)),
      s('text', { x: x + 10, y: y + 41, fill: 'var(--muted)', 'font-size': 12 }, (left ? 'даёт: ' : 'получает: ') + label));
    g.addEventListener('click', () => open(id));
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(id); } });
    return g;
  };
  const colY = (i, cnt) => (H - cnt * (SH + 12) + 12) / 2 + i * (SH + 12);
  ins.forEach(([a, , label], i) => {
    const y = colY(i, ins.length) + SH / 2;
    svg.append(s('path', { d: `M${10 + SW},${y} C${CX - 20},${y} ${CX - 40},${H / 2} ${CX},${H / 2}`, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.5, 'marker-end': 'url(#at-arr2)' }));
    svg.append(sideBox(a, 10, colY(i, ins.length), label, true));
  });
  outs.forEach(([, b, label], i) => {
    const y = colY(i, outs.length) + SH / 2, x0 = CX + CW, x1 = CX * 2 + CW - 10 - SW;
    svg.append(s('path', { d: `M${x0},${H / 2} C${x0 + 40},${H / 2} ${x1 - 20},${y} ${x1},${y}`, fill: 'none', stroke: 'var(--muted)', 'stroke-width': 1.5, 'marker-end': 'url(#at-arr2)' }));
    svg.append(sideBox(b, x1, colY(i, outs.length), label, false));
  });
  svg.append(s('rect', { x: CX, y: CY, width: CW, height: CH, rx: 12, fill: n.big ? 'var(--primary-soft)' : `var(--sec-${tok}-soft)`, stroke: n.big ? 'var(--primary)' : `var(--sec-${tok})`, 'stroke-width': 2.2 }),
    s('text', { x: CX + 14, y: CY + 32, fill: 'var(--heading)', 'font-size': 18, 'font-weight': 700 }, nameOf(n)));
  parts.forEach((p, i) => {
    const x = CX + GAP + (i % cols) * (PW + GAP), y = CY + 48 + Math.floor(i / cols) * (PH + GAP);
    svg.append(s('g', {}, s('rect', { x, y, width: PW, height: PH, rx: 8, fill: 'var(--surface)', stroke: 'var(--border-strong)' }),
      s('text', { x: x + 9, y: y + 21, fill: 'var(--heading)', 'font-size': 13, 'font-weight': 700 }, p.t),
      ...wrap(p.l, 29).slice(0, 2).map((t, j) => s('text', { x: x + 9, y: y + 38 + j * 14, fill: 'var(--muted)', 'font-size': 12 }, t))));
  });
  return svg;
}

/** Узкий экран: та же декомпозиция словами — откуда, что внутри, куда (соседи — кнопки). */
function innerList(n, open) {
  const ins = LINKS.filter(([, b]) => b === n.id), outs = LINKS.filter(([a]) => a === n.id);
  const near = (list, pick) => h('ul', null, ...list.map((l) => h('li', null, button({ label: nameOf(byId.get(pick(l))), size: 'S', onClick: () => open(pick(l)) }), ' — ', l[2])));
  return h('div', null,
    ins.length ? guide.unit({ name: 'Откуда приходят сведения', foot: near(ins, (l) => l[0]) }) : null,
    guide.unit({ name: 'Что внутри', foot: h('ul', null, ...(n.inside || []).map((p) => h('li', null, h('b', null, p.t), ' — ', p.l))) }),
    outs.length ? guide.unit({ name: 'Куда уходят', foot: near(outs, (l) => l[1]) }) : null);
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
    h('p', { class: 'muted small' }, `Слева — откуда приходят сведения (${ins}), справа — куда уходят (${outs}). Нажмите соседний блок — окно перейдёт к нему.`),
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
      wide ? h('p', { class: 'muted small' }, 'Цвет — слой. Стрелка — куда идут сведения. Наведите на блок — подсветятся его связи и подписи.') : null,
      wide ? map.svg : narrowList(open),
      h('section', null, h('h2', null, 'Всегда под рукой'), h('p', { class: 'muted small' }, 'Работают со всеми разделами сразу.'),
        tileGrid(...COMMON.map((c) => card({ size: 'S', title: c.t, meta: c.l, onClick: () => { location.hash = c.href; } })))));
    if (params?.n && byId.has(params.n)) open(params.n);
    return { destroy: close };
  },
};
