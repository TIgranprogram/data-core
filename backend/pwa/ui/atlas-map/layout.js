import { h, fill } from '../../core/dom.js';
import { icon } from '../icons.js';

export const TERRITORIES = [
  { id: 'quality', column: 0, row: 0, icon: 'ok' },
  { id: 'paper', column: 1, row: 0, icon: 'dicts' },
  { id: 'supply', column: 2, row: 0, span: 3, columns: 2, icon: 'requests' },
  { id: 'sale', column: 0, row: 1, icon: 'partners', main: 'salesorders' },
  { id: 'prod', column: 1, row: 1, icon: 'catalog', main: 'products' },
  { id: 'make', column: 2, row: 1, icon: 'ops', main: 'work' },
  { id: 'after', column: 3, row: 1, icon: 'moves', main: 'shiporder' },
  { id: 'money', column: 4, row: 1, icon: 'money', main: 'money' },
  { id: 'stock', column: 0, row: 2, span: 2, columns: 2, icon: 'stock' },
  { id: 'system', column: 2, row: 2, span: 3, columns: 3, icon: 'admin' },
];
export const HEIGHT = 697;
export const MIN_WIDTH = 920;

export function svg(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
  el.append(...children);
  return el;
}

export function place(el, { x, y, w, h: height }) {
  el.style.setProperty('--am-x', `${x}px`);
  el.style.setProperty('--am-y', `${y}px`);
  el.style.setProperty('--am-w', `${w}px`);
  el.style.setProperty('--am-h', `${height}px`);
}

export function geometry(width, sections) {
  const gap = 26;
  const margin = 24;
  const column = (width - 2 * margin - 4 * gap) / 5;
  const rows = [{ y: 23, h: 156 }, { y: 233, h: 250 }, { y: 518, h: 156 }];
  const areas = TERRITORIES.map((territory) => {
    const { span = 1, row } = territory;
    return { ...territory, ...rows[row], x: margin + territory.column * (column + gap), w: span * column + (span - 1) * gap };
  });
  const boxes = new Map();
  for (const area of areas) {
    const { columns = 1 } = area;
    const w = (area.w - 24) / columns - 9 * (columns - 1) / columns;
    sections.filter((node) => node.band === area.id).forEach((node, index) => {
      boxes.set(node.id, {
        x: area.x + 12 + (index % columns) * (w + 9),
        y: area.y + 52 + Math.floor(index / columns) * 49, w, h: 41, area,
      });
    });
  }
  return { areas, boxes };
}

export function pathFor(a, b, lane) {
  const dir = b.x >= a.x ? 1 : -1;
  const corridor = 7 + (lane % 4) * 3;
  const sameArea = a.area === b.area;
  const across = !sameArea || Math.abs(a.y - b.y) < 24;
  const side = across ? dir : 1;
  const x1 = a.x + (side > 0 ? a.w : 0);
  const x2 = b.x + ((across ? -side : side) > 0 ? b.w : 0);
  const y1 = a.y + a.h / 2;
  const y2 = b.y + b.h / 2;
  const rail = (x, direction, box) => {
    const rim = direction > 0 ? box.area.x + box.area.w : box.area.x;
    return Math.abs(x - rim) > 15 ? x + direction * 4 : rim + direction * corridor;
  };
  const rail1 = rail(x1, side, a);
  const rail2 = rail(x2, across ? -side : side, b);
  const laneY = a.area.row === 2 || b.area.row === 2 ? 488 + (lane % 5) * 5 : 184 + (lane % 5) * 5;
  if (sameArea && !across && a.x === b.x) return `M${x1} ${y1} H${rail1} V${y2} H${x2}`;
  if (sameArea && y1 === y2 && Math.abs(x2 - x1) <= 10) return `M${x1} ${y1} H${x2}`;
  if (sameArea) {
    const rowGap = Math.min(a.y, b.y) + a.h + 4;
    return `M${x1} ${y1} H${rail1} V${rowGap} H${rail2} V${y2} H${x2}`;
  }
  return `M${x1} ${y1} H${rail1} V${laneY} H${rail2} V${y2} H${x2}`;
}

export function drawTerritories({ drawing, width, plate, layout, territories, rails, headings, stations, groups }) {
  drawing.setAttribute('width', width);
  drawing.setAttribute('height', HEIGHT);
  drawing.setAttribute('viewBox', `0 0 ${width} ${HEIGHT}`);
  plate.style.setProperty('--am-width', `${width}px`);
  plate.style.setProperty('--am-height', `${HEIGHT}px`);
  fill(territories, layout.areas.map((area) => svg('rect', {
    x: area.x, y: area.y, width: area.w, height: area.h, rx: 10, class: 'am-area', 'data-band': area.id,
  })));
  const main = layout.areas.filter((area) => area.row === 1);
  const anchors = main.map((area) => area.x + area.w / 2);
  fill(rails,
    svg('path', { class: 'am-spine', d: `M${anchors[0]} 219 H${anchors.at(-1)}` }),
    ...anchors.slice(1).map((point, index) => {
      const x = (anchors[index] + point) / 2;
      return svg('path', { class: 'am-spine-chevron', d: `M${x - 3} 215 L${x + 2} 219 L${x - 3} 223` });
    }),
    ...anchors.map((x, index) => svg('path', { 'data-band': main[index].id, class: 'am-spine-stop', d: `M${x} 214 V233` })),
  );
  fill(headings, layout.areas.map((area) => {
    const group = groups.get(area.id);
    const title = h('h3', { class: 'am-area-label', dataset: { band: area.id, row: area.row } },
      icon(area.icon), h('span', null, group?.title || group?.name || area.id));
    place(title, { x: area.x + 12, y: area.y + 8, w: area.w - 24, h: 40 });
    return title;
  }));
  for (const [nodeId, control] of stations) {
    const box = layout.boxes.get(nodeId);
    if (box) place(control, box);
  }
}

export function bindPan(viewport, { canStart, read, update, onStart }) {
  let drag = null;
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || !canStart(event)) return;
    viewport.setPointerCapture(event.pointerId);
    drag = { x: event.clientX, y: event.clientY, pan: { ...read() } };
    viewport.classList.add('is-dragging');
    onStart();
  });
  viewport.addEventListener('pointermove', (event) => {
    if (drag) update(drag.pan.x + event.clientX - drag.x, drag.pan.y + event.clientY - drag.y);
  });
  viewport.addEventListener('lostpointercapture', () => {
    drag = null;
    viewport.classList.remove('is-dragging');
  });
  return () => Boolean(drag);
}

export function keepInView(camera, box, viewport) {
  const fit = (offset, min, size, available) => {
    const start = offset + min;
    return start < 0 || start + size > available ? (available - size) / 2 - min : offset;
  };
  camera.x = fit(camera.x, box.x, box.w, viewport.clientWidth);
  camera.y = fit(camera.y, box.y, box.h, viewport.clientHeight);
}

export function spanBoxes(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function applyCamera(plate, viewport, camera, bounds) {
  const clamp = (offset, size, min, max) => {
    const world = max - min;
    return size >= world ? (size - world) / 2 - min : Math.max(size - max, Math.min(-min, offset));
  };
  camera.x = clamp(camera.x, viewport.clientWidth, bounds.left, bounds.right);
  camera.y = clamp(camera.y, viewport.clientHeight, bounds.top, bounds.bottom);
  plate.style.setProperty('--am-pan-x', `${camera.x}px`);
  plate.style.setProperty('--am-pan-y', `${camera.y}px`);
}

export function bindViewportKeys(viewport, { escape, panBy, change, reset }) {
  viewport.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && escape()) { event.stopPropagation(); return; }
    const command = { '+': 1, '=': 1, '-': -1, '−': -1 }[event.key];
    if (command) {
      if (change(command, event.target)) event.preventDefault();
      return;
    }
    if (event.target !== viewport) return;
    const pan = { ArrowLeft: [54, 0], ArrowRight: [-54, 0], ArrowUp: [0, 54], ArrowDown: [0, -54] }[event.key];
    if (pan) panBy(...pan);
    else if (event.key === '0' || event.key === 'Home') reset();
    else return;
    event.preventDefault();
  });
}

export function bindWheel(viewport, { targetOf, change, holdsTarget }) {
  let last = null;
  viewport.addEventListener('wheel', (event) => {
    if (event.ctrlKey || event.metaKey || !event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const stationary = last && Math.hypot(event.clientX - last.x, event.clientY - last.y) <= 3;
    const target = stationary && holdsTarget(last.target) ? last.target : targetOf(event.target);
    if (!target) return;
    const now = performance.now();
    if (last?.target === target && now < last.after) {
      event.preventDefault();
      return;
    }
    if (!change(-Math.sign(event.deltaY), target)) return;
    event.preventDefault();
    last = { x: event.clientX, y: event.clientY, target, after: now + 280 };
  }, { passive: false });
}
