import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { findLongCycles, fixtureScan, selfTest, scan, splitKnown, KNOWN_LONG } = require('./audit-cycles.js');
const here = path.dirname(fileURLToPath(import.meta.url));

test('цикл длины 3 и 4 ловится, пара не считается длинным', () => {
  const adj = new Map([
    ['a', new Set(['b'])],
    ['b', new Set(['c', 'a'])],
    ['c', new Set(['a', 'd'])],
    ['d', new Set(['e'])],
    ['e', new Set(['b'])],
  ]);
  const keys = findLongCycles(adj).map((c) => c.join('>'));
  assert.deepEqual(keys, ['a>b>c', 'b>c>d>e']);
});

test('цепочка без возврата не цикл', () => {
  const adj = new Map([
    ['a', new Set(['b'])],
    ['b', new Set(['c'])],
    ['c', new Set()],
  ]);
  assert.deepEqual(findLongCycles(adj), []);
});

test('фикстура на диске: треугольник, пара, spec не рисует ребро', () => {
  const { pairs, long, edges } = fixtureScan();
  assert.deepEqual([...edges.keys()].sort(), ['a>b', 'b>c', 'c>a', 'd>e', 'e>d', 'f>g', 'z>a']);
  assert.deepEqual(pairs, [['d', 'e']]);
  assert.deepEqual(long, [['a', 'b', 'c']]);
});

test('self-test выходит 0', () => {
  assert.equal(selfTest(), 0);
});

test('белый список не прячет чужой цикл и ловит лишнюю строку', () => {
  const { fresh, stale } = splitKnown([['a', 'b', 'c'], ['design', 'salesorders', 'incomes']]);
  assert.deepEqual(fresh.map((c) => c.join('>')), ['a>b>c']);
  assert.equal(stale.length, KNOWN_LONG.length - 1);
  assert.equal(stale.includes('design>salesorders>incomes'), false);
});

test('текущее дерево: нет пар и нет циклов вне снимка C256', () => {
  const result = scan(path.join(here, '..', 'src', 'modules'));
  const { fresh } = splitKnown(result.long);
  assert.equal(result.pairs.length, 0);
  assert.equal(fresh.length, 0);
});
