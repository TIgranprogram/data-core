import test from 'node:test';
import assert from 'node:assert/strict';
import { isStale, mayReload, RELOAD_GAP } from './stale.js';

test('ошибка 13.11 про недостающий экспорт — устаревший модуль', () => {
  assert.equal(isStale(new SyntaxError("The requested module './common.js' does not provide an export named 'passportTypeLine'")), true);
  assert.equal(isStale(new Error('Failed to fetch dynamically imported module: https://x/sections/docs.js')), true);
  assert.equal(isStale(new Error('Приложение обновилось. Обновите страницу (F5).')), true);
});
test('обычные ошибки не вызывают перезагрузку', () => {
  assert.equal(isStale(new Error('Укажите артикул')), false);
  assert.equal(isStale(null), false);
});
test('перезагрузка не чаще раза в две минуты', () => {
  assert.equal(mayReload(0, 1e6), true);
  assert.equal(mayReload(1e6, 1e6 + 1000), false);
  assert.equal(mayReload(1e6, 1e6 + RELOAD_GAP + 1), true);
});
