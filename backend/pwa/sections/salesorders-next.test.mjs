// node --test backend/pwa/sections/salesorders-next.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';

const { nextStep } = await import('./salesorders-next.js');

test('готов и отгружено ведут к паспортам заказа', () => {
  const ready = nextStep({ stage: 'ready', key: '21-26', orderIds: ['abc'] });
  assert.equal(ready.text, 'Паспорта заказа');
  assert.equal(ready.btn.label, 'Паспорта заказа');
  assert.match(ready.btn.href, /of=orderpass/);
  assert.match(ready.btn.href, /open=abc/);

  const many = nextStep({ stage: 'shipped', key: '21-26', orderIds: ['a', 'b'] });
  assert.equal(many.text, 'Паспорта заказа');
  assert.match(many.btn.href, /salesorders\?open=/);

  const none = nextStep({ stage: 'ready', id: 'x' });
  assert.equal(none.btn.label, 'Паспорта заказа');
  assert.match(none.btn.href, /salesorders/);
});

test('частичная отгрузка по-прежнему зовёт досдачу', () => {
  const s = nextStep({ stage: 'partly', key: '7' });
  assert.match(s.text, /остаток/);
  assert.equal(s.btn.label, 'Отгрузка');
});
