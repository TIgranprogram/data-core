// Тесты строки поиска (TASKS ПО.4): node --test backend/pwa/ui/search-logic.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { onlyLatest, searchDecider } from './search-logic.js';

test('ввод → поиск; пусто → сброс (список целиком); повтор не дублирует', () => {
  const d = searchDecider(1);
  assert.deepEqual(d('болт'), { action: 'search', q: 'болт' });
  assert.deepEqual(d(' болт  '), { action: 'none', q: 'болт' });
  assert.deepEqual(d(''), { action: 'clear', q: '' });
  assert.deepEqual(d('   '), { action: 'none', q: '' });
  assert.deepEqual(d('м10  гайка'), { action: 'search', q: 'м10 гайка' });
});

test('1 знак при минимуме 2 — не искать, подсказка; потом пусто — сброс', () => {
  const d = searchDecider(2);
  assert.equal(d('болт').action, 'search');
  assert.deepEqual(d('б'), { action: 'hint', q: 'б', hint: 'Введите минимум 2 символа' });
  assert.deepEqual(d(''), { action: 'clear', q: '' });
});

test('гонка ответов: устаревший медленный ответ отбрасывается', async () => {
  const latest = onlyLatest();
  const slow = latest(new Promise((r) => setTimeout(() => r('старый'), 30)));
  const fast = latest(Promise.resolve('новый'));
  assert.equal(await fast, 'новый');
  assert.equal(await slow, latest.STALE);
});
