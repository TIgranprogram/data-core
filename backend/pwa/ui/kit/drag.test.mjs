// node --test backend/pwa/ui/drag.test.mjs — решения «начать / ждать / отменить» при перетаскивании
import assert from 'node:assert/strict';
import test from 'node:test';
import { dragStep, afterDrag, isDragging, HOLD_MS } from './drag.js';

test('мышь: до 6 px ждём, дальше — старт', () => {
  assert.equal(dragStep({ touch: false, started: false, dist: 3 }), 'wait');
  assert.equal(dragStep({ touch: false, started: false, dist: 6 }), 'start');
});
test('палец: сдвинулся до долгого нажатия — это прокрутка', () => {
  assert.equal(dragStep({ touch: true, started: false, dist: 4 }), 'wait');
  assert.equal(dragStep({ touch: true, started: false, dist: 20 }), 'cancel');
  assert.equal(HOLD_MS, 350);
});
test('уже тащим — просто двигаем', () => {
  assert.equal(dragStep({ touch: true, started: true, dist: 200 }), 'move');
});
test('вне перетаскивания отложенное выполняется сразу', () => {
  let n = 0;
  afterDrag(() => { n++; });
  assert.equal(n, 1);
  assert.equal(isDragging(), false);
});
