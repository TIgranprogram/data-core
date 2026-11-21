const AREA_LAYOUT = {
  quality: [0, 0], paper: [1, 0], system: [4, 0],
  sale: [0, 1], prod: [1, 1], make: [2, 1], after: [3, 1], money: [4, 1],
  supply: [1, 2], stock: [2, 2],
};
const AREA_ICONS = {
  quality: 'ok', paper: 'dicts', system: 'admin', sale: 'partners', prod: 'catalog',
  make: 'ops', after: 'moves', money: 'money', supply: 'requests', stock: 'stock',
};
const AREA_ROUTES = [
  ['salesorders', 'products'], ['products', 'work'], ['work', 'shiporder'],
  ['staff', 'payroll', 'under'], ['offers', 'fill'], ['design', 'products'],
  ['requests', 'stock'], ['stock', 'work'],
];
const EDGE_RANK = { data: 0, process: 1, structure: 2, navigation: 3 };

const areaId = (band) => 'area:' + band;
const midpoint = (box) => box.y + box.h / 2;
const limit = (value, min, max) => max < min ? (min + max) / 2 : Math.max(min, Math.min(max, value));

function orderPeers(a, b) {
  return Number(a.edge.planned) - Number(b.edge.planned) || EDGE_RANK[a.edge.kind] - EDGE_RANK[b.edge.kind];
}

export function atlasHierarchy(model) {
  const areas = model.groups.map((group) => ({
    id: areaId(group.id), band: group.id, title: group.name || group.title, description: group.hint,
    icon: AREA_ICONS[group.id], kind: 'area',
  }));
  const nodes = new Map([...areas, ...model.nodes].map((node) => [node.id, node]));
  const sections = model.nodes.filter((node) => node.kind === 'section').sort((a, b) => a.order - b.order);
  const sectionsByBand = new Map(areas.map((area) => [area.band, sections.filter((node) => node.band === area.band)]));
  const children = new Map(sections.map((node) => [node.id, []]));
  for (const node of model.nodes) if (node.kind !== 'section') children.get(node.section)?.push(node);
  const edges = model.edges.filter(({ from, to }) => nodes.has(from) && nodes.has(to));
  const baseEdges = new Map(edges.filter((edge) => edge.source === 'LINKS').map((edge) => [edge.from + '>' + edge.to, edge]));
  function chain(nodeId) {
    const node = nodes.get(nodeId);
    if (!node) return [];
    const area = areaId(node.band);
    if (node.kind === 'area') return [area];
    if (node.kind === 'section') return [area, node.id];
    return [area, node.section, node.id];
  }
  return { areas, nodes, edges, baseEdges, sectionsByBand, children, chain };
}

function makeCard(node, box, note, role = '') {
  return { node, box, note, role };
}

function areaOverview(data, view) {
  const { w, h } = view;
  const max = Math.min(1560, w - 48);
  const gap = limit(max * 0.058, 25, 116);
  const cardWidth = (max - 4 * gap) / 5;
  const cardHeight = 102;
  const left = (w - max) / 2;
  const rowGap = Math.min(204, (h - cardHeight - 60) / 2);
  const cards = new Map();
  for (const area of data.areas) {
    const [col, row] = AREA_LAYOUT[area.band] || [0, 0];
    const box = { x: left + col * (cardWidth + gap), y: (h - cardHeight) / 2 + (row - 1) * rowGap, w: cardWidth, h: cardHeight };
    cards.set(area.id, makeCard(area, box, ''));
  }
  const wires = AREA_ROUTES.flatMap(([from, to, route]) => {
    const edge = data.baseEdges.get(from + '>' + to);
    const a = data.nodes.get(from), b = data.nodes.get(to);
    if (!edge || !a || !b) return [];
    return [{ key: edge.id, from: areaId(a.band), to: areaId(b.band), kind: edge.kind, route, edge,
      fromPort: route === 'under' ? 22 : 0, toPort: from === 'stock' ? -12 : 0 }];
  });
  return { cards, wires };
}

function areaDetail(data, hub, origin, view) {
  const sections = data.sectionsByBand.get(hub.band) || [];
  const cardHeight = 64;
  const gap = 12;
  const length = sections.length * (cardHeight + gap) - gap;
  const laneWidth = limit(view.w * 0.34, 180, 316);
  const hubWidth = Math.min(origin.w, view.w * 0.28);
  const distance = limit(view.w * 0.13, 66, 190);
  const center = limit(midpoint(origin), view.y + 32 + length / 2, view.y + view.h - 32 - length / 2);
  const towardRight = origin.x + hubWidth / 2 < view.x + view.w / 2;
  const leftPad = towardRight ? 26 : 64 + laneWidth + distance;
  const rightPad = towardRight ? 64 + laneWidth + distance : 26;
  const x = limit(origin.x, view.x + leftPad, view.x + view.w - hubWidth - rightPad);
  const box = { x, y: center - origin.h / 2, w: hubWidth, h: origin.h };
  const slotX = towardRight ? x + hubWidth + distance : x - distance - laneWidth;
  const cards = new Map([[hub.id, makeCard(hub, box, '', 'anchor')]]);
  const inward = towardRight ? 'outgoing' : 'incoming';
  const ids = new Set(sections.map(({ id }) => id));
  const business = data.edges.filter((edge) =>
    !edge.planned && (edge.kind === 'data' || edge.kind === 'process') && ids.has(edge.from) && ids.has(edge.to) && edge.from !== edge.to);
  const seen = new Set();
  const transmissions = business.filter((edge) => {
    const key = edge.from + '>' + edge.to;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
  for (const [index, node] of sections.entries()) {
    const slot = { x: slotX, y: center - length / 2 + index * (cardHeight + gap), w: laneWidth, h: cardHeight };
    const label = transmissions.find((edge) => edge.to === node.id && edge.label);
    const source = label && data.nodes.get(label.from);
    const note = source ? source.title + ' → ' + label.label : '';
    cards.set(node.id, makeCard(node, slot, note, 'member'));
  }
  return { cards, wires: [
    ...sections.map((node, index) => ({
      key: hub.id + '>' + node.id, from: hub.id, to: node.id, kind: 'containment', direction: inward,
      route: 'fan', fromPort: port(index, sections.length, box.h),
    })),
    ...transmissions.map((edge, index) => ({
      key: edge.id, from: edge.from, to: edge.to, kind: edge.kind, edge, route: towardRight ? 'outer-right' : 'outer-left',
      lane: index, direction: 'outgoing',
    })),
  ] };
}

function roleOf(edge, hub) { return edge.to === hub.id ? 'incoming' : 'outgoing'; }

function peersOf(data, hub) {
  const groups = new Map();
  const incident = data.edges.filter((edge) => (edge.from === hub.id || edge.to === hub.id) && edge.from !== edge.to);
  const business = incident.filter((edge) => edge.kind !== 'structure');
  for (const { actual, role, edge } of business.map((edge) => ({
    actual: data.nodes.get(edge.to === hub.id ? edge.from : edge.to), role: roleOf(edge, hub), edge,
  })).sort(orderPeers)) {
    if (hub.kind === 'section' && edge.kind === 'navigation' && actual.section === hub.id) continue;
    const node = hub.kind === 'section' && actual.section !== hub.id ? data.nodes.get(actual.section) || actual : actual;
    const key = role + ':' + node.id;
    const entry = groups.get(key);
    if (entry) {
      if (edge.label && !entry.labels.includes(edge.label)) entry.labels.push(edge.label);
    } else groups.set(key, { node, role, edge, labels: edge.label ? [edge.label] : [] });
  }
  return [...groups.values()];
}

function port(i, n, height) {
  return (i - (n - 1) / 2) * Math.min(15, (height - 24) / Math.max(1, n - 1));
}

function nodeDetail(data, hub, origin, view) {
  const peers = peersOf(data, hub);
  const children = data.children.get(hub.id) || [];
  const from = peers.filter((item) => item.role === 'incoming');
  const to = peers.filter((item) => item.role === 'outgoing');
  const laneW = limit(view.w * 0.25, 150, 306);
  const hubW = limit(origin.w, 146, Math.min(268, view.w * 0.25));
  const gap = limit(view.w * 0.077, 55, 172);
  const h = 94;
  const largest = Math.max(from.length, to.length);
  const radius = Math.max(60, (largest - 1) / 2 * (largest > 5 ? 84 : 102) + 64);
  const y = limit(midpoint(origin), view.y + radius, view.y + view.h - radius);
  const x = limit(origin.x + (origin.w - hubW) / 2, view.x + (from.length ? laneW + gap + 22 : 22),
    view.x + view.w - hubW - (to.length ? laneW + gap + 22 : 22));
  const box = { x, y: y - h / 2, w: hubW, h };
  const parent = data.nodes.get(hub.kind === 'section' ? areaId(hub.band) : hub.section);
  const anchor = makeCard(hub, box, parent?.title, 'anchor');
  anchor.relationTitle = hub.kind === 'section' ? '' : hub.description;
  const cards = new Map([[hub.id, anchor]]);
  const wires = [];
  const used = new Set([hub.id]);
  for (const [lane, side] of [[from, -1], [to, 1]]) {
    // На длинной стороне ближайшие к центру карточки оставляют самый ранний ввод и вывод видимыми.
    const order = [...lane].sort((a, b) => orderPeers(a, b));
    const offsets = order.map((_, i) => order.length % 2
      ? Math.ceil(i / 2) * (i % 2 ? -1 : 1)
      : (Math.floor(i / 2) + 0.5) * (i % 2 ? 1 : -1));
    const pitch = order.length > 5 ? 84 : 102;
    const height = order.length > 5 ? 72 : 84;
    for (const [i, peer] of order.entries()) {
      const offset = offsets[i];
      const slot = { x: side < 0 ? x - gap - laneW : x + hubW + gap, y: y + offset * pitch - height / 2, w: laneW, h: height };
      const key = used.has(peer.node.id) ? peer.role + ':' + peer.node.id : peer.node.id;
      used.add(peer.node.id);
      const card = makeCard(peer.node, slot, peer.labels[0] || '', peer.role);
      card.relationTitle = peer.labels.join(' · ');
      cards.set(key, card);
      const relativePort = port(offset + (order.length - 1) / 2, order.length, h);
      wires.push({ key: peer.edge.id, from: side < 0 ? key : hub.id, to: side < 0 ? hub.id : key,
        direction: peer.role, kind: peer.edge.planned ? 'planned' : peer.edge.kind, edge: peer.edge,
        fromPort: side > 0 ? relativePort : 0, toPort: side < 0 ? relativePort : 0 });
    }
  }
  if (children.length) {
    // Вся ветка внутри ширины узла. Входы и выходы проходят по обе стороны без наложения на карточки состава.
    const inset = 32;
    const cardW = hubW - inset - 6;
    const fromPort = 10 - hubW / 2;
    const childY = box.y + box.h + 28;
    const membership = new Map(data.edges.filter((edge) => edge.from === hub.id && edge.kind === 'structure')
      .map((edge) => [edge.to, edge]));
    let last;
    children.forEach((node, i) => {
      const key = cards.has(node.id) ? 'child:' + node.id : node.id;
      cards.set(key, makeCard(node, {
        x: x + inset, y: childY + i * 65, w: cardW, h: 53,
      }, '', 'child'));
      const edge = membership.get(node.id);
      wires.push({ key: edge?.id || hub.id + '>' + key, from: hub.id, to: key, kind: 'containment', route: 'branch', edge, fromPort });
      last = key;
    });
    wires.unshift({ key: hub.id + ':stem', from: hub.id, to: last, kind: 'containment', route: 'trunk', fromPort });
  }
  return { cards, wires };
}

export function atlasScene(data, nodeId, origin, view) {
  if (!nodeId) return areaOverview(data, view);
  const node = data.nodes.get(nodeId);
  const defaultBox = { x: view.x + view.w / 2 - 102, y: view.y + view.h / 2 - 45, w: 204, h: 90 };
  if (node.kind === 'area') return areaDetail(data, node, origin || defaultBox, view);
  return nodeDetail(data, node, origin || defaultBox, view);
}
