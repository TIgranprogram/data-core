// План переноса рисунков паспортов в изделие: node --test backend/scripts/passport-images-to-product.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { buildPlan } = createRequire(import.meta.url)('./passport-images-to-product.js');

const ph = (...ids) => new Set(ids);
const pass = (id, productId, status, updatedAt, images) => ({ _id: id, productId, status, updatedAt, images });

test('берёт рисунки из выпущенного паспорта раньше черновика, расхождение — в список', () => {
  const ps = [
    pass('d', 'a', 'draft', '2026-09-01', [{ kind: 'dimensions', photoId: 'p3' }]),
    pass('i', 'a', 'issued', '2026-01-01', [{ kind: 'dimensions', photoId: 'p1', caption: 'Размеры' }, { kind: 'overview', photoId: 'p2' }]),
  ];
  const p = buildPlan(ps, [], ph('p1', 'p2', 'p3'));
  assert.deepEqual(p.items.map((x) => [x.kind, x.photoId]).sort(), [['dimensions', 'p1'], ['overview', 'p2']]);
  assert.equal(p.conflicts.length, 1);
  assert.deepEqual(p.conflicts[0].other, ['p3']);
});

test('вид, уже заполненный в изделии, и повторный запуск — пусто', () => {
  const ps = [pass('i', 'a', 'issued', '2026-01-01', [{ kind: 'overview', photoId: 'p1' }])];
  assert.equal(buildPlan(ps, [{ productId: 'a', kind: 'overview' }], ph('p1')).items.length, 0);
});

test('нет файла и bom_item — пропуски, в записи не попадают', () => {
  const ps = [pass('i', 'a', 'issued', '2026-01-01', [{ kind: 'holes', photoId: 'gone' }, { kind: 'bom_item', photoId: 'p1', refCode: 'К-1' }])];
  const p = buildPlan(ps, [], ph('p1'));
  assert.equal(p.items.length, 0);
  assert.equal(p.skipped.length, 2);
});

test('несколько рисунков одного вида идут по порядку', () => {
  const ps = [pass('i', 'a', 'issued', '2026-01-01', [{ kind: 'assembly', photoId: 'p2', order: 1 }, { kind: 'assembly', photoId: 'p1', order: 0 }])];
  assert.deepEqual(buildPlan(ps, [], ph('p1', 'p2')).items.map((x) => [x.photoId, x.sortOrder]), [['p1', 0], ['p2', 1]]);
});
