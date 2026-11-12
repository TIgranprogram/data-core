// «Карта сайта» (#atlas, кнопка «?» в шапке): весь сайт одной схемой сверху вниз — от заказчика до денег.
// Нажатие на блок не уводит со страницы: справа открывается окно «что внутри» — части раздела, откуда приходят
// сведения, куда уходят, что учитывать при изменении, шаги и где описано (для ИИ). Данные — atlas-data.js.
// Бывшая «Работа с сайтом» (#help) влита сюда; #help открывает эту же карту. Окно блока — atlas-window.js, помощники — atlas-util.js, сводка для ИИ — atlas-brief.js.
import { h } from '../core/dom.js';
import { entityPanel, card, tileGrid } from '../ui/kit/index.js';
import { BANDS, NODES, LINKS } from './atlas-data.js';
import { s, byId, bandOf, tone, nameOf, fit, wrap, roundPath, planLabel } from './atlas-util.js';
import { detail } from './atlas-window.js';

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
  // сколько горизонталей придёт в каждый промежуток — шаг дорожек делим на всех, без повторов по кругу
  const demand = {};
  for (const p of plan) {
    if (p.kind === 'arc') demand[p.A.row] = (demand[p.A.row] || 0) + 1;
    else if (p.kind === 'down' || p.kind === 'up') {
      const gA = p.kind === 'down' ? p.A.row + 1 : p.A.row, gB = p.kind === 'down' ? p.B.row : p.B.row + 1;
      demand[gA] = (demand[gA] || 0) + 1; if (gB !== gA) demand[gB] = (demand[gB] || 0) + 1;
    }
  }
  const gapY = (r) => {
    const k = (gapUsed[r] = (gapUsed[r] || 0) + 1) - 1;
    const top = r ? rowTop(r - 1) + NH : TOP - 8, bottom = rowTop(r), room = bottom - top - 20;
    const step = Math.min(8, room / Math.max(1, (demand[r] || 1) - 1 || 1));
    return top + 10 + k * step;
  };
  const chanX = (c) => { const k = (chUsed[c] = (chUsed[c] || 0) + 1) - 1; return chX(c) + ((k % 5) - 2) * 7; };
  return plan.map((p) => {
    const { A, B, a, b, k } = p;
    let pts;
    if (p.kind === 'side') {
      const right = B.x > A.x, y = A.y + A.h / 2 + (right ? -9 : 9); // встречные связи — на разной высоте
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

function bigMap(open) {
  const H = TOP + BANDS.length * BAND_H + 6;
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'group', 'aria-label': 'Карта сайта: разделы и связи сверху вниз' });
  const toks = [...new Set(BANDS.map((b) => b.tok))];
  svg.append(s('defs', {}, ...toks.map((t) => s('marker', { id: `at-arr-${t}`, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' },
    s('path', { d: 'M0,0 L10,5 L0,10 z', fill: `var(--sec-${t})` }))),
  s('marker', { id: 'at-arr-plan', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto' }, s('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--muted)' }))));
  BANDS.forEach((b, i) => {
    const y = TOP + i * BAND_H;
    svg.append(s('g', { 'aria-hidden': 'true' },
      i ? s('line', { x1: 0, x2: W, y1: y + 4, y2: y + 4, stroke: 'var(--border)', 'stroke-dasharray': '2 6' }) : null,
      s('rect', { x: 0, y: y + 38, width: 6, height: NH, rx: 3, fill: `var(--sec-${b.tok})` }),
      s('text', { x: 16, y: y + 72, fill: 'var(--heading)', 'font-size': 15, 'font-weight': 700 }, b.name),
      ...wrap(b.hint, 18).map((t, j) => s('text', { x: 16, y: y + 94 + j * 17, fill: 'var(--muted)', 'font-size': 13 }, t))));
  });
  const R = routes();
  const isPlan = (r) => byId.get(r.a).plan || byId.get(r.b).plan; // связь с разделом в разработке — серый пунктир
  const lines = R.map((r) => s('path', { d: r.d, fill: 'none', stroke: isPlan(r) ? 'var(--muted)' : `var(--sec-${tone(byId.get(r.a))})`, 'stroke-dasharray': isPlan(r) ? '5 4' : null,
    'stroke-width': 1.7, opacity: '.42', 'marker-end': isPlan(r) ? 'url(#at-arr-plan)' : `url(#at-arr-${tone(byId.get(r.a))})` }));
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
      b.g.setAttribute('opacity', !on || near.has(nid) ? '1' : '.38'); // «в разработке» полупрозрачны только рамка и заливка, текст — полной силы
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
    const plan = n.plan;
    const g = s('g', { tabindex: 0, role: 'button', cursor: 'pointer', 'aria-label': `${nameOf(n)}${plan ? ' (в разработке)' : ''}: открыть, что внутри` },
      s('rect', { x: g0.x, y: g0.y, width: g0.w, height: g0.h, rx: 10, fill: plan ? 'var(--surface-2)' : n.big ? 'var(--primary-soft)' : `var(--sec-${tok}-soft)`,
        stroke: plan ? 'var(--muted)' : n.big ? 'var(--primary)' : `var(--sec-${tok})`, 'stroke-width': n.big ? 2.6 : 1.4, 'stroke-dasharray': plan ? '6 4' : null, 'fill-opacity': plan ? '.6' : null, 'stroke-opacity': plan ? '.7' : null }),
      s('text', { x: g0.x + 12, y: g0.y + 25, fill: 'var(--heading)', 'font-size': n.big ? 17 : 15, 'font-weight': 700 }, n.t),
      desc, ...rel,
      plan ? s('text', { x: g0.x + g0.w - 10, y: g0.y + g0.h - 9, 'text-anchor': 'end', fill: 'var(--muted)', 'font-size': 12, 'font-weight': 700 }, planLabel(plan))
        : parts ? s('text', { x: g0.x + g0.w - 10, y: g0.y + g0.h - 9, 'text-anchor': 'end', fill: n.big ? 'var(--primary)' : `var(--sec-${tok})`, 'font-size': 12, 'font-weight': 700 }, `внутри: ${parts} ›`) : null);
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
  const svg = s('svg', { viewBox: `0 0 ${W} 88`, width: '100%', role: 'img', 'aria-label': 'Легенда: цвет стрелки — из какого слоя идут сведения' });
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
    s('rect', { x: 630, y: 36, width: 34, height: 20, rx: 5, fill: 'var(--surface-2)', stroke: 'var(--muted)', 'stroke-dasharray': '5 3', opacity: '.7' }),
    s('text', { x: 672, y: 51, fill: 'var(--heading)', 'font-size': 13, 'font-weight': 600 }, 'в разработке или идея — ещё не сделано'),
    s('text', { x: 0, y: 80, fill: 'var(--muted)', 'font-size': 13 }, 'Наведите на блок — останутся только его связи, в соседях — что передаётся.'));
  return svg;
}

// ---------- телефон и узкий экран: те же блоки плитками по слоям ----------
function narrowList(open) {
  return h('div', null, ...BANDS.map((b) => h('section', null, h('h2', null, b.name),
    tileGrid(...NODES.filter((n) => n.band === b.id).map((n) => card({ size: 'S', title: nameOf(n), meta: (n.plan ? (n.plan === 'идея' ? 'Идея. ' : 'В разработке. ') : '') + n.l.join(' '), onClick: () => open(n.id) }))))));
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

    // схема рассчитана на 1200: уже — шрифт меньше 12 px, поэтому плитки. Ширина окна меняется — вид перестраивается (замечание C097 GPT)
    const mqMap = window.matchMedia('(min-width: 1240px)'), mqWin = window.matchMedia('(min-width: 1100px)');
    const head = h('div', { class: 'page-head' }, h('h1', null, 'Карта сайта'),
      h('span', { class: 'muted small' }, 'Как устроен сайт сверху вниз: от заказчика до денег. Нажмите блок — справа откроется, что внутри и с чем он связан.'));
    const body = h('div');
    // «С чего начать?» и «Всегда под рукой» убраны (просьба 2026-11-12: «на карте — только карта»):
    // карточки «Я хочу…» — в окне своего раздела, общие инструменты и так в меню
    const render = () => {
      const wide = mqMap.matches;
      map = wide ? bigMap(open) : null;
      body.replaceChildren(...[wide ? legend() : null, wide ? map.svg : narrowList(open)].filter(Boolean));
      if (current) { const keep = current; current = null; open(keep, true); }
    };
    const onWidth = () => render();
    mqMap.addEventListener('change', onWidth); mqWin.addEventListener('change', onWidth);
    el.append(head, body);
    render();
    if (params?.n && byId.has(params.n)) open(params.n);
    const destroy = () => { mqMap.removeEventListener('change', onWidth); mqWin.removeEventListener('change', onWidth); close(); };
    return { destroy };
  },
};
