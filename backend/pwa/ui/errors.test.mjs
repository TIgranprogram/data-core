// Ошибки по-русски (ОШ): node --test backend/pwa/ui/errors.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { errText } from './errors.js';

const GENERIC = /Что-то пошло не так в приложении/;
test('ответ сервера по-русски — как есть', () => { const e = Object.assign(new Error('Укажите артикул'), { status: 400 }); assert.equal(errText(e), 'Укажите артикул'); });
test('наша проверка (Error по-русски) — как есть', () => assert.equal(errText(new Error('Выберите изделие из списка')), 'Выберите изделие из списка'));
test('нет сети', () => { assert.match(errText(new TypeError('Failed to fetch')), /Нет связи с сервером/); assert.match(errText(new Error('NetworkError when attempting to fetch resource.')), /Нет связи/); });
test('долгий ответ', () => assert.match(errText(Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' })), /долго не отвечает/));
test('401 и 429', () => { assert.match(errText({ status: 401, message: 'Unauthorized' }), /войдите снова/); assert.match(errText({ status: 429, message: 'Too Many Requests' }), /подождите минуту/); });
test('внутренняя ошибка — общий текст, без английского', () => {
  const orig = console.error; console.error = () => {};
  try {
    assert.match(errText(new TypeError("Cannot read properties of undefined (reading 'x')")), GENERIC);
    assert.match(errText(new TypeError('[(...inputs.values(...))][0]?.input.focus is not a function')), GENERIC);
    assert.match(errText(new SyntaxError('Unexpected token < in JSON at position 0')), GENERIC);
    assert.match(errText(undefined), GENERIC);
    assert.match(errText('undefined'), GENERIC);
  } finally { console.error = orig; }
});
