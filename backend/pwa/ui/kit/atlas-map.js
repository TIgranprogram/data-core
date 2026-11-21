// «Карта сайта»: общий маршрут и связи выбранного узла на одном полотне.
import { h, fill } from '../../core/dom.js';
export { atlasFocus } from '../atlas-map/focus.js';
import { icon } from '../icons.js';
import { button, guide, iconButton, link } from './index.js';
import { atlasInspector, isDirect, LAYERS } from '../atlas-map/inspector.js';
import { HEIGHT, MIN_WIDTH, TERRITORIES, applyCamera, bindPan, bindViewportKeys, bindWheel,
  drawTerritories, geometry, keepInView, pathFor, spanBoxes, svg } from '../atlas-map/layout.js';
import { semanticScene } from '../atlas-map/semantic.js';

const OVERVIEW = new Set([
  'salesorders:design', 'design:products', 'products:work', 'requests:stock', 'stock:work', 'work:shiporder',
]);
const LEVELS = ['Общая карта', 'Связи узла', 'Подписи связей'];
let nextId = 0;

export function atlasMap({ model, trace, onOpen, onSelect }) {
  const id = 'am-' + ++nextId;
  const nodes = new Map(model.nodes.map((node) => [node.id, node]));
  const sections = model.nodes.filter((node) => node.kind === 'section').sort((a, b) => a.order - b.order);
  const groups = new Map(model.groups.map((group) => [group.id, group]));
  const kinds = Object.keys(LAYERS);
  const enabled = new Set(kinds);
  const edges = model.edges.filter((edge) => nodes.has(edge.from) && nodes.has(edge.to));
  const stations = new Map();
  const traces = new Map();
  let planOn = true;
  let selected = null;
  let hover = null;
  let detailTarget = null;
  let focusedEdge = null;
  let local = null;
  let beforeInspect = null;
  let overviewCamera = null;
  let width = MIN_WIDTH;
  let camera = { x: 0, y: 0 };
  let bounds = { left: 0, right: width, top: 0, bottom: HEIGHT };
  let layout = geometry(width, sections);
  let layerEdges = edges;
  let business = edges;

  const el = h('section', { class: 'atlas-map', 'aria-label': 'Интерактивная карта сайта' });
  const viewport = h('div', {
    class: 'am-viewport', tabindex: '0', role: 'region', 'aria-label': 'Полотно карты', 'aria-describedby': id + '-help',
  });
  const plate = h('div', { class: 'am-plate' });
  const defs = svg('defs');
  const territories = svg('g', { class: 'am-territory-shapes' });
  const rails = svg('g', { class: 'am-overview-rails' });
  const lines = svg('g', { class: 'am-overview-lines' });
  const wires = svg('g', { class: 'am-local-wires' });
  const drawing = svg('svg', { class: 'am-drawing', 'aria-hidden': 'true' }, defs, territories, rails, lines, wires);
  const headings = h('div', { class: 'am-area-labels' });
  const stationLayer = h('div', { class: 'am-stations' });
  const detailLayer = h('div', { class: 'am-details-layer' });
  const levelStatus = h('span', { class: 'am-level', role: 'status' });
  const layerStatus = h('span', { class: 'am-layer-status' });
  const minus = button({ label: '−', cls: 'am-zoom-step', title: 'Свернуть подробности', onClick: () => changeDetail(-1) });
  const plus = button({ label: '+', cls: 'am-zoom-step', title: 'Раскрыть подробности', onClick: () => changeDetail(1) });
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
    scene.control(nodeId)?.focus({ preventScroll: true });
  }, onInspect: inspect });

  for (const kind of [...kinds, 'planned']) {
    for (const direction of ['overview', 'incoming', 'outgoing']) {
      defs.append(svg('marker', {
        id: marker(direction, kind), class: 'am-arrow', 'data-layer': kind, 'data-direction': direction,
        markerWidth: 9, markerHeight: 9, refX: 8, refY: 4, viewBox: '0 0 8 8', markerUnits: 'userSpaceOnUse', orient: 'auto',
      }, svg('path', { d: 'M0 1 L8 4 L0 7 Z' })));
    }
  }

  const filters = h('details', { class: 'am-layer-menu' },
    h('summary', null, icon('settings'), 'Слои карты', layerStatus),
    h('div', { class: 'am-layer-options' }, kinds.map((kind) => guide.toggle({
      label: layerKey(kind, LAYERS[kind]), checked: true,
      onChange: (checked) => {
        if (checked) enabled.add(kind);
        else enabled.delete(kind);
        applyLayers();
      },
    })), guide.toggle({
      label: layerKey('planned', 'В планах'), checked: true,
      onChange: (checked) => { planOn = checked; applyLayers(); },
    })));
  plate.append(drawing, headings, stationLayer, detailLayer);
  viewport.append(plate);
  el.append(h('div', { class: 'am-toolbar' }, filters,
    h('div', { class: 'am-zoom', role: 'group', 'aria-label': 'Детализация карты' }, levelStatus, minus, plus, reset)),
  viewport,
  h('div', { class: 'am-caption' },
    h('div', { class: 'am-legend', 'aria-label': 'Обозначения' }, kinds.map((kind) => layerKey(kind, LAYERS[kind])), layerKey('planned', 'В планах'),
      h('span', { class: 'am-direction-hint' }, layerKey('incoming', 'Входящие'), layerKey('outgoing', 'Исходящие'))),
    h('span', { id: id + '-help', class: 'am-help' }, 'Колесо над карточкой раскрывает связи · перетащите карту, чтобы сдвинуть её')),
  selection, inspector.el);

  for (const node of sections) {
    const control = stationButton(node);
    stations.set(node.id, control);
    stationLayer.append(control);
  }
  const scene = semanticScene({
    stations, nodes, stationLayer, legendLayer: detailLayer, wires, makeStation: stationButton, marker,
    makeGroup: () => button({
      label: stationContent('Состав и шаги'), cls: 'am-substation am-group-card', title: 'Показать связи состава в списке',
      onClick: () => { inspector.openStructure(); drawInspector(); },
    }),
    onBounds: (next) => { bounds = next; updateCamera(); },
  });

  function marker(direction, kind) { return id + '-' + direction + '-' + kind; }
  function layerKey(kind, label) {
    return h('span', { class: 'am-layer-label', 'data-layer': kind }, h('span', { class: 'am-key' }), label);
  }
  function sectionOf(nodeId) { return nodes.get(nodeId)?.section || nodeId; }
  function visible(nodeId) { return planOn || !nodes.get(nodeId)?.planned; }
  function stationContent(title) {
    return h('span', { class: 'am-station-content' }, h('strong', null, title), h('span', { class: 'am-station-note', hidden: true }));
  }

  function stationButton(node, duplicate = false) {
    const control = button({
      label: stationContent(node.title),
      title: [node.title, node.description, node.planned ? 'В планах' : null].filter(Boolean).join(' · '),
      cls: duplicate ? 'am-peer' : node.kind === 'section' ? 'am-station' : 'am-substation',
      onClick: () => selectNode(node.id),
    });
    Object.assign(control.dataset, { node: node.id, atlasNode: node.id, band: node.band, kind: node.kind,
      main: String(TERRITORIES.find((area) => area.id === node.band)?.main === node.id), planned: String(Boolean(node.planned)) });
    control.setAttribute('aria-pressed', 'false');
    control.addEventListener('pointerenter', (event) => {
      if (event.pointerType === 'mouse' && !isDragging()) setHover(node.id);
    });
    control.addEventListener('pointerleave', () => { if (hover === node.id) setHover(null); });
    return control;
  }

  function drawOverview(active) {
    const flow = active && (traces.get(active) || trace(business, active, 'both'));
    if (flow) traces.set(active, flow);
    const chosen = new Map();
    const add = (edge, priority) => {
      const from = sectionOf(edge.from);
      const to = sectionOf(edge.to);
      const key = from + ':' + to;
      if (from === to || !layout.boxes.has(from) || !layout.boxes.has(to) || chosen.get(key)?.priority >= priority) return;
      chosen.set(key, { edge, from, to, priority });
    };
    if (active) {
      for (const edge of layerEdges) {
        if (chosen.size >= 12) break;
        if (isDirect(edge, active, nodes, sectionOf)) add(edge, 3);
      }
      for (const edge of business) {
        if (chosen.size >= 16) break;
        if (flow.edgeIds.has(edge.id) && edge.from === sectionOf(edge.from) && edge.to === sectionOf(edge.to)) add(edge, 2);
      }
    } else {
      for (const edge of layerEdges) if (OVERVIEW.has(edge.from + ':' + edge.to)) add(edge, 1);
      if (!chosen.size && enabled.size < kinds.length) {
        for (const edge of layerEdges) { if (chosen.size >= 6) break; add(edge, 1); }
      }
    }
    fill(lines, [...chosen.values()].sort((a, b) => a.priority - b.priority).map(({ edge, from, to, priority }, lane) => {
      const kind = edge.planned ? 'planned' : edge.kind;
      return svg('path', {
        d: pathFor(layout.boxes.get(from), layout.boxes.get(to), lane), class: 'am-connection',
        'data-layer': kind, 'data-weight': priority, 'marker-end': 'url(#' + marker('overview', kind) + ')',
      });
    }));
    return flow;
  }

  function highlight() {
    const active = hover || selected;
    const flow = !local && drawOverview(active);
    const lit = new Set(active ? [active, sectionOf(active)] : []);
    if (!local && active) {
      for (const edge of layerEdges) {
        if (isDirect(edge, active, nodes, sectionOf)) lit.add(sectionOf(edge.from)).add(sectionOf(edge.to));
      }
      for (const nodeId of flow.nodeIds) lit.add(sectionOf(nodeId));
    }
    for (const control of scene.controls()) {
      const nodeId = control.dataset.node;
      if (nodeId) control.hidden = !visible(nodeId);
      control.classList.toggle('is-related', Boolean(local ? control.dataset.mapRole !== 'context' : lit.has(nodeId)));
      control.classList.toggle('is-muted', Boolean(local ? control.dataset.mapRole === 'context' : active && !lit.has(nodeId)));
      control.classList.toggle('is-pinned', Boolean(selected && nodeId === selected));
      if (nodeId) control.setAttribute('aria-pressed', String(selected === nodeId));
    }
  }

  function setHover(nodeId) {
    if (nodeId === hover) return;
    hover = nodeId;
    highlight();
    syncControls();
  }

  function updateCamera() { applyCamera(plate, viewport, camera, bounds); }
  function panBy(x, y) { camera.x += x; camera.y += y; updateCamera(); }

  function paint(animate = false) {
    el.dataset.level = String(local?.step || 0);
    if (local) el.dataset.anchor = local.anchor;
    else delete el.dataset.anchor;
    const inspectEdge = layerEdges.find((edge) => edge.id === focusedEdge);
    scene.render({ step: local?.step, anchor: local?.anchor, origin: local?.origin, view: local?.view,
      layout, sections: sections.filter((node) => visible(node.id)), edges: inspectEdge ? [inspectEdge] : layerEdges,
      width, inspected: focusedEdge }, animate);
    highlight();
    syncControls();
  }

  function chooseTarget(control) {
    return control?.dataset?.node || hover || (visible(detailTarget) && detailTarget) || local?.anchor || selected || sections.find((node) => visible(node.id))?.id;
  }

  function syncControls() {
    const description = LEVELS[local?.step || 0];
    levelStatus.textContent = local ? description + ' · ' + nodes.get(local.anchor).title : description;
    minus.disabled = !local;
    plus.disabled = Boolean(local?.step === 2 && chooseTarget(document.activeElement?.closest('.am-stations button')) === local.anchor);
  }

  function setLocal(nodeId, step, control) {
    detailTarget = nodeId;
    if (!local) overviewCamera = { ...camera };
    if (local?.anchor === nodeId) { local.step = step; return; }
    const origin = scene.box(nodeId, control) || layout.boxes.get(sectionOf(nodeId));
    if (!origin) return;
    local = {
      anchor: nodeId, step, origin,
      view: { x: -camera.x, y: -camera.y, w: viewport.clientWidth || width, h: viewport.clientHeight || HEIGHT },
    };
  }

  function changeDetail(direction, control) {
    const nodeId = direction < 0 && !control ? local?.anchor : chooseTarget(control);
    if (!nodeId || !visible(nodeId)) return false;
    const step = local?.anchor === nodeId ? local.step : 0;
    const next = step + direction;
    if (next < 0 || next >= LEVELS.length) return false;
    if (next === 0) { resetView(); return true; }
    focusedEdge = null;
    beforeInspect = null;
    setLocal(nodeId, next, control);
    paint(true);
    drawInspector();
    return true;
  }

  function resetView() {
    const oldAnchor = local?.anchor;
    local = beforeInspect = focusedEdge = null;
    camera = overviewCamera || { x: 0, y: 0 };
    overviewCamera = null;
    paint(true);
    drawInspector();
    if (oldAnchor && viewport.contains(document.activeElement)) {
      stations.get(sectionOf(oldAnchor))?.focus({ preventScroll: true });
    }
  }

  function scrollToNode(nodeId, control) {
    const box = scene.box(nodeId, control) || layout.boxes.get(sectionOf(nodeId));
    if (!box) return;
    keepInView(camera, box, viewport);
    updateCamera();
  }

  function selectNode(nodeId, notify = true) {
    const node = nodes.get(nodeId);
    if (!node || (selected === nodeId && !notify)) return;
    detailTarget = selected = nodeId;
    hover = focusedEdge = beforeInspect = null;
    inspector.resetScope();
    if (node.kind !== 'section' && local?.anchor !== nodeId) setLocal(nodeId, node.kind === 'part' ? 1 : 2);
    paint(false);
    scrollToNode(nodeId);
    drawSelection();
    drawInspector();
    if (notify) onSelect?.(nodeId);
  }

  function clearSelection(notify = true) {
    if (!selected && !focusedEdge) return;
    selected = focusedEdge = hover = null;
    if (beforeInspect) { local = beforeInspect; beforeInspect = null; paint(false); }
    highlight();
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
    selectionTitle.textContent = [current.id === parent.id ? current.title : parent.title + ' · ' + current.title,
      current.planned ? 'В планах' : null].filter(Boolean).join(' · ');
    selectionDescription.textContent = current.description || '';
    selectionDescription.hidden = !current.description;
    const href = current.planned ? null : current.href;
    destination.hidden = !href;
    fill(destination, href ? link({ href, label: 'Перейти в раздел' }) : null);
  }

  function drawInspector() {
    const subject = focusedEdge ? beforeInspect?.anchor : local?.anchor;
    inspector.render({ selected: subject || selected, exact: Boolean(subject), focusedEdge, layerEdges });
  }

  function inspect(edge) {
    hover = null;
    if (focusedEdge === edge.id) {
      focusedEdge = null;
      local = beforeInspect;
      beforeInspect = null;
    } else {
      if (!focusedEdge) beforeInspect = local && { ...local };
      focusedEdge = edge.id;
      const priorAnchor = local?.anchor;
      const anchor = priorAnchor === edge.to ? edge.to : edge.from;
      setLocal(anchor, 2);
    }
    paint(false);
    drawInspector();
    inspector.focusRelation(edge.id);
    if (focusedEdge) {
      const from = scene.box(edge.from), to = scene.box(edge.to);
      if (from && to) { keepInView(camera, spanBoxes(from, to), viewport); updateCamera(); }
      viewport.scrollIntoView({ block: 'nearest' });
    }
  }

  function applyLayers() {
    layerEdges = edges.filter((edge) => enabled.has(edge.kind) && (planOn || !edge.planned) && visible(edge.from) && visible(edge.to));
    business = layerEdges.filter(({ kind }) => kind === 'data' || kind === 'process');
    traces.clear();
    if (selected && !visible(selected)) clearSelection();
    if (local && !visible(local.anchor)) resetView();
    if (focusedEdge && !layerEdges.some((edge) => edge.id === focusedEdge)) {
      focusedEdge = null; local = beforeInspect; beforeInspect = null;
    }
    layerStatus.textContent = enabled.size + '/' + kinds.length;
    paint(false);
    drawInspector();
  }

  const actualCard = (target) => target?.closest('.am-stations [data-node]');
  bindWheel(viewport, { targetOf: actualCard, change: changeDetail,
    holdsTarget: (control) => local?.anchor === control.dataset.node });
  const isDragging = bindPan(viewport, {
    canStart: (event) => !event.target.closest('button, a'), read: () => camera,
    update: (x, y) => { camera = { x, y }; updateCamera(); }, onStart: () => setHover(null),
  });
  viewport.addEventListener('focusin', (event) => {
    const target = event.target.dataset.node;
    if (target && !isDragging()) { detailTarget = target; scrollToNode(target, event.target); syncControls(); }
  });
  bindViewportKeys(viewport, {
    escape: () => { if (local) resetView(); else if (selected) clearSelection(); else return false; return true; },
    panBy, change: (direction, target) => changeDetail(direction, actualCard(target)), reset: resetView,
  });

  function paintTerritories() {
    drawTerritories({ drawing, width, plate, layout, territories, rails, headings, stations, groups });
  }
  paintTerritories();
  drawSelection();
  applyLayers();
  const resize = new ResizeObserver(() => {
    const nextWidth = Math.max(MIN_WIDTH, viewport.clientWidth);
    if (nextWidth !== width) {
      width = nextWidth;
      layout = geometry(width, sections);
      paintTerritories();
    }
    if (local) local.view = { ...local.view, w: viewport.clientWidth, h: viewport.clientHeight };
    paint(false);
  });
  resize.observe(viewport);
  return { el, pin(sectionId) { if (sectionId) selectNode(sectionId, false); else clearSelection(false); },
    destroy() { resize.disconnect(); scene.destroy(); } };
}
