// node --test backend/pwa/core/order-color.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { orderColor, orderColorIndex, ORDER_COLORS } from './order-color.js';

test('цвет заказа стабилен и в пределах палитры', () => {
  const id = '65f1c0a2b3c4d5e6f7a8b9c0';
  assert.equal(orderColorIndex(id), orderColorIndex(id));
  for (const s of [id, 'a', '1', 'ffffffffffffffffffffffff', '000000000000000000000000']) {
    const n = orderColorIndex(s);
    assert.ok(n >= 1 && n <= ORDER_COLORS, s);
  }
});

test('цвета разных заказов расходятся (палитра используется целиком)', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(orderColorIndex('65f1c0a2b3c4d5e6f7a8' + String(i).padStart(4, '0')));
  assert.equal(seen.size, ORDER_COLORS);
});

test('без заказа — серый, заказ — токен палитры', () => {
  assert.equal(orderColorIndex(''), 0);
  assert.equal(orderColor(null).oc, 'var(--muted)');
  const c = orderColor('abc');
  assert.match(c.oc, /^var\(--oc-\d+\)$/);
  assert.equal(c.soft, `var(--oc-${c.n}-soft)`);
});
