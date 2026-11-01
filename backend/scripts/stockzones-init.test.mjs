// Склады-зоны (WZ-6): node --test backend/scripts/stockzones-init.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { planZones } = createRequire(import.meta.url)('./stockzones-init.js');

const cats = [
  { _id: 'metal', name: 'Металл', parentId: null },
  { _id: 'pipe', name: 'Профильная труба', parentId: 'metal' },
  { _id: 'pipe-sq', name: 'Квадратная', parentId: 'pipe' },
  { _id: 'round', name: 'Круглая труба', parentId: 'metal' },
  { _id: 'sheet', name: 'Листовой металл', parentId: null },
  { _id: 'bolts', name: 'Метизы', parentId: null },
  { _id: 'bolts-m8', name: 'M8', parentId: 'bolts' },
];

test('три склада: «Основной» без трубы, листа и их родителя; труба и лист - свои корни', () => {
  const p = planZones(cats, [], []);
  const by = Object.fromEntries(p.zones.map((z) => [z.name, z]));
  assert.deepEqual(Object.keys(by), ['Основной', 'Профильная труба', 'Листовой материал']);
  assert.equal(by['Основной'].isDefault, true);
  assert.deepEqual(by['Основной'].categoryIds.sort(), ['bolts', 'bolts-m8', 'round'].sort()); // «Металл» (родитель трубы) не входит
  assert.deepEqual(by['Профильная труба'].categoryIds, ['pipe']);
  assert.deepEqual(by['Листовой материал'].categoryIds, ['sheet']);
});

test('нет категории трубы - склад не создаётся, предупреждение', () => {
  const p = planZones(cats.filter((c) => !/Профильн|Квадрат/.test(c.name)), [], []);
  assert.deepEqual(p.zones.map((z) => z.name), ['Основной', 'Листовой материал']);
  assert.ok(p.warnings.some((w) => /труба/i.test(w)));
});

test('уже созданный склад не создаётся повторно', () => {
  const p = planZones(cats, [{ _id: 'z1', name: 'основной' }], []);
  assert.equal(p.zones.find((z) => z.name === 'Основной').exists, true);
  assert.equal(p.zones.find((z) => z.name === 'Профильная труба').exists, false);
});

test('роли: категории -> склады; уже перенесённая и не покрытая пропускаются', () => {
  const roles = [
    { name: 'Трубарез', stockCategoryIds: ['pipe-sq'] },
    { name: 'Лазер', stockCategoryIds: ['sheet', 'round'] },
    { name: 'Готовая', stockCategoryIds: ['pipe'], warehouseIds: ['z'] },
    { name: 'Без складов', stockCategoryIds: ['unknown'] },
    { name: 'Без ограничений' },
  ];
  const p = planZones(cats, [], roles);
  const r = Object.fromEntries(p.roles.map((x) => [x.name, x]));
  assert.deepEqual(r['Трубарез'].warehouseNames, ['Профильная труба']);
  assert.deepEqual(r['Лазер'].warehouseNames, ['Основной', 'Листовой материал']);
  assert.match(r['Готовая'].skip, /уже выбраны/);
  assert.match(r['Без складов'].skip, /не покрыты/);
  assert.equal(r['Без ограничений'], undefined);
  assert.ok(p.warnings.some((w) => /Трубарез/.test(w) && /шире/.test(w))); // склад «Профильная труба» шире одной подкатегории
});
