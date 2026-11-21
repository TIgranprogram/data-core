import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAtlasModel } from '../../sections/atlas-model.js';
import { atlasHierarchy, atlasScene } from './layout.js';
import { atlasSearchIndex, findAtlasNodes } from './search-index.js';

const data = atlasHierarchy(buildAtlasModel());
const productionAreas = ['sale', 'paper', 'prod', 'make', 'after', 'supply', 'stock', 'money'];
const productionLinks = [
  ['salesorders', 'products'], ['design', 'products'], ['products', 'work'], ['work', 'shiporder'],
  ['requests', 'stock'], ['stock', 'work'], ['staff', 'payroll'],
];

test('цепочка производства видна на всех глубинах широкого полотна', () => {
  for (const width of [1920, 2560, 3440]) {
    const view = { x: 0, y: 0, w: width - 260, h: 1016 };
    let scene = atlasScene(data, null, null, view);
    for (const id of ['area:make', 'work', 'work.sostav-pozicii']) {
      const origin = scene.cards.get(id)?.box;
      assert.ok(origin, id);
      scene = atlasScene(data, id, origin, view);
      for (const band of productionAreas) {
        const card = [...scene.cards.values()].find(({ node }) => node.id === 'area:' + band);
        assert.ok(card, `${width}: ${id}, ${band}`);
        assert.ok(card.box.x >= 0 && card.box.x + card.box.w <= view.w, `${width}: ${id}, ${band} за краем`);
      }
      for (const [from, to] of productionLinks) {
        assert.ok(scene.wires.some(({ edge }) => edge?.source === 'LINKS' && edge.from === from && edge.to === to),
          `${width}: ${id}, ${from} → ${to}`);
      }
    }
  }
});

test('контекст областей не подменяет точные связи состава изделия', () => {
  const id = 'products.sostav';
  const scene = atlasScene(data, id, null, { x: 0, y: 0, w: 1660, h: 1016 });
  const exact = data.edges.filter(({ from, to, kind }) => kind === 'data' && (from === id || to === id));
  const seen = scene.wires.filter(({ context, edge, kind }) => !context && edge && kind === 'data').map(({ edge }) => edge.id);
  assert.deepEqual(seen.sort(), exact.map(({ id }) => id).sort());
});

test('длинные цепочки снабжения и денег помещаются при разделении экрана', () => {
  const view = { x: 0, y: 0, w: 952, h: 1016 };
  let scene = atlasScene(data, null, null, view);
  for (const id of ['area:supply', 'requests', 'requests.priemka', 'area:money', 'money', 'money.vyplaty']) {
    scene = atlasScene(data, id, scene.cards.get(id)?.box, view);
    for (const [key, { box }] of scene.cards) {
      assert.ok(box.x >= 0 && box.x + box.w <= view.w, `${id}, ${key} за краем полотна`);
    }
  }
});

test('поиск карты ставит точный раздел и детальный путь выше упоминаний', () => {
  const index = atlasSearchIndex(data);
  const first = query => findAtlasNodes(index, query)[0]?.node.id;
  assert.equal(first('  ЗаЯвКа '), 'requests');
  assert.equal(first('ИЗДЕЛИЕ'), 'products');
  assert.equal(first('заявки приемка'), 'requests.priemka');
  assert.equal(first('что купить'), 'needs');
  assert.deepEqual(findAtlasNodes(index, 'несуществующийузел'), []);
});
