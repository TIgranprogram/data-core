// Тесты шагов истории (TASKS НВ.6): node --test backend/pwa/core/nav-stack.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createNav } from './nav-stack.js';

test('первая запись — «Назад» неактивна, «Вперёд» неактивна', () => {
  const n = createNav(null);
  assert.deepEqual(n.init('#home', null), { dcIdx: 0, kind: 'screen' });
  assert.deepEqual(n.info(), { idx: 0, canBack: false, canForward: false, backUrl: null, forwardUrl: null });
});

test('раздел → раздел → назад → вперёд; подписи соседних экранов', () => {
  const n = createNav(null); n.init('#home', null);
  n.push('#requests'); n.push('#stock');
  assert.equal(n.info().backUrl, '#requests');
  assert.deepEqual(n.pop({ dcIdx: 1 }, '#requests'), { delta: -1, adopt: null });
  assert.deepEqual(n.info(), { idx: 1, canBack: true, canForward: true, backUrl: '#home', forwardUrl: '#stock' });
  n.pop({ dcIdx: 2 }, '#stock');
  assert.equal(n.info().canForward, false);
});

test('новый шаг после «назад» отбрасывает то, что было впереди', () => {
  const n = createNav(null); n.init('#a', null); n.push('#b'); n.push('#c');
  n.pop({ dcIdx: 1 }, '#b'); n.push('#d');
  assert.deepEqual(n.info(), { idx: 2, canBack: true, canForward: false, backUrl: '#b', forwardUrl: null });
});

test('фильтры, страницы — replace: шаг не добавляется; карточка — push с пометкой card', () => {
  const n = createNav(null); n.init('#stock', null);
  n.replace('#stock?status=low');
  assert.equal(n.info().idx, 0);
  assert.deepEqual(n.push('#stock?status=low&open=1', 'card'), { dcIdx: 1, kind: 'card' });
  assert.equal(n.info().backUrl, '#stock?status=low');
});

test('ссылка-якорь без state — новый шаг; обновление страницы — шаг из history.state', () => {
  const n = createNav(null); n.init('#home', null);
  const r = n.pop(null, '#requests?open=5');
  assert.equal(r.delta, 1); assert.deepEqual(r.adopt, { dcIdx: 1, kind: 'screen' });
  const again = createNav(n.save());
  assert.deepEqual(again.init('#requests?open=5', { dcIdx: 1, kind: 'screen' }), { dcIdx: 1, kind: 'screen' });
  assert.equal(again.info().backUrl, '#home');
});
