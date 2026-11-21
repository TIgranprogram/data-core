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

function areaWires(data) {
  return AREA_ROUTES.flatMap(([from, to, route]) => {
    const edge = data.baseEdges.get(from + '>' + to);
    const a = data.nodes.get(from), b = data.nodes.get(to);
    if (!edge || !a || !b) return [];
    return [{ key: edge.id, from: areaId(a.band), to: areaId(b.band), kind: edge.kind, route, edge,
      fromPort: route === 'under' ? 22 : 0, toPort: from === 'stock' ? -12 : 0 }];
  });
}

function areaOverview(data, view) {
  const { w, h } = view;
  const width = Math.min(1680, w - 48);
  const gap = limit(width * 0.051, 25, 112);
  const cardWidth = (width - 4 * gap) / 5;
  const cardHeight = 110;
  const left = (w - width) / 2;
  const rowGap = Math.min(204, (h - cardHeight - 60) / 2);
  const cards = new Map();
  for (const area of data.areas) {
    const [col, row] = AREA_LAYOUT[area.band] || [0, 0];
    const box = { x: left + col * (cardWidth + gap), y: (h - cardHeight) / 2 + (row - 1) * rowGap, w: cardWidth, h: cardHeight };
    cards.set(area.id, { ...makeCard(area, box, ''), relationTitle: area.description });
  }
  return { cards, wires: areaWires(data) };
}

function contextCard(node, box, role) {
  return { ...makeCard(node, box, '', role), context: true };
}

function peerWire(peer, peerKey, targetKey, context = false) {
  const incoming = peer.role === 'incoming';
  return { key: peer.edge.id, from: incoming ? peerKey : targetKey, to: incoming ? targetKey : peerKey,
    direction: peer.role, kind: peer.edge.planned ? 'planned' : peer.edge.kind, edge: peer.edge, context };
}

function areaContext(data, area, view) {
  const available = areaWires(data);
  const connections = new Map();
  const peers = new Map();
  for (const [role, from, to] of [['incoming', 'to', 'from'], ['outgoing', 'from', 'to']]) {
    const ranks = new Map([[area, 0]]);
    const queue = [area];
    for (const current of queue) {
      for (const edge of available) {
        if (edge[from] !== current) continue;
        connections.set(edge.key, { ...edge, role });
        const target = edge[to];
        if (ranks.has(target)) continue;
        ranks.set(target, ranks.get(current) + 1);
        queue.push(target);
      }
    }
    for (const [id, rank] of ranks) {
      if (!rank || peers.has(id)) continue;
      const node = data.nodes.get(id);
      const row = node.band === 'money' ? 2 : AREA_LAYOUT[node.band][1];
      peers.set(id, { node, rank, role, row });
    }
  }
  const rows = [...peers.values()].map((peer) => peer.row).concat(1);
  const min = Math.min(...rows);
  const max = Math.max(...rows);
  const pitch = view.w < 1100 ? 104 : 82;
  const height = view.w < 1100 ? 84 : 68;
  return { area, peers, connections, min, height, pitch, offset: (1 - min) * pitch, span: (max - min) * pitch + height };
}

function mountAreaContext(data, context, view, frame, top, scopeKey, cards, wires) {
  const visible = new Map([[context.area, scopeKey]]);
  for (const side of ['incoming', 'outgoing']) {
    const lane = [...context.peers.values()].filter((peer) => peer.role === side);
    if (!lane.length) continue;
    const rankCount = Math.max(...lane.map((peer) => peer.rank));
    const outer = side === 'incoming' ? frame.x - view.x : view.x + view.w - frame.x - frame.w;
    const compact = view.w < 1100;
    const stride = Math.max(compact ? 158 : 126, (outer - 26) / rankCount);
    const width = Math.min(290, stride - (compact ? 16 : Math.max(25, stride * 0.22)));
    for (const peer of lane) {
      const separation = (stride - width) * (compact ? 0.5 : 0.77) + (peer.rank - 1) * stride;
      const x = side === 'incoming' ? frame.x - separation - width : frame.x + frame.w + separation;
      const key = cards.has(peer.node.id) ? 'context:' + side + ':' + peer.node.id : peer.node.id;
      const box = { x, y: top + (peer.row - context.min) * context.pitch, w: width, h: context.height };
      const card = contextCard(peer.node, box, side);
      if (peer.node.band === 'money') {
        const route = [...context.connections.values()].find(({ edge }) => edge.from === 'staff' && edge.to === 'payroll');
        if (route) {
          const source = data.nodes.get(route.edge.from).title;
          const recipient = data.nodes.get(route.edge.to).title;
          card.note = 'Ставки для оплаты труда';
          card.relationTitle = source + ' → ' + recipient + ' · ' + route.edge.label;
        }
      }
      cards.set(key, card);
      visible.set(peer.node.id, key);
    }
  }
  for (const { from, to, edge, role } of context.connections.values()) {
    const frameEnd = from === context.area ? 'from' : to === context.area ? 'to' : undefined;
    // У раскрытой области сохраняем точное присоединение к разделу, если он уже виден в рамке.
    const scopeEndpoint = frameEnd && cards.has(edge[frameEnd]) ? edge[frameEnd] : scopeKey;
    wires.push({ key: edge.id + ':area', from: frameEnd === 'from' ? scopeEndpoint : visible.get(from),
      to: frameEnd === 'to' ? scopeEndpoint : visible.get(to), kind: edge.kind, edge, context: true,
      direction: role, frameEnd });
  }
}

function areaDetail(data, hub, origin, view) {
  const sections = data.sectionsByBand.get(hub.band) || [];
  const context = areaContext(data, hub.id, view);
  const pitch = 74;
  const cardHeight = 62;
  const hubWidth = limit(view.w * 0.27, 186, 328);
  const frameRight = 56;
  const h = 82;
  const length = h + 24 + Math.max(0, sections.length - 1) * pitch + cardHeight;
  const margin = Math.max(24, context.offset + 12);
  const y = limit(midpoint(origin) - length / 2, view.y + margin, Math.max(view.y + margin, view.y + view.h - length - margin));
  const x = view.x + (view.w - hubWidth - frameRight + 12) / 2;
  const box = { x, y, w: hubWidth, h };
  const cards = new Map([[hub.id, makeCard(hub, box, '', 'anchor')]]);
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
  const fromPort = 10 - hubWidth / 2;
  for (const [index, node] of sections.entries()) {
    const slot = { x: x + 30, y: y + h + 24 + index * pitch, w: hubWidth - 30, h: cardHeight };
    const label = transmissions.find((edge) => edge.to === node.id && edge.label);
    const source = label && data.nodes.get(label.from);
    const note = source ? source.title + ' → ' + label.label : '';
    cards.set(node.id, makeCard(node, slot, note, 'member'));
  }
  const wires = [
    ...sections.map(node => ({
      key: hub.id + '>' + node.id, from: hub.id, to: node.id, kind: 'containment', route: 'branch', fromPort,
    })),
    ...transmissions.map((edge, index) => ({
      key: edge.id, from: edge.from, to: edge.to, kind: edge.kind, edge, route: 'outer-right',
      lane: index, direction: 'outgoing',
    })),
  ];
  if (sections.length) {
    wires.unshift({ key: hub.id + ':stem', from: hub.id, to: sections.at(-1).id, kind: 'containment', route: 'trunk', fromPort });
  }

  const contextTop = Math.max(view.y + 24, y + (h - context.height) / 2 - context.offset);
  const frameTop = Math.min(box.y, contextTop) - 14;
  const frame = { x: box.x - 12, y: frameTop, w: box.w + 12 + frameRight, h: box.y + length + 14 - frameTop };
  mountAreaContext(data, context, view, frame, contextTop, hub.id, cards, wires);
  return { cards, wires, frame };
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
  const context = areaContext(data, areaId(hub.band), view);
  const children = data.children.get(hub.id) || [];
  const from = peers.filter((item) => item.role === 'incoming');
  const to = peers.filter((item) => item.role === 'outgoing');
  const laneW = limit(view.w * 0.22, 150, 410);
  const hubW = limit(view.w * 0.2, 186, 332);
  const gap = Math.max(48, (view.w / 2 - hubW / 2 - laneW) * 0.65);
  const h = 94;
  const largest = Math.max(from.length, to.length);
  const radius = Math.max(60, (largest - 1) / 2 * (largest > 5 ? 84 : 102) + 64);
  const topRoom = view.y + radius + context.span + 34;
  const preferredY = children.length ? midpoint(origin) : Math.min(midpoint(origin), view.y + view.h * 0.63);
  const y = limit(preferredY, topRoom, Math.max(topRoom, view.y + view.h - radius));
  const x = view.x + (view.w - hubW) / 2;
  const box = { x, y: y - h / 2, w: hubW, h };
  const anchor = makeCard(hub, box, '', 'anchor');
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
      wires.push({ ...peerWire(peer, key, hub.id), fromPort: side > 0 ? relativePort : 0, toPort: side < 0 ? relativePort : 0 });
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
  const contextTop = y - radius - context.span - 16;
  const parent = data.nodes.get(context.area);
  const parentKey = cards.has(parent.id) ? 'context:' + parent.id : parent.id;
  const parentBox = { x: box.x, y: contextTop + context.offset, w: box.w, h: context.height };
  const heading = contextCard(parent, parentBox, 'ancestor');
  if (hub.kind !== 'section') heading.note = data.nodes.get(hub.section)?.title || '';
  cards.set(parentKey, heading);
  wires.unshift({ key: parent.id + '>' + hub.id + ':context', from: parentKey, to: hub.id,
    kind: 'containment', route: 'scope-membership', context: true });
  const frameBottom = Math.max(y + radius, ...[...cards.values()]
    .filter(card => card.role === 'child').map(card => card.box.y + card.box.h + 14));
  const frame = { x: box.x - 15, y: contextTop - 12, w: box.w + 30, h: frameBottom - contextTop + 12 };
  mountAreaContext(data, context, view, frame, contextTop, parentKey, cards, wires);
  return { cards, wires, frame };
}

export function atlasScene(data, nodeId, origin, view) {
  if (!nodeId) return areaOverview(data, view);
  const node = data.nodes.get(nodeId);
  const defaultBox = { x: view.x + view.w / 2 - 102, y: view.y + view.h / 2 - 45, w: 204, h: 90 };
  if (node.kind === 'area') return areaDetail(data, node, origin || defaultBox, view);
  return nodeDetail(data, node, origin || defaultBox, view);
}
