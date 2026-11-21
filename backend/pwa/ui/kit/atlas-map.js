// Одна схема сайта: области, разделы, затем связи и содержимое конкретного узла.
import { h, fill } from '../../core/dom.js';
import { icon } from '../icons.js';
import { button } from './index.js';
import { atlasHierarchy, atlasScene } from '../atlas-map/layout.js';
import { svg, place, interpolate, span, wireGeometry, applyView, panInto, bindAtlasDrag } from '../atlas-map/geometry.js';

const MOTION = 360;
const PRIMARY = { sale: 'salesorders', prod: 'products', paper: 'design', make: 'work', supply: 'requests',
  stock: 'stock', after: 'shiporder', money: 'money', system: 'servers', quality: 'fill' };
let nextId = 0;

export function atlasMap({ model, trace: walk, onSelect }) {
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
  const frame = h('div', { class: 'am-frame', hidden: true, 'aria-hidden': 'true' });
  const live = h('span', { class: 'am-live', role: 'status' });
  plate.append(frame, drawing, stations);
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
  let drawnFrame;
  let dest = new Map();
  let bounds = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  let animation = 0;
  let lastWheel = null;
  let previousView = null;
  let pointer = null;
  let hovered = null;
  let wireList = [];
  let directedWires = [];

  function size() {
    return { x: -pan.x, y: -pan.y, w: viewport.clientWidth || 960, h: viewport.clientHeight || 650 };
  }
  function anchor() { return path.at(-1); }
  function currentView() { return views.get(anchor()) || size(); }
  function move() { applyView(plate, viewport, pan, bounds); }
  function panBy(x, y) { pan.x += x; pan.y += y; move(); refreshHover(); }

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
    control.toggleAttribute('data-context', Boolean(card.context));
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
      ...(wire.context ? { 'data-context': '' } : {}),
      ...(wire.kind === 'containment' ? {} : { 'marker-end': 'url(#' + prefix + '-' + direction + ')' }),
    });
    if (wire.edge?.label) {
      const title = svg('title');
      title.textContent = wire.edge.label;
      connection.append(title);
    }
    const start = svg('circle', { class: 'am-port', ...attrs, r: 2.8 });
    const end = svg('circle', { class: 'am-port', ...attrs, 'data-port': 'end', r: 2.8 });
    const stem = wire.route === 'trunk' ? svg('path', { class: 'am-active-stem' }) : null;
    const group = svg('g', { class: 'am-wire-group', 'data-route': wire.route || '',
      'data-from-key': wire.from, 'data-to-key': wire.to }, connection, start, end);
    if (stem) group.append(stem);
    return { wire, group, connection, start, end, stem, activeEnd: null };
  }

  function updateLine(entry, positions, scope) {
    const { wire, connection, start, end } = entry;
    let from = positions.get(wire.from), to = positions.get(wire.to);
    if (!from || !to) return;
    if (scope && wire.frameEnd === 'from') from = { ...scope, y: to.y, h: to.h };
    if (scope && wire.frameEnd === 'to') to = { ...scope, y: from.y, h: from.h };
    const line = wireGeometry(from, to, wire);
    connection.setAttribute('d', line.d);
    start.setAttribute('cx', line.origin.x);
    start.setAttribute('cy', line.origin.y);
    end.setAttribute('cx', line.end.x);
    end.setAttribute('cy', line.end.y);
    updateStem(entry, positions);
  }

  function updateStem(entry, positions) {
    if (!entry.stem) return;
    const from = positions.get(entry.wire.from);
    const to = positions.get(entry.activeEnd);
    if (from && to) entry.stem.setAttribute('d', wireGeometry(from, to, entry.wire).d);
    else entry.stem.removeAttribute('d');
  }

  function cardAt(target) {
    const card = target?.closest?.('.am-station[data-key]');
    return card && controls.get(card.dataset.key) === card ? card : null;
  }

  function markTrace(element, activeSet, key) {
    if (activeSet) element.dataset.trace = activeSet.has(key) ? 'active' : 'muted';
    else delete element.dataset.trace;
  }

  function paintTrace() {
    const trace = hovered && walk(directedWires, hovered.dataset.key, 'both');
    if (hovered) {
      el.dataset.hover = hovered.dataset.node;
      el.dataset.hoverKey = hovered.dataset.key;
    } else {
      delete el.dataset.hover;
      delete el.dataset.hoverKey;
    }
    for (const [key, control] of controls) markTrace(control, trace?.nodeIds, key);
    const branchEnds = new Map();
    for (const id of trace?.edgeIds || []) {
      const { wire } = wireList[id];
      if (wire.route !== 'branch') continue;
      const current = branchEnds.get(wire.from);
      if (!current || dest.get(current).y < dest.get(wire.to).y) branchEnds.set(wire.from, wire.to);
    }
    for (const [index, entry] of wireList.entries()) {
      const { wire, group, stem } = entry;
      if (stem) {
        entry.activeEnd = branchEnds.get(wire.from);
        if (trace) group.dataset.trace = entry.activeEnd ? 'active' : 'muted';
        else delete group.dataset.trace;
        updateStem(entry, boxes);
      } else markTrace(group, trace?.edgeIds, index);
    }
  }

  function setHover(card, force = false) {
    if (card === hovered && !force) return;
    hovered = card;
    paintTrace();
  }

  function refreshHover(force = false) {
    const target = pointer && !viewport.classList.contains('is-dragging') ? document.elementFromPoint(pointer.x, pointer.y) : null;
    setHover(cardAt(target), force);
  }

  function pointAtCard(event) {
    if (event.pointerType === 'touch') return;
    pointer = { x: event.clientX, y: event.clientY };
    setHover(viewport.classList.contains('is-dragging') ? null : cardAt(event.target));
  }

  function leaveCanvas() { pointer = null; setHover(null); }

  function render(animate = false, previousId) {
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
    const previousWires = new Set(wireList.map(({ wire }) => wire.key));
    wireList = plan.wires.map(wireElement);
    // Ключи проекции различают две видимые карточки одного и того же узла.
    directedWires = wireList.flatMap(({ wire }, id) => wire.route === 'trunk' ? [] : [{ id, from: wire.from, to: wire.to }]);
    fill(paths, wireList.map(({ group }) => group));
    const before = boxes;
    const emergence = origin || before.get(previousId);
    const oldFrame = drawnFrame || emergence || plan.frame;
    const closedFrame = !plan.frame && drawnFrame && animate && !motion.matches
      ? plan.cards.get(data.chain(previousId)[0])?.box
      : null;
    const nextFrame = plan.frame || closedFrame;
    dest = new Map([...plan.cards].map(([key, entry]) => [key, entry.box]));
    bounds = span(plan.cards, size());
    move();

    function paint(progress, appearance = 1) {
      boxes = new Map();
      drawnFrame = nextFrame && interpolate(oldFrame, nextFrame, progress);
      if (drawnFrame) place(frame, drawnFrame);
      frame.hidden = !nextFrame || Boolean(closedFrame && progress === 1);
      frame.style.opacity = closedFrame ? 1 - progress : '';
      for (const [key, target] of dest) {
        const drawn = before.get(key);
        const original = drawn || (emergence
          ? { ...target, x: target.x * 0.54 + emergence.x * 0.46, y: target.y * 0.54 + emergence.y * 0.46 }
          : target);
        const box = interpolate(original, target, progress);
        const control = controls.get(key);
        control.style.opacity = drawn || appearance === 1 ? '' : appearance;
        place(control, box);
        boxes.set(key, box);
      }
      for (const entry of wireList) {
        entry.group.style.opacity = previousWires.has(entry.wire.key) || appearance === 1 ? '' : appearance;
        updateLine(entry, boxes, drawnFrame);
      }
    }
    if (!animate || motion.matches || !before.size) { paint(1); refreshHover(true); return; }
    paint(0, 0);
    refreshHover(true);
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min(1, Math.max(0, (now - start) / MOTION));
      paint(1 - (1 - progress) ** 3, Math.min(progress * 2, 1));
      if (progress < 1) animation = requestAnimationFrame(tick);
      else refreshHover();
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
    render(true, previous);
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
    lastWheel = { x: event.clientX, y: event.clientY, after: performance.now() + MOTION - 45 };
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
    if (box) { panInto(pan, box, viewport); move(); refreshHover(); }
  });
  bindAtlasDrag(viewport, panBy);
  viewport.addEventListener('pointerover', pointAtCard);
  viewport.addEventListener('pointermove', pointAtCard);
  viewport.addEventListener('pointerleave', leaveCanvas);
  viewport.addEventListener('pointercancel', leaveCanvas);
  viewport.addEventListener('lostpointercapture', () => refreshHover());

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
