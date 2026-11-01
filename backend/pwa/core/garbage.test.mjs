import test from 'node:test';
import assert from 'node:assert/strict';
import { isGarbage, scrubText } from './garbage.js';

test('мусор ловится', () => {
  for (const s of ['[object HTMLSpanElement]', 'Цена: undefined', 'NaN', 'null', 'Итого NaN ₽', 'Invalid Date', 'Заказ {number}', '{{name}}', 'a (null)']) {
    assert.equal(isGarbage(s), true, s);
  }
});

test('нормальный текст не задет', () => {
  for (const s of ['Изменить', 'nullable', 'Nullify', 'unnull', 'undefinedly', 'Banana', 'Нет данных', '', 'Цена {}', '[x] список', 'JSON {"a":1}']) {
    assert.equal(isGarbage(s), false, s);
  }
});

test('scrubText: мусор -> пусто, нормальное как есть', () => {
  const orig = console.error; const calls = [];
  console.error = (...a) => calls.push(a.join(' '));
  try {
    assert.equal(scrubText('[object HTMLSpanElement]', '<h2>'), '');
    assert.equal(scrubText('Изменить', '<h2>'), 'Изменить');
  } finally { console.error = orig; }
  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\[мусор на экране\] <h2>/);
});
