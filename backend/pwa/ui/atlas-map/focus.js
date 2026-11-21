import { h } from '../../core/dom.js';
import { button, segmented } from '../kit/index.js';
import { place, svg } from './layout.js';

const STEPS = ['Обзор', 'Связи', 'Подписи'];
const GROUPS = [
  { key: 'in', title: 'Источники' },
  { key: 'out', title: 'Получатели' },
];
const DURATION = 360;
let nextId = 0;

function displayName(node) {
  if (node.id === 'modules') return 'Модуль (сборка)';
  if (node.id === 'parts') return 'Деталь';
  return node.title;
}

function geometry(width, height, level, records) {
  const span = Math.min(width - 36, 1440);
  const hubW = Math.min(222, span * 0.25);
  const sideW = Math.min(300, span * 0.27);
  const gap = Math.max(6, (span - hubW - 2 * sideW) / 2) * [0.44, 0.73, 1][level];
  const cardH = [70, 68, 92][level];
  const row = height * 0.52;
  const hub = { x: (width - hubW) / 2, y: row - 58, w: hubW, h: 116 };
  const boxes = new Map([['hub', hub]]);
  for (const group of GROUPS) {
    const groupRecords = records.filter((record) => record.direction === group.key);
    const left = group.key === 'in';
    const x = left ? hub.x - gap - sideW : hub.x + hub.w + gap;
    const base = row - 74;
    const space = [12, 96, 132][level];
    boxes.set(`heading-${group.key}`, { x, y: 28, w: sideW, h: 32 });
    boxes.set(`group-${group.key}`, { x, y: base, w: sideW, h: 148 });
    groupRecords.forEach((record, i) => {
      const offset = i - (groupRecords.length - 1) / 2;
      boxes.set(record.id, { x, y: row + offset * space - cardH / 2, w: sideW, h: cardH, port: offset * 27 });
    });
  }
  return boxes;
}

function curve(startX, startY, endX, endY) {
  const curveX = (endX - startX) * 0.56;
  return `M${startX} ${startY} C${startX + curveX} ${startY},${endX - curveX} ${endY},${endX} ${endY}`;
}

function midpoint(box) { return box.y + box.h / 2; }

function layoutTween(from, to, position) {
  return new Map([...to].map(([id, box]) => {
    const start = from.get(id) || box;
    return [id, Object.fromEntries(Object.entries(box).map(([key, next]) => [key, start[key] + (next - start[key]) * position]))];
  }));
}

export function atlasFocus({ model, id, onExit }) {
  const prefix = `af-${++nextId}`;
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const node = nodes.get(id);
  const parent = nodes.get(node?.section);
  const records = model.edges.filter((edge) => edge.kind === 'data' && !edge.planned && (edge.from === id || edge.to === id)).flatMap((edge) => {
    const incoming = edge.to === id;
    const endpoint = nodes.get(incoming ? edge.from : edge.to);
    return endpoint ? [{ id: edge.id, node: endpoint, label: edge.label, direction: incoming ? 'in' : 'out' }] : [];
  });
  const back = button({ label: '← К общей карте', kind: 'ghost', cls: 'af-back', onClick: () => onExit?.() });
  const el = h('section', { class: 'atlas-focus', dataset: { level: 0 }, 'aria-label': node ? `${parent?.title || ''} · ${node.title}` : 'Связи раздела' });
  if (!node) {
    el.append(back, h('p', null, 'Раздел в карте не найден.'));
    return { el, destroy() {} };
  }

  let level = 0;
  let frameId = 0;
  let wheelAfter = 0;
  let positions = null;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const controls = segmented({ items: STEPS.map((label, key) => ({ key, label })), value: level, fit: true,
    label: 'Детализация связей', cls: 'af-steps', onChange: (key) => setLevel(key) });
  const wheelHint = h('p', { id: `${prefix}-hint`, class: 'af-hint' }, 'Колесо мыши или ↑ и ↓ меняют детализацию');
  const stage = h('div', { class: 'af-canvas', role: 'region', tabindex: '0', 'aria-label': 'Связи состава', 'aria-describedby': wheelHint.id });
  const defs = svg('defs', {}, ...GROUPS.map(({ key }) => svg('marker', {
    id: `${prefix}-${key}`, class: 'af-arrow', 'data-direction': key, viewBox: '0 0 9 9', markerWidth: 9, markerHeight: 9,
    refX: 8, refY: 4.5, markerUnits: 'userSpaceOnUse', orient: 'auto',
  }, svg('path', { d: 'M1 1 L8 4.5 L1 8 Z' }))));
  const paths = new Map([...GROUPS.map(({ key }) => [key, key, true]), ...records.map((record) => [record.id, record.direction, false])]
    .map(([key, dir, bundled]) => [key, svg('path', {
      class: bundled ? 'af-line af-bundled' : 'af-line af-individual', 'data-direction': dir, 'marker-end': `url(#${prefix}-${dir})`,
    })]));
  const drawing = svg('svg', { class: 'af-lines', 'aria-hidden': 'true' }, defs, ...paths.values());
  const hub = h('div', { class: 'af-hub', dataset: { node: id } },
    h('span', { class: 'af-parent' }, parent?.title || ''), h('h2', null, node.title));
  const cards = new Map([['hub', hub]]);
  const sideCards = [];
  const bundles = [];
  const notes = [];
  const sides = GROUPS.map((group) => {
    const groupRecords = records.filter((record) => record.direction === group.key);
    const caption = h('h3', { class: 'af-column', dataset: { direction: group.key } }, group.title,
      h('span', { class: 'af-count' }, String(groupRecords.length)));
    const bundle = h('ul', { class: 'af-bundle', dataset: { direction: group.key } },
      groupRecords.map((record) => h('li', null, displayName(record.node))));
    cards.set(`heading-${group.key}`, caption);
    cards.set(`group-${group.key}`, bundle);
    bundles.push(bundle);
    const children = groupRecords.map((record) => {
      const note = h('p', { class: 'af-relation-note' }, record.label);
      const card = h('div', { class: 'af-card', dataset: { node: record.node.id, direction: group.key } },
        h('h3', { class: 'af-title' }, displayName(record.node)), note);
      notes.push(note);
      cards.set(record.id, card);
      sideCards.push(card);
      return card;
    });
    return h('section', { class: 'af-side', 'aria-label': group.title }, caption, bundle, children);
  });
  stage.append(drawing, sides[0], hub, sides[1]);
  el.append(h('div', { class: 'af-toolbar' }, back, controls.el), stage, wheelHint);

  function paint(boxes) {
    positions = boxes;
    for (const [key, element] of cards) place(element, boxes.get(key));
    const center = boxes.get('hub');
    const middle = midpoint(center);
    const right = center.x + center.w;
    for (const { key } of GROUPS) {
      const group = boxes.get(`group-${key}`);
      paths.get(key).setAttribute('d', key === 'in'
        ? curve(group.x + group.w, midpoint(group), center.x - 1, middle)
        : curve(right, middle, group.x - 1, midpoint(group)));
    }
    for (const record of records) {
      const box = boxes.get(record.id);
      paths.get(record.id).setAttribute('d', record.direction === 'in'
        ? curve(box.x + box.w, midpoint(box), center.x - 1, middle + box.port)
        : curve(right, middle + box.port, box.x - 1, midpoint(box)));
    }
  }

  function draw(animate = false) {
    cancelAnimationFrame(frameId);
    const destination = geometry(stage.clientWidth, stage.clientHeight, level, records);
    if (!positions || !animate || reducedMotion.matches) { paint(destination); return; }
    const start = performance.now();
    const from = positions;
    const tick = (now) => {
      const progress = Math.max(0, Math.min(1, (now - start) / DURATION));
      paint(layoutTween(from, destination, 1 - (1 - progress) ** 3));
      if (progress < 1) frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
  }

  function sync() {
    el.dataset.level = String(level);
    controls.set(level);
    for (const element of bundles) element.setAttribute('aria-hidden', String(level > 0));
    for (const element of sideCards) element.setAttribute('aria-hidden', String(level === 0));
    for (const element of notes) element.setAttribute('aria-hidden', String(level < 2));
  }

  function setLevel(value) {
    const next = Math.max(0, Math.min(STEPS.length - 1, Number(value)));
    if (next === level) return;
    level = next;
    sync();
    draw(true);
  }

  stage.addEventListener('wheel', (event) => {
    if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    event.preventDefault();
    const now = performance.now();
    if (now < wheelAfter) return;
    wheelAfter = now + DURATION;
    setLevel(level - Math.sign(event.deltaY));
  }, { passive: false });
  stage.addEventListener('keydown', (event) => {
    const keys = { ArrowUp: level + 1, ArrowDown: level - 1, '+': level + 1, '−': level - 1, '-': level - 1, Home: 0, End: STEPS.length - 1 };
    if (!Object.hasOwn(keys, event.key)) return;
    event.preventDefault();
    setLevel(keys[event.key]);
  });
  sync();
  const resize = new ResizeObserver(() => draw());
  resize.observe(stage);
  return { el, focus() { stage.focus({ preventScroll: true }); }, destroy() { resize.disconnect(); cancelAnimationFrame(frameId); } };
}
