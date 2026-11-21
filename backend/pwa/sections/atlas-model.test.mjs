import assert from 'node:assert/strict';
import test from 'node:test';
import { BANDS, LINKS, NODES } from './atlas-data.js';
import { SCENARIOS, SECTIONS } from './help-guide-data.js';
import { buildAtlasModel, traceAtlas } from './atlas-model.js';

test('граф сохраняет разделы, части, действия и адреса из источников', () => {
  const model = buildAtlasModel();
  const { nodes, edges, groups, coverage } = model;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  assert.deepEqual(model, buildAtlasModel());
  assert.deepEqual(groups, BANDS);
  assert.equal(byId.size, nodes.length);
  assert.equal(new Set(edges.map((edge) => edge.id)).size, edges.length);
  assert.ok(edges.every(({ from, to }) => byId.has(from) && byId.has(to)));
  assert.equal(coverage.atlasSections, NODES.length);
  const guideOnly = ['home', 'search', 'chat', 'trash', 'history', 'profile'];
  assert.equal(coverage.guideSections, guideOnly.filter((id) => !NODES.some((section) => section.id === id || section.sec === id)).length);
  assert.equal(coverage.parts, NODES.flatMap((section) => section.inside || []).length);
  assert.equal(coverage.guideSteps, Object.values(SECTIONS).flatMap((section) => section.steps || []).length);
  assert.equal(coverage.scenarios, SCENARIOS.length);
  assert.equal(coverage.structure, coverage.parts + coverage.guideSteps + coverage.scenarios);
  for (const id of guideOnly) assert.equal(byId.get(id).href, SECTIONS[id].href || `#${id}`);
  assert.equal(byId.get('home.action.1').title, SECTIONS.home.steps[0].t);
  assert.equal(byId.get('stockmobile').href, '#stock-mobile');
  assert.equal(byId.get('gantt').href, '#workschedule');
  assert.equal(byId.get('servers').where, 'Администрирование → Серверы');
  assert.equal(byId.get('servers').href, null);
  assert.equal(byId.get('servers.schedule-code').kind, 'part');
  assert.equal(byId.get('shipping.otgruzheno').plan, 'идея');
  assert.equal(byId.get('offers.razobrat-zayavku-ii').plan, 'C092');
  assert.ok(edges.find(({ from, to }) => from === 'products' && to === 'stock.bron-po-sostavu').planned);
});

test('каждая строка LINKS и каждое объявление in/out сохраняются с направлением и источником', () => {
  const { edges, coverage } = buildAtlasModel();
  const declared = edges.filter(({ source }) => source === 'LINKS');
  assert.deepEqual(declared.map(({ from, to, label }) => [from, to, label]), LINKS);
  assert.equal(coverage.links, LINKS.length);

  const incoming = [], outgoing = [];
  const labels = (from, to) => [...new Set(LINKS.filter(([a, b]) => from === a && to === b).map((link) => link[2]))].join(' · ');
  for (const section of NODES) {
    for (const part of section.inside || []) {
      const id = `${section.id}.${part.id}`;
      for (const from of part.in || []) incoming.push([from, id, labels(from, section.id)]);
      for (const to of part.out || []) outgoing.push([id, to, labels(section.id, to)]);
    }
  }
  const dataEdges = edges.filter(({ kind }) => kind === 'data');
  const rows = (source) => dataEdges.filter((edge) => edge.source === source).map(({ from, to, label }) => [from, to, label]);
  assert.deepEqual(rows('inside.in'), incoming);
  assert.deepEqual(rows('inside.out'), outgoing);
  assert.equal(coverage.insideIn, incoming.length);
  assert.equal(coverage.insideOut, outgoing.length);
  assert.equal(dataEdges.length, LINKS.length + incoming.length + outgoing.length);
});

test('параллельные записи LINKS сохраняют подписи и получают разные идентификаторы', (t) => {
  const initial = buildAtlasModel();
  const row = LINKS.find(([from, to]) => from === 'requests' && to === 'money');
  const [from, to] = row;
  const extra = [from, to, 'Дополнительная подпись'];
  LINKS.push(extra, [...row]);
  t.after(() => LINKS.splice(-2));

  const { edges } = buildAtlasModel();
  const pair = edges.filter((edge) => edge.source === 'LINKS' && edge.from === from && edge.to === to);
  assert.deepEqual(pair.map(({ label }) => label), [row[2], extra[2], row[2]]);
  assert.equal(new Set(pair.map(({ id }) => id)).size, 3);
  assert.equal(pair[0].id, initial.edges.find((edge) => edge.source === 'LINKS' && edge.from === from && edge.to === to).id);
  assert.equal(edges.find((edge) => edge.source === 'inside.out' && edge.from === 'requests.schet' && edge.to === to).label,
    `${row[2]} · ${extra[2]}`);
});

test('порядок берётся из основных строк seq, переходы ведут на документированные адреса', () => {
  const { nodes, edges, coverage } = buildAtlasModel();
  const process = edges.filter(({ kind }) => kind === 'process');
  const expected = NODES.filter(({ seq }) => seq).flatMap((section) => {
    const ids = section.inside.filter(({ alt }) => !alt).map(({ id }) => `${section.id}.${id}`);
    return ids.slice(1).map((id, index) => [ids[index], id]);
  });
  assert.deepEqual(process.map(({ from, to }) => [from, to]), expected);
  assert.equal(coverage.process, expected.length);

  const navigation = edges.filter(({ kind }) => kind === 'navigation');
  const byId = new Map(nodes.map((node) => [node.id, node]));
  assert.equal(coverage.navigation, navigation.length);
  const linkedActions = nodes.filter(({ kind, href }) => kind !== 'section' && href);
  for (const action of linkedActions) {
    const target = nodes.find((node) => node.kind === 'section' && !node.planned && node.href === action.href)
      || nodes.find((node) => node.kind === 'section' && !node.planned && node.href === action.href.split('?')[0]);
    const matches = navigation.filter(({ from }) => from === action.id);
    assert.deepEqual(matches.map(({ to }) => to), target ? [target.id] : []);
  }
  assert.ok(navigation.some(({ from, to }) => from === 'requests.action.contract' && to === 'contracts'));
  assert.ok(navigation.some(({ from, to }) => from === 'stock.action.fixout' && to === 'movements'));
  assert.equal(byId.get('requests.action.invoice').href, '#requests?tab=invoices');
});

test('в графе есть проверенные адреса экранов и отдельных режимов', () => {
  const { nodes } = buildAtlasModel();
  const routes = new Set(nodes.filter(({ href, planned }) => href && !planned).map(({ href }) => href));
  const screens = [
    'home', 'requests', 'stock', 'suppliercatalog', 'contracts', 'salesorders',
    'design', 'work', 'workschedule', 'products', 'modules', 'parts', 'offers',
    'docs', 'partners', 'money', 'expenses', 'payroll', 'staff', 'stock-mobile',
    'dicts', 'fill', 'movements', 'search', 'trash', 'history',
  ];
  assert.deepEqual(screens.filter((id) => !routes.has(`#${id}`)), []);
  for (const href of ['#stock?view=pipe', '#stock?view=sheet', '#home?of=profile&open=me', '#chat']) {
    assert.ok(routes.has(href), href);
  }
});

test('обход завершает циклы, сохраняет параллельные рёбра и не меняет направление на развилке', () => {
  const edges = [
    { id: 'up', from: 'A', to: 'B' },
    { id: 'side', from: 'A', to: 'E' },
    { id: 'down-1', from: 'B', to: 'C' },
    { id: 'down-2', from: 'B', to: 'C' },
    { id: 'cycle-1', from: 'C', to: 'D' },
    { id: 'cycle-2', from: 'D', to: 'C' },
  ];
  assert.deepEqual(traceAtlas(edges, 'B', 'upstream'), { nodeIds: new Set(['A', 'B']), edgeIds: new Set(['up']) });
  assert.deepEqual(traceAtlas(edges, 'B', 'downstream'), {
    nodeIds: new Set(['B', 'C', 'D']), edgeIds: new Set(['down-1', 'down-2', 'cycle-1', 'cycle-2']),
  });
  assert.deepEqual(traceAtlas(edges, 'B', 'both'), {
    nodeIds: new Set(['A', 'B', 'C', 'D']), edgeIds: new Set(['up', 'down-1', 'down-2', 'cycle-1', 'cycle-2']),
  });
  assert.deepEqual(traceAtlas(edges, 'E', 'outgoing'), { nodeIds: new Set(['E']), edgeIds: new Set() });
});
