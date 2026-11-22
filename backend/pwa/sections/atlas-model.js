// Граф «Карты сайта» строится из паспорта разделов и пользовательского руководства.
import { BANDS, LINKS, NODES } from './atlas-data.js';
import { hrefOf, nameOf } from './atlas-util.js';
import { SCENARIOS, SECTIONS } from './help-guide-data.js';

const routeOf = (href) => href?.split('?')[0];
const pairOf = (from, to) => `${from}>${to}`;

// Разделы из руководства с собственными маршрутами, ещё без блока в atlas-data.
const GUIDE_ROUTES = [
  { sec: 'home', band: 'quality', href: '#home' },
  { sec: 'search', band: 'system', href: '#search' },
  { sec: 'chat', band: 'system', href: '#chat' },
  { sec: 'trash', band: 'system', href: '#trash' },
  { sec: 'history', band: 'system', href: '#history' },
  { sec: 'profile', band: 'system', href: '#home?of=profile&open=me' },
];

export function buildAtlasModel() {
  const nodes = [], edges = [];
  const byId = new Map(), byGuide = new Map(), byRoute = new Map();
  const pairLabels = new Map(), edgeOccurrences = new Map();
  const sections = [...NODES];
  for (const { sec, band, href } of GUIDE_ROUTES) {
    if (sections.some((section) => section.id === sec || section.sec === sec)) continue;
    const guide = SECTIONS[sec];
    sections.push({ id: sec, sec, band, href: guide.href || href, t: guide.name });
  }
  const coverage = {
    atlasSections: NODES.length, guideSections: sections.length - NODES.length, parts: 0, guideSteps: 0, scenarios: 0,
    links: LINKS.length, insideIn: 0, insideOut: 0, process: 0, structure: 0, navigation: 0,
  };

  function addNode(section, id, title, description, kind, { plan, href = null, where } = {}) {
    const record = {
      id, section: section.id, band: section.band, title, description, kind, planned: Boolean(plan),
      href, order: nodes.length, ...(plan && { plan }), ...(where && { where }),
    };
    nodes.push(record);
    byId.set(id, record);
    return record;
  }

  function addEdge(from, to, kind, label, source) {
    const key = `${source}:${pairOf(from, to)}`;
    const occurrence = (edgeOccurrences.get(key) || 0) + 1;
    edgeOccurrences.set(key, occurrence);
    edges.push({
      id: `${key}:${occurrence}`, from, to, kind, label,
      planned: byId.get(from).planned || byId.get(to).planned, source,
    });
    if (kind !== 'data') coverage[kind]++;
  }

  function addSection(section, guide) {
    const record = addNode(section, section.id, nameOf(section), guide?.what || section.l.join(' '),
      'section', { plan: section.plan, href: hrefOf(section) || null, where: section.where });
    if (section.sec) byGuide.set(section.sec, record);
    if (record.href && !record.planned && !byRoute.has(record.href)) byRoute.set(record.href, record);
  }

  const targetFor = (href) => byRoute.get(href) || byRoute.get(routeOf(href));

  function addShortcut(action) {
    const target = targetFor(action.href);
    if (target) addEdge(action.id, target.id, 'navigation', 'Открыть раздел', 'href');
  }

  for (const section of sections) addSection(section, SECTIONS[section.sec]);

  // Оставляем каждую строку LINKS и отдельно отмечаем, какая часть принимает или отдаёт данные.
  for (const [from, to, label] of LINKS) {
    addEdge(from, to, 'data', label, 'LINKS');
    const pair = pairOf(from, to);
    if (!pairLabels.has(pair)) pairLabels.set(pair, new Set());
    pairLabels.get(pair).add(label);
  }

  function addPartRelation(from, to, sectionPair, source) {
    const labels = pairLabels.get(sectionPair);
    addEdge(from, to, 'data', labels ? [...labels].join(' · ') : '', source);
  }

  for (const section of sections) {
    let previous = null;
    for (const part of section.inside || []) {
      const id = `${section.id}.${part.id}`;
      const partNode = addNode(section, id, part.t, part.l, 'part', {
        plan: part.plan || section.plan, href: part.href, where: part.where,
      });
      coverage.parts++;
      addEdge(section.id, id, 'structure', 'Что внутри', 'inside');

      for (const from of part.in || []) {
        addPartRelation(from, id, pairOf(from, section.id), 'inside.in');
        coverage.insideIn++;
      }
      for (const to of part.out || []) {
        addPartRelation(id, to, pairOf(section.id, to), 'inside.out');
        coverage.insideOut++;
      }
      if (section.seq && !part.alt) {
        if (previous) addEdge(previous, id, 'process', 'Следующий шаг', 'inside.seq');
        previous = id;
      }
      if (part.href) addShortcut(partNode);
    }

    const guideSteps = SECTIONS[section.sec]?.steps || [];
    guideSteps.forEach((step, index) => {
      const id = `${section.id}.action.${step.id ?? index + 1}`;
      const action = addNode(section, id, step.t, step.d || '', 'action', {
        plan: step.plan || section.plan, href: step.href, where: step.where,
      });
      coverage.guideSteps++;
      addEdge(section.id, id, 'structure', 'Как работать', 'SECTIONS.steps');
      if (step.href) addShortcut(action);
    });
  }

  // sec определяет контекст задачи, адрес — экран, который действительно откроется.
  for (const scenario of SCENARIOS) {
    const section = byGuide.get(scenario.sec) || targetFor(scenario.href);
    if (!section) continue;
    const id = `${section.id}.action.${scenario.id}`;
    const action = addNode(section, id, scenario.want, scenario.start, 'action', {
      plan: scenario.plan || section.plan, href: scenario.href, where: scenario.menu,
    });
    coverage.scenarios++;
    addEdge(section.id, id, 'structure', 'Частая задача', 'SCENARIOS');
    addShortcut(action);
  }

  return { nodes, edges, groups: BANDS.map((band) => ({ ...band })), coverage };
}

/** Оставляет доступные переходы и связи, у которых видны оба конца. Полная карта остаётся источником для dc atlas. */
export function visibleAtlas(model, follows, showUnlinked) {
  const sections = new Set(model.nodes.filter(node => node.kind === 'section' &&
    (node.href ? follows(node.href) : showUnlinked)).map(node => node.id));
  const nodes = model.nodes.filter(node => sections.has(node.section) && (!node.href || follows(node.href)));
  const ids = new Set(nodes.map(node => node.id)), bands = new Set(nodes.map(node => node.band));
  return {
    nodes,
    edges: model.edges.filter(edge => ids.has(edge.from) && ids.has(edge.to)),
    groups: model.groups.filter(group => bands.has(group.id)),
  };
}

/** Поиск идёт по направлению связи. В обе стороны выполняются два независимых обхода. */
export function traceAtlas(edges, id, direction = 'both') {
  const nodeIds = new Set([id]), edgeIds = new Set();

  function trace(from, to) {
    const adjacent = new Map();
    for (const edge of edges) {
      if (!adjacent.has(edge[from])) adjacent.set(edge[from], []);
      adjacent.get(edge[from]).push(edge);
    }
    const visited = new Set([id]), stack = [id];
    while (stack.length) {
      for (const edge of adjacent.get(stack.pop()) || []) {
        const next = edge[to];
        edgeIds.add(edge.id);
        nodeIds.add(next);
        if (visited.has(next)) continue;
        visited.add(next);
        stack.push(next);
      }
    }
  }

  if (['both', 'incoming', 'upstream'].includes(direction)) trace('to', 'from');
  if (['both', 'outgoing', 'downstream'].includes(direction)) trace('from', 'to');
  return { nodeIds, edgeIds };
}
