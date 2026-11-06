// node --test backend/scripts/fix-bolt-photos.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { buildPlan, GOOD, WRONG } = require('./fix-bolt-photos.js');

test('фото шайбы → фото болта; без фото шайбы — пропуск; лишние фото сохраняются после эталона', () => {
  const [a, b] = WRONG;
  const plan = buildPlan([
    { _id: a[0], name: 'Болт M10х30', photoIds: [a[1], 'x1'], mainPhotoId: a[1] },
    { _id: b[0], name: 'Болт M10х90', photoIds: ['other'] },
  ]);
  assert.equal(plan.change.length, 1);
  assert.deepEqual(plan.change[0].photoIds, [GOOD, 'x1']);
  assert.ok(plan.skip.some((s) => s.id === b[0]));
  assert.equal(plan.skip.filter((s) => s.why === 'позиции нет').length, WRONG.length - 2);
});
