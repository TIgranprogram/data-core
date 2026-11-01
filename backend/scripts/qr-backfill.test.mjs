import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { makeCode, buildPlan, buildDocs } = createRequire(import.meta.url)('./qr-backfill.js');

test('код: префикс и 8 знаков без 0 O 1 I L', () => {
  for (let i = 0; i < 200; i++) assert.match(makeCode('S'), /^S-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/);
});

test('план: у кого уже есть код — пропускаем, повтор id не дублирует', () => {
  const plan = buildPlan({ stockIds: ['a', 'b', 'b'], productIds: ['p1', 'p2'], have: new Set(['S:a', 'P:p2']) });
  assert.deepEqual(plan.stock.add, ['b']);
  assert.deepEqual(plan.products.add, ['p1']);
  assert.equal(plan.stock.total, 2);
});

test('записи: коды уникальны, занятые не повторяются', () => {
  const plan = buildPlan({ stockIds: ['a', 'b', 'c'], productIds: ['p'], have: new Set() });
  let n = 0;
  const docs = buildDocs(plan, new Date(0), () => (n++ < 8 ? 0 : n % 31), new Set(['S-22222222']));
  assert.equal(docs.length, 4);
  assert.equal(new Set(docs.map((d) => d.code)).size, 4);
  assert.ok(!docs.some((d) => d.code === 'S-22222222'));
});

test('повторный запуск после выдачи — 0 новых', () => {
  const plan = buildPlan({ stockIds: ['a'], productIds: [], have: new Set(['S:a']) });
  assert.equal(buildDocs(plan).length, 0);
});
