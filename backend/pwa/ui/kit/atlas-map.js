import { h, fill } from '../../core/dom.js';
import { icon } from '../icons.js';
import { button, guide, iconButton, link } from './index.js';
import { atlasInspector, isDirect, LAYERS } from '../atlas-map/inspector.js';
import {
  HEIGHT, MIN_WIDTH, TERRITORIES, applyCamera, bindPan, bindViewportKeys, bindWheel, buildBranch, cameraForEdge, drawTerritories,
  geometry, keepInView, nearestStation, pathFor, place, revealBranchRows, svg,
} from '../atlas-map/layout.js';

const OVERVIEW = new Set([
  'salesorders:design', 'design:products', 'products:work', 'requests:stock', 'stock:work', 'work:shiporder',
]);
const MAX_ZOOM = 3.4;
const LEVELS = ['Разделы', 'Подразделы', 'Действия'];
let nextId = 0;

export function atlasMap({ model, trace, onOpen, onSelect }) {
  const id = `am-${++nextId}`;
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const sections = model.nodes.filter((node) => node.kind === 'section').sort((a, b) => a.order - b.order);
  const parts = new Map(sections.map((node) => [node.id, []]));
  for (const node of model.nodes) if (node.kind !== 'section') parts.get(node.section)?.push(node);
  const groups = new Map(model.groups.map((group) => [group.id, group]));
  const enabled = new Set(Object.keys(LAYERS));
  const edges = model.edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
  const stations = new Map();
  let planOn = true;
  let selected = null;
  let hover = null;
  let focusedEdge = null;
  let localId = null;
  let currentLocal = '';
  let camera = { x: 0, y: 0, zoom: 1 };
  let width = MIN_WIDTH;
  let layout = geometry(width, sections);
  let branch = null;
  let branchList = null;
  let branchBox = null;
  let branchButtons = new Map();
  let layerEdges = edges;
  let business = edges;
  const traces = new Map();
  const el = h('section', { class: 'atlas-map', 'aria-label': 'Интерактивная карта сайта' });
  const viewport = h('div', {
    class: 'am-viewport', tabindex: '0', role: 'region', 'aria-label': 'Полотно карты', 'aria-describedby': `${id}-help`,
  });
  const plate = h('div', { class: 'am-plate' });
  const defs = svg('defs');
  const territories = svg('g');
  const rails = svg('g');
  const lines = svg('g');
  const drawing = svg('svg', { class: 'am-drawing', 'aria-hidden': 'true' }, defs, territories, rails, lines);
  const headings = h('div', { class: 'am-area-labels' });
  const stationLayer = h('div', { class: 'am-stations' });
  const detailLayer = h('div', { class: 'am-details-layer' });
  const levelStatus = h('span', { class: 'am-level' });
  const layerStatus = h('span', { class: 'am-layer-status' });
  const minus = button({ label: '−', cls: 'am-zoom-step', title: 'Уменьшить', onClick: () => zoomBy(1 / 1.32) });
  const plus = button({ label: '+', cls: 'am-zoom-step', title: 'Увеличить', onClick: () => zoomBy(1.32) });
  const reset = iconButton({ icon: icon('refresh'), label: 'Вернуть общий вид', onClick: resetView });
  const selectionTitle = h('h3');
  const selectionDescription = h('p');
  const destination = h('span', { class: 'am-destination' });
  const show = button({ label: 'Открыть подробности', size: 'S', kind: 'primary', onClick: (event) => onOpen?.(sectionOf(selected), event.currentTarget) });
  const clear = button({ label: 'Снять выбор', size: 'S', kind: 'ghost', onClick: () => clearSelection() });
  const selection = h('div', { class: 'am-selection' },
    h('div', { class: 'am-selection-text' }, selectionTitle, selectionDescription),
    h('div', { class: 'am-selection-actions' }, show, destination, clear));
  const inspector = atlasInspector({ nodes, sectionOf, edges, onSelect: (nodeId) => {
    selectNode(nodeId);
    stations.get(sectionOf(nodeId))?.focus({ preventScroll: true });
  }, onInspect: inspect });
  const drawInspector = () => inspector.render({ selected, focusedEdge, layerEdges });

  for (const kind of [...Object.keys(LAYERS), 'planned']) {
    defs.append(svg('marker', {
      id: `${id}-${kind}`, class: 'am-arrow', 'data-layer': kind, markerWidth: 9, markerHeight: 9, refX: 8, refY: 4,
      viewBox: '0 0 8 8', markerUnits: 'userSpaceOnUse', orient: 'auto',
    }, svg('path', { d: 'M0 1 L8 4 L0 7 Z' })));
  }

  const filters = h('details', { class: 'am-layer-menu' },
    h('summary', null, icon('settings'), 'Слои карты', layerStatus),
    h('div', { class: 'am-layer-options' }, Object.entries(LAYERS).map(([kind, title]) => guide.toggle({
      label: h('span', { class: 'am-layer-label', 'data-layer': kind }, h('span', { class: 'am-key' }), title), checked: true,
      onChange: (checked) => {
        if (checked) enabled.add(kind);
        else enabled.delete(kind);
        applyLayers();
      },
    })), guide.toggle({
      label: h('span', { class: 'am-layer-label', 'data-layer': 'planned' }, h('span', { class: 'am-key' }), 'В планах'), checked: true,
      onChange: (checked) => { planOn = checked; applyLayers(); },
    })));
  plate.append(drawing, headings, stationLayer, detailLayer);
  viewport.append(plate);
  el.append(h('div', { class: 'am-toolbar' }, filters,
    h('div', { class: 'am-zoom', role: 'group', 'aria-label': 'Масштаб карты' }, levelStatus, minus, plus, reset)),
  viewport,
  h('div', { class: 'am-caption' },
    h('div', { class: 'am-legend', 'aria-label': 'Обозначения' }, Object.entries(LAYERS).map(([kind, title]) =>
      h('span', { class: 'am-layer-label', 'data-layer': kind }, h('span', { class: 'am-key' }), title)),
    h('span', { class: 'am-layer-label', 'data-layer': 'planned' }, h('span', { class: 'am-key' }), 'В планах')),
    h('span', { id: `${id}-help`, class: 'am-help' }, 'Перетащите карту · колесо меняет масштаб')),
  selection, inspector.el);

  function sectionOf(nodeId) { return nodes.get(nodeId)?.section || nodeId; }
  function visible(nodeId) { return planOn || !nodes.get(nodeId)?.planned; }

  function stationButton(node, subordinate = false) {
    const control = button({
      label: h('span', { class: 'am-station-content' }, h('strong', null, node.title),
        subordinate ? null : h('span', { class: 'am-station-note' }, node.description || '')),
      title: [node.title, node.description, node.planned ? 'В планах' : null].filter(Boolean).join(' · '),
      cls: subordinate ? 'am-substation' : 'am-station',
      onClick: () => selectNode(node.id),
    });
    control.dataset.node = node.id;
    control.dataset.atlasNode = node.id;
    control.dataset.band = node.band;
    control.dataset.kind = node.kind;
    control.dataset.main = String(TERRITORIES.find((area) => area.id === node.band)?.main === node.id);
    control.dataset.planned = String(Boolean(node.planned));
    control.setAttribute('aria-pressed', 'false');
    control.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' && !isDragging()) setHover(node.id);
    });
    control.addEventListener('pointerleave', () => { if (hover === node.id) setHover(null); });
    return control;
  }

  for (const node of sections) {
    const control = stationButton(node);
    stations.set(node.id, control);
    stationLayer.append(control);
  }

  function paintTerritories() {
    drawTerritories({ drawing, width, plate, layout, territories, rails, headings, stations, groups });
  }

  function activeLevel() { return camera.zoom < 1.42 ? 0 : camera.zoom < 2.24 ? 1 : 2; }

  function drawBranch() {
    const level = activeLevel();
    const inspected = focusedEdge && layerEdges.find((edge) => edge.id === focusedEdge);
    const edgeCrossesSections = inspected && sectionOf(inspected.from) !== sectionOf(inspected.to);
    const children = level === 0 || edgeCrossesSections ? [] : (parts.get(localId) || []).filter((node) =>
      visible(node.id) && (level === 2 || node.kind === 'part'));
    const box = layout.boxes.get(localId);
    const branchWidth = Math.min(414, Math.max(245, viewport.clientWidth / camera.zoom - 28));
    const branchKey = children.length && box ? `${localId}/${level}/${branchWidth}/${planOn}` : '';
    if (branchKey === currentLocal) return;
    currentLocal = branchKey;
    branch = branchList = branchBox = null;
    branchButtons = new Map();
    if (!branchKey) { fill(detailLayer); return; }
    const owner = nodes.get(localId);
    const view = buildBranch({ owner, children, title: LEVELS[level], stationButton, onClose: () => {
      setZoom(1.37, { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });
      stations.get(owner.id)?.focus({ preventScroll: true });
    } });
    ({ el: branch, list: branchList, buttons: branchButtons } = view);
    // Панель локального масштаба с собственным списком не сдвигает остальные территории.
    const branchHeight = Math.min(200, 43 + Math.ceil(children.length / 2) * 35);
    const maxHeight = Math.max(128, viewport.clientHeight / camera.zoom - 38);
    const height = Math.min(branchHeight, maxHeight);
    const x = Math.max(8, Math.min(box.x, width - branchWidth - 8));
    const y = box.y + box.h + height + 12 > HEIGHT ? box.y - height - 8 : box.y + box.h + 8;
    branchBox = { x, y, w: branchWidth, h: height };
    place(branch, branchBox);
    fill(detailLayer, branch);
  }

  function edgeAllowed(edge) { return enabled.has(edge.kind) && (planOn || !edge.planned) && visible(edge.from) && visible(edge.to); }
  function flowFor(nodeId) {
    if (!traces.has(nodeId)) traces.set(nodeId, trace(business, nodeId, 'both'));
    return traces.get(nodeId);
  }

  function drawConnections() {
    const active = hover || selected;
    const focus = focusedEdge && layerEdges.find((edge) => edge.id === focusedEdge);
    const lit = new Set(active ? [active, sectionOf(active)] : []);
    const flow = active ? flowFor(active) : null;
    const chosen = new Map();
    const add = (edge, priority) => {
      const from = sectionOf(edge.from);
      const to = sectionOf(edge.to);
      const key = `${from}:${to}`;
      if (from === to || !layout.boxes.has(from) || !layout.boxes.has(to)) return;
      if ((chosen.get(key)?.priority || 0) >= priority) return;
      chosen.set(key, { edge, from, to, priority });
    };
    if (focus && !hover) {
      lit.add(focus.from).add(focus.to).add(sectionOf(focus.from)).add(sectionOf(focus.to));
      add(focus, 4);
    } else if (active) {
      const direct = layerEdges.filter((edge) => isDirect(edge, active, nodes, sectionOf));
      for (const edge of direct) {
        lit.add(edge.from).add(edge.to).add(sectionOf(edge.from)).add(sectionOf(edge.to));
        if (chosen.size < 12) add(edge, 3);
      }
      for (const nodeId of flow.nodeIds) lit.add(nodeId).add(sectionOf(nodeId));
      for (const edge of business) {
        if (chosen.size >= 16) break;
        if (flow.edgeIds.has(edge.id) && edge.from === sectionOf(edge.from) && edge.to === sectionOf(edge.to)) add(edge, 2);
      }
    } else {
      const candidates = layerEdges.filter((edge) => OVERVIEW.has(`${edge.from}:${edge.to}`));
      for (const edge of candidates) add(edge, 1);
      if (!chosen.size && enabled.size < Object.keys(LAYERS).length) {
        for (const edge of layerEdges) {
          if (chosen.size >= 6) break;
          add(edge, 1);
        }
      }
    }
    const emphasized = Boolean(active || focus);
    for (const [nodeId, control] of [...stations, ...branchButtons]) {
      control.hidden = !visible(nodeId);
      control.setAttribute('aria-pressed', String(selected === nodeId));
      control.classList.toggle('is-related', lit.has(nodeId));
      control.classList.toggle('is-muted', emphasized && !lit.has(nodeId));
      control.classList.toggle('is-pinned', Boolean(selected && (selected === nodeId || sectionOf(selected) === nodeId)));
    }
    fill(lines, [...chosen.values()].sort((a, b) => a.priority - b.priority).map(({ edge, from, to, priority }, lane) => {
      const kind = edge.planned ? 'planned' : edge.kind;
      return svg('path', {
        d: pathFor(layout.boxes.get(from), layout.boxes.get(to), lane), class: 'am-connection',
        'data-layer': kind, 'data-weight': priority, 'marker-end': `url(#${id}-${kind})`,
      });
    }));
  }

  function setHover(nodeId) {
    if (nodeId === hover) return;
    hover = nodeId;
    drawConnections();
  }

  function updateCamera() { applyCamera(plate, viewport, width, camera); }

  function drawZoom() {
    const level = activeLevel();
    el.dataset.level = level;
    levelStatus.textContent = LEVELS[level];
    minus.disabled = camera.zoom <= 1;
    plus.disabled = camera.zoom >= MAX_ZOOM;
    drawBranch();
    drawConnections();
  }

  function setZoom(next, point, pickLocal = false) {
    const zoom = Math.max(1, Math.min(MAX_ZOOM, next));
    if (zoom === camera.zoom) return;
    const world = { x: (point.x - camera.x) / camera.zoom, y: (point.y - camera.y) / camera.zoom };
    if (zoom >= 1.42 && (!localId || (activeLevel() === 0 && (pickLocal || !selected)))) {
      localId = nearestStation(world, layout.boxes, (nodeId) => visible(nodeId) && parts.get(nodeId)?.length);
    }
    camera = { x: point.x - world.x * zoom, y: point.y - world.y * zoom, zoom };
    drawZoom();
    updateCamera();
  }

  function zoomBy(multiplier, point) {
    const box = selected && layout.boxes.get(sectionOf(selected));
    const position = box && { x: (box.x + box.w / 2) * camera.zoom + camera.x, y: (box.y + box.h / 2) * camera.zoom + camera.y };
    const inside = position && position.x >= 0 && position.x <= viewport.clientWidth && position.y >= 0 && position.y <= viewport.clientHeight;
    setZoom(camera.zoom * multiplier, point || (inside ? position : { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 }), Boolean(point));
  }

  function resetView() {
    camera = { x: 0, y: 0, zoom: 1 };
    drawZoom();
    updateCamera();
  }

  function scrollToNode(nodeId) {
    const box = layout.boxes.get(sectionOf(nodeId));
    if (!box) return;
    keepInView(camera, box, viewport);
    updateCamera();
  }

  function selectNode(nodeId, notify = true) {
    const node = nodes.get(nodeId);
    if (!node || (selected === nodeId && !notify)) return;
    selected = nodeId;
    hover = null;
    focusedEdge = null;
    localId = sectionOf(nodeId);
    inspector.resetScope();
    scrollToNode(nodeId);
    if (node.kind !== 'section') revealBranch([nodeId], node.kind === 'part' ? 1.45 : 2.24);
    drawZoom();
    drawSelection();
    drawInspector();
    if (notify) onSelect?.(nodeId);
  }

  function clearSelection(notify = true) {
    if (!selected && !focusedEdge) return;
    selected = null;
    focusedEdge = null;
    hover = null;
    drawConnections();
    drawSelection();
    drawInspector();
    if (notify) onSelect?.(null);
  }

  function drawSelection() {
    const current = nodes.get(selected);
    selection.hidden = !current;
    if (!current) return;
    const parent = nodes.get(sectionOf(selected));
    show.dataset.atlasNode = parent.id;
    selectionTitle.textContent = [current.id === parent.id ? current.title : `${parent.title} · ${current.title}`, current.planned ? 'В планах' : null].filter(Boolean).join(' · ');
    selectionDescription.textContent = current.description || '';
    selectionDescription.hidden = !current.description;
    const href = current.planned ? null : current.href;
    destination.hidden = !href;
    fill(destination, href ? link({ href, label: 'Перейти в раздел' }) : null);
  }

  function inspect(edge) {
    hover = null;
    focusedEdge = focusedEdge === edge.id ? null : edge.id;
    if (focusedEdge && sectionOf(edge.from) === sectionOf(edge.to)) {
      localId = sectionOf(edge.from);
      revealBranch([edge.from, edge.to], 2.24);
    } else if (focusedEdge) {
      const from = layout.boxes.get(sectionOf(edge.from));
      const to = layout.boxes.get(sectionOf(edge.to));
      if (from && to) camera = cameraForEdge(viewport, from, to, camera.zoom);
      updateCamera();
    }
    drawZoom();
    drawInspector();
    inspector.focusRelation(edge.id);
    if (focusedEdge) viewport.scrollIntoView({ block: 'nearest' });
  }

  function revealBranch(targets, minimumZoom) {
    if (camera.zoom < minimumZoom) setZoom(minimumZoom, { x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 });
    drawBranch();
    if (!branchBox) return;
    keepInView(camera, branchBox, viewport, 8);
    updateCamera();
    revealBranchRows(branchList, targets.map((nodeId) => branchButtons.get(nodeId)).filter(Boolean), camera.zoom);
  }

  function applyLayers() {
    layerEdges = edges.filter(edgeAllowed);
    business = layerEdges.filter(({ kind }) => kind === 'data' || kind === 'process');
    traces.clear();
    if (selected && !visible(selected)) clearSelection();
    if (focusedEdge && !layerEdges.some((edge) => edge.id === focusedEdge)) focusedEdge = null;
    layerStatus.textContent = `${enabled.size}/${Object.keys(LAYERS).length}`;
    drawZoom();
    drawInspector();
  }

  bindWheel(viewport, { canZoom: (target) => !branch?.contains(target), zoomBy });
  const isDragging = bindPan(viewport, {
    canStart: (event) => !event.target.closest('button, a, .am-branch'),
    read: () => camera,
    update: (x, y) => { camera = { ...camera, x, y }; updateCamera(); },
    onStart: () => setHover(null),
  });
  viewport.addEventListener('focusin', (event) => {
    if (event.target.dataset.node && !isDragging()) scrollToNode(event.target.dataset.node);
  });
  bindViewportKeys(viewport, {
    escape: () => { if (!selected) return false; clearSelection(); return true; },
    panBy: (x, y) => { camera.x += x; camera.y += y; updateCamera(); }, zoomBy, reset: resetView,
  });

  paintTerritories();
  drawSelection();
  applyLayers();
  const resize = new ResizeObserver(() => {
    const nextWidth = Math.max(MIN_WIDTH, viewport.clientWidth);
    if (nextWidth !== width) {
      camera.x *= nextWidth / width;
      width = nextWidth;
      layout = geometry(width, sections);
      currentLocal = '';
      paintTerritories();
    }
    drawZoom();
    updateCamera();
  });
  resize.observe(viewport);
  return { el, pin(sectionId) { if (sectionId) selectNode(sectionId, false); else clearSelection(false); }, destroy() { resize.disconnect(); } };
}
