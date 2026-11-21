// Одна схема сайта: области, разделы, затем связи и содержимое конкретного узла.
import { h, fill } from '../../core/dom.js';
import { icon } from '../icons.js';
import { button } from './index.js';
import { atlasHierarchy, atlasScene } from '../atlas-map/layout.js';
import { svg, place, interpolate, span, wireGeometry, applyView, panInto, bindAtlasDrag } from '../atlas-map/geometry.js';

const MOTION = 320;
const PRIMARY = { sale: 'salesorders', prod: 'products', paper: 'design', make: 'work', supply: 'requests',
  stock: 'stock', after: 'shiporder', money: 'money', system: 'servers', quality: 'fill' };
let nextId = 0;

export function atlasMap({ model, onSelect }) {
  const prefix = 'am-' + ++nextId;
  const data = atlasHierarchy(model);
  const focus = new Map();
  const views = new Map();
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const el = h('section', { class: 'atlas-map', dataset: { level: 0 }, 'aria-label': 'Карта сайта' });
  const viewport = h('div', {
    class: 'am-viewport', tabindex: '0', role: 'region', 'aria-label': 'Карта областей, разделов и связей',
    'aria-keyshortcuts': 'Escape + - ArrowLeft ArrowRight ArrowUp ArrowDown',
  });
  const plate = h('div', { class: 'am-plate' });
  const paths = svg('g');
  const markers = svg('defs');
  const drawing = svg('svg', { class: 'am-drawing', 'aria-hidden': 'true' }, markers, paths);
  const stations = h('div', { class: 'am-stations' });
  const live = h('span', { class: 'am-live', role: 'status' });
  plate.append(drawing, stations);
  viewport.append(plate);
  el.append(viewport, live);

  for (const direction of ['incoming', 'outgoing']) {
    markers.append(svg('marker', {
      id: prefix + '-' + direction, class: 'am-arrow', 'data-direction': direction, viewBox: '0 0 9 9',
      markerWidth: 8, markerHeight: 8, refX: 8.5, refY: 4.5, markerUnits: 'userSpaceOnUse', orient: 'auto',
    }, svg('path', { d: 'M0 0 L9 4.5 L0 9 Z' })));
  }

  const controls = new Map();
  let path = [];
  let pan = { x: 0, y: 0 };
  let boxes = new Map();
  let dest = new Map();
  let bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  let animation = 0;
  let lastWheel = null;
  let previousView = null;

  function size() {
    return { x: -pan.x, y: -pan.y, w: viewport.clientWidth || 960, h: viewport.clientHeight || 650 };
  }
  function anchor() { return path.at(-1); }
  function currentView() { return views.get(anchor()) || size(); }
  function move() { applyView(plate, viewport, pan, bounds); }
  function panBy(x, y) { pan.x += x; pan.y += y; move(); }

  function buildCard(key, card) {
    const control = button({
      label: h('span', { class: 'am-card-text' }, h('strong', { class: 'am-card-title' }, card.node.title),
        h('span', { class: 'am-card-note' })),
      cls: 'am-station',
      onClick: () => expand(control.dataset.node, control),
    });
    if (card.node.icon) control.prepend(icon(card.node.icon, 'am-area-icon'));
    control.dataset.key = key;
    control.dataset.node = card.node.id;
    control.dataset.kind = card.node.kind;
    control.dataset.band = card.node.band;
    control.dataset.planned = String(Boolean(card.node.planned));
    controls.set(key, control);
    stations.append(control);
    return control;
  }

  function syncCard(key, card) {
    const control = controls.get(key) || buildCard(key, card);
    const note = control.querySelector('.am-card-note');
    note.textContent = card.note || (card.node.planned ? 'В планах' : '');
    note.hidden = !note.textContent;
    control.dataset.role = card.role;
    control.dataset.atlasNode = card.node.id;
    control.title = [card.node.title, card.relationTitle || card.note, card.node.planned ? 'В планах' : null].filter(Boolean).join(' · ');
    control.setAttribute('aria-current', card.role === 'anchor' ? 'true' : 'false');
    return control;
  }

  function wireElement(wire) {
    const direction = wire.direction || 'outgoing';
    const attrs = { 'data-direction': direction, 'data-kind': wire.kind };
    const connection = svg('path', {
      class: 'am-wire', ...attrs, 'data-edge': wire.edge?.id || '', 'data-from': wire.edge?.from || wire.from, 'data-to': wire.edge?.to || wire.to,
      ...(wire.kind === 'containment' ? {} : { 'marker-end': 'url(#' + prefix + '-' + direction + ')' }),
    });
    if (wire.edge?.label) {
      const title = svg('title');
      title.textContent = wire.edge.label;
      connection.append(title);
    }
    const start = svg('circle', { class: 'am-port', ...attrs, r: 2.8 });
    const end = svg('circle', { class: 'am-port', ...attrs, r: 2.8 });
    return { wire, connection, start, end };
  }

  function updateLine(entry, positions) {
    const { wire, connection, start, end } = entry;
    const from = positions.get(wire.from), to = positions.get(wire.to);
    if (!from || !to) return;
    const line = wireGeometry(from, to, wire);
    connection.setAttribute('d', line.d);
    start.setAttribute('cx', line.origin.x);
    start.setAttribute('cy', line.origin.y);
    end.setAttribute('cx', line.end.x);
    end.setAttribute('cy', line.end.y);
  }

  function render(animate = false) {
    cancelAnimationFrame(animation);
    const id = anchor();
    const view = currentView();
    const origin = focus.get(id);
    const plan = atlasScene(data, id, origin, view);
    el.dataset.level = String(path.length);
    if (id) el.dataset.anchor = id;
    else delete el.dataset.anchor;
    live.textContent = id ? data.nodes.get(id).title : 'Области сайта';
    for (const [key, control] of controls) {
      if (plan.cards.has(key)) continue;
      control.remove();
      controls.delete(key);
    }
    for (const [key, card] of plan.cards) syncCard(key, card);
    const wireList = plan.wires.map(wireElement);
    fill(paths, wireList.flatMap(({ connection, start, end }) => [connection, start, end]));
    const before = boxes;
    dest = new Map([...plan.cards].map(([key, entry]) => [key, entry.box]));
    bounds = span(plan.cards, size());
    move();

    function paint(progress) {
      boxes = new Map();
      for (const [key, target] of dest) {
        const drawn = before.get(key);
        const original = drawn || (origin
          ? { ...target, x: target.x * 0.54 + origin.x * 0.46, y: target.y * 0.54 + origin.y * 0.46 }
          : target);
        const box = interpolate(original, target, progress);
        place(controls.get(key), box);
        boxes.set(key, box);
      }
      for (const wire of wireList) updateLine(wire, boxes);
    }
    if (!animate || motion.matches || !before.size) { paint(1); return; }
    paint(0);
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, Math.max(0, (now - start) / MOTION));
      paint(1 - (1 - progress) ** 3);
      if (progress < 1) animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
  }

  function enter(nodeId, opener, notify) {
    if (nodeId === anchor()) return false;
    const next = data.chain(nodeId);
    if (nodeId && !next.length) return false;
    const keyboard = viewport.contains(document.activeElement);
    const parent = next.at(-2);
    const previous = anchor();
    const back = previous && next.length < path.length && (!nodeId || path.includes(nodeId));
    if (previous && !back) views.set(previous, size());
    const from = boxes.get(opener?.dataset.key || nodeId) || boxes.get(parent);
    if (nodeId && !back) {
      const view = size();
      const onScreen = from && from.x < view.x + view.w && from.x + from.w > view.x &&
        from.y < view.y + view.h && from.y + from.h > view.y;
      focus.set(nodeId, onScreen ? from : null);
      views.set(nodeId, view);
    }
    if (back && nodeId && views.has(nodeId)) {
      const view = views.get(nodeId);
      pan = { x: -view.x, y: -view.y };
    }
    if (!nodeId) pan = { x: 0, y: 0 };
    path = next;
    render(true);
    if (keyboard && !viewport.contains(document.activeElement)) {
      (controls.get(nodeId) || viewport).focus({ preventScroll: true });
    }
    if (notify) onSelect?.(nodeId || null);
    return true;
  }

  function expand(nodeId, opener) {
    if (!nodeId) return false;
    const node = data.nodes.get(nodeId);
    if (!node) return false;
    if (anchor() !== nodeId) return enter(nodeId, opener, true);
    const child = node.kind === 'area'
      ? PRIMARY[node.band] || data.sectionsByBand.get(node.band)?.[0]?.id
      : node.id === 'products' ? 'products.sostav' : data.children.get(node.id)?.[0]?.id;
    return child ? enter(child, controls.get(child) || opener, true) : false;
  }

  function back() {
    return path.length ? enter(path.at(-2) || null, controls.get(anchor()), true) : false;
  }

  viewport.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.metaKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const related = event.target.closest?.('.am-station[data-node]');
    const stationary = lastWheel && Math.hypot(event.clientX - lastWheel.x, event.clientY - lastWheel.y) <= 3;
    const target = stationary && path.length && event.deltaY < 0 ? controls.get(anchor()) : related;
    if (lastWheel && stationary && performance.now() < lastWheel.after) { event.preventDefault(); return; }
    const changed = event.deltaY > 0 ? back() : expand(target?.dataset.node, target);
    if (!changed) return;
    event.preventDefault();
    lastWheel = { x: event.clientX, y: event.clientY, after: performance.now() + 260 };
  }, { passive: false });
  viewport.addEventListener('keydown', (event) => {
    const target = event.target.closest?.('.am-station[data-node]');
    if (event.key === 'Escape' || event.key === '-') {
      if (!back()) return;
      event.stopPropagation();
    } else if (event.key === '+' || event.key === '=') {
      const node = target?.dataset.node || anchor() || 'area:sale';
      if (!expand(node, target)) return;
    } else {
      if (event.target !== viewport) return;
      const vector = { ArrowLeft: [56, 0], ArrowRight: [-56, 0], ArrowUp: [0, 56], ArrowDown: [0, -56] }[event.key];
      if (!vector) return;
      panBy(...vector);
    }
    event.preventDefault();
  });
  viewport.addEventListener('focusin', (event) => {
    const box = dest.get(event.target.dataset.key);
    if (box) { panInto(pan, box, viewport); move(); }
  });
  bindAtlasDrag(viewport, panBy);

  render();
  const resize = new ResizeObserver(() => {
    const view = size();
    if (previousView?.w === view.w && previousView?.h === view.h) return;
    previousView = view;
    const current = views.get(anchor());
    if (current) views.set(anchor(), { ...current, w: view.w, h: view.h });
    render();
  });
  resize.observe(viewport);
  return { el, pin(nodeId) { enter(nodeId || null, null, false); },
    destroy() { resize.disconnect(); cancelAnimationFrame(animation); } };
}
