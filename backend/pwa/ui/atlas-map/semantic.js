import { h, fill } from '../../core/dom.js';
import { HEIGHT, place, svg } from './layout.js';

const MOTION = 330;
const PRIORITY = { data: 0, process: 1, structure: 2, navigation: 3 };
const PADDING = 16;

function opposite(edge, id) { return edge.to === id ? edge.from : edge.to; }
function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }

function neighbors(anchor, edges, nodes, inspected) {
  const grouped = new Map();
  const ordered = edges.filter((edge) => edge.from === anchor || edge.to === anchor)
    .sort((a, b) => Number(a.planned) - Number(b.planned) || PRIORITY[a.kind] - PRIORITY[b.kind]);
  for (const edge of ordered) {
    const direction = edge.to === anchor ? 'incoming' : 'outgoing';
    const actual = opposite(edge, anchor);
    const owner = nodes.get(actual)?.section;
    const fold = !inspected && nodes.get(anchor)?.kind === 'section' && owner;
    const internal = fold && owner === anchor && actual !== anchor;
    const node = internal ? `group:${anchor}` : fold ? owner : actual;
    if (node === anchor) continue;
    const key = internal ? node : `${direction}:${node}`;
    const current = grouped.get(key);
    if (current) current.total++;
    else grouped.set(key, { node, direction, edge, internal, total: 1 });
  }
  return [...grouped.values()];
}

function sequence(index, count) {
  if (count % 2 === 0) return (Math.floor(index / 2) + 0.5) * (index % 2 ? 1 : -1);
  const step = Math.ceil(index / 2) * (index % 2 ? -1 : 1);
  return step;
}

function viewBoxes({ anchor, detail, origin, view, sections, peers }) {
  const cards = new Map();
  const lanes = ['incoming', 'outgoing'].map((direction) => peers.filter((peer) => peer.direction === direction));
  const sideWidth = clamp(view.w * 0.24, 116, 270);
  const hubWidth = Math.min(origin.w, view.w * 0.31);
  const gap = clamp(view.w * (detail === 2 ? 0.082 : 0.058), 18, 132);
  const height = detail === 2 ? 98 : 52;
  const pitch = height + (detail === 2 ? 23 : 17);
  const left = view.x + PADDING + (lanes[0].length ? sideWidth + gap : 0);
  const right = view.x + view.w - PADDING - hubWidth - (lanes[1].length ? sideWidth + gap : 0);
  const hubX = right >= left ? clamp(origin.x, left, right) : view.x + (view.w - hubWidth) / 2;
  const hub = { x: hubX, y: origin.y, w: hubWidth, h: origin.h };
  cards.set(anchor, { id: anchor, role: 'anchor', box: hub });
  const used = new Set([anchor]);
  const midpoint = hub.y + hub.h / 2;
  let bottom = hub.y + hub.h + 36;
  lanes.forEach((lane, side) => {
    lane.forEach((peer, index) => {
      const key = used.has(peer.node) ? `${peer.direction}:${peer.node}` : peer.node;
      used.add(peer.node);
      const offset = sequence(index, lane.length);
      const box = {
        x: side === 0 ? hub.x - gap - sideWidth : hub.x + hub.w + gap,
        y: midpoint + offset * pitch - height / 2, w: sideWidth, h: height,
      };
      bottom = Math.max(bottom, box.y + box.h);
      const port = offset * Math.min(12, (hub.h - 10) / Math.max(1, lane.length - 1));
      cards.set(key, { id: peer.node, box, role: peer.direction, peer, port });
    });
  });
  const context = sections.filter((node) => !used.has(node.id));
  const columns = Math.max(1, Math.floor((view.w - PADDING) / 166));
  const contextWidth = (view.w - PADDING * 2 - 12 * (columns - 1)) / columns;
  const contextTop = Math.max(view.y + view.h - 145, bottom + 55);
  context.forEach((node, index) => {
    const box = {
      x: view.x + PADDING + index % columns * (contextWidth + 12),
      y: contextTop + 35 + Math.floor(index / columns) * 52, w: contextWidth, h: 42,
    };
    cards.set(node.id, { id: node.id, box, role: 'context' });
  });
  const contextHeading = { x: view.x + PADDING, y: contextTop, w: view.w - PADDING * 2, h: 27 };
  const empty = !peers.length && { x: hub.x, y: hub.y + hub.h + 20, w: Math.max(190, hub.w), h: 38 };
  return { cards, contextHeading: context.length ? contextHeading : null, empty };
}

function boundsFor(cards, width) {
  const bounds = { left: 0, right: width, top: 0, bottom: HEIGHT };
  for (const { box } of cards.values()) {
    bounds.left = Math.min(bounds.left, box.x - PADDING);
    bounds.right = Math.max(bounds.right, box.x + box.w + PADDING);
    bounds.top = Math.min(bounds.top, box.y - PADDING);
    bounds.bottom = Math.max(bounds.bottom, box.y + box.h + PADDING);
  }
  return bounds;
}

function interpolate(box, target, amount) {
  const between = (key) => box[key] + (target[key] - box[key]) * amount;
  return { x: between('x'), y: between('y'), w: between('w'), h: between('h') };
}

function wireGeometry(hub, box, role, port) {
  const toHub = role === 'incoming';
  const hubPoint = { x: toHub ? hub.x - 5 : hub.x + hub.w + 5, y: hub.y + hub.h / 2 + port };
  const parallel = { x: toHub ? box.x + box.w + 5 : box.x - 5, y: box.y + box.h / 2 };
  const [from, to] = toHub ? [parallel, hubPoint] : [hubPoint, parallel];
  const run = (to.x - from.x) * 0.56;
  return { d: `M${from.x} ${from.y} C${from.x + run} ${from.y},${to.x - run} ${to.y},${to.x} ${to.y}`, from, to };
}

export function semanticScene({ stations, nodes, stationLayer, legendLayer, wires, makeStation, makeGroup, marker, onBounds }) {
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const extras = new Map();
  const contextHeading = h('h3', { class: 'am-context-heading', hidden: true }, 'Другие разделы');
  const empty = h('p', { class: 'am-local-empty', hidden: true }, 'Связей в выбранных слоях нет');
  legendLayer.append(contextHeading, empty);
  let boxes = new Map();
  let frame = 0;

  function obtain(key, entry) {
    if (stations.has(key)) return stations.get(key);
    if (!extras.has(key)) {
      const control = entry.peer?.internal ? makeGroup() : makeStation(nodes.get(entry.id), stations.has(entry.id));
      control.dataset.mapKey = key;
      extras.set(key, control);
      stationLayer.append(control);
    }
    return extras.get(key);
  }

  function syncCard(control, entry, step) {
    if (entry.role) control.dataset.mapRole = entry.role;
    else delete control.dataset.mapRole;
    if (entry.peer) control.dataset.relationLayer = entry.peer.edge.planned ? 'planned' : entry.peer.edge.kind;
    else delete control.dataset.relationLayer;
    const note = control.querySelector('.am-station-note');
    const { edge, total } = entry.peer || {};
    const label = entry.peer?.internal ? 'Открыть записи о составе' :
      [edge?.label, total > 1 ? `+${total - 1}` : null].filter(Boolean).join(' · ');
    note.title = [edge?.label, total > 1 ? `Других записей о связи: ${total - 1}` : null].filter(Boolean).join(' · ');
    note.textContent = label;
    note.hidden = !(step === 2 && label);
  }

  function render({ step, anchor, origin, view, layout, sections, edges, inspected, width }, animate) {
    cancelAnimationFrame(frame);
    const layoutPlan = step ? viewBoxes({ anchor, detail: step, origin, view, sections, peers: neighbors(anchor, edges, nodes, inspected) }) : null;
    const { cards } = layoutPlan || { cards: new Map([...layout.boxes].map(([id, box]) => [id, { id, box }])) };
    const live = new Map();
    const paths = new Map();
    for (const [key, entry] of cards) {
      const control = obtain(key, entry);
      syncCard(control, entry, step);
      live.set(key, control);
      if (!entry.peer) continue;
      const edge = entry.peer.edge;
      const selected = inspected === edge.id;
      const kind = edge.planned ? 'planned' : edge.kind;
      const data = { 'data-direction': entry.role, 'data-layer': kind };
      const path = svg('path', {
        class: 'am-local-wire am-connection', ...data, 'data-weight': selected ? 4 : 3,
        'data-edge': edge.id, 'marker-end': `url(#${marker(entry.role, kind)})`,
      });
      const start = svg('circle', { class: 'am-port', ...data, r: 3 });
      const end = svg('circle', { class: 'am-port', ...data, r: 3 });
      paths.set(key, { path, start, end });
    }
    for (const [key, control] of extras) {
      if (cards.has(key)) continue;
      control.remove();
      extras.delete(key);
    }
    for (const [key, control] of stations) control.hidden = !cards.has(key);
    fill(wires, [...paths.values()].flatMap(({ path, start, end }) => [path, start, end]));
    for (const [element, box] of [[contextHeading, layoutPlan?.contextHeading], [empty, layoutPlan?.empty]]) {
      element.hidden = !box;
      if (box) place(element, box);
    }
    const from = boxes;
    onBounds(boundsFor(cards, width));
    function paint(amount) {
      boxes = new Map();
      for (const [key, entry] of cards) {
        const start = from.get(key) || from.get(entry.id) || layout.boxes.get(nodes.get(entry.id)?.section) || entry.box;
        const current = interpolate(start, entry.box, amount);
        boxes.set(key, current);
        place(live.get(key), current);
      }
      for (const [key, { path, start, end }] of paths) {
        const entry = cards.get(key);
        const line = wireGeometry(boxes.get(anchor), boxes.get(key), entry.role, entry.port);
        path.setAttribute('d', line.d);
        for (const [dot, coordinates] of [[start, line.from], [end, line.to]]) {
          dot.setAttribute('cx', coordinates.x);
          dot.setAttribute('cy', coordinates.y);
        }
      }
    }
    if (!animate || motion.matches || !from.size) { paint(1); return; }
    const start = performance.now();
    const tick = (now) => {
      const progress = clamp((now - start) / MOTION, 0, 1);
      paint(1 - (1 - progress) ** 3);
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    paint(0);
    frame = requestAnimationFrame(tick);
  }

  return {
    render,
    box(nodeId, control) { return boxes.get(control?.dataset.mapKey || nodeId); },
    control(nodeId) { return stations.get(nodeId) || extras.get(nodeId); },
    controls() { return [...stations.values(), ...extras.values()]; },
    destroy() { cancelAnimationFrame(frame); },
  };
}
