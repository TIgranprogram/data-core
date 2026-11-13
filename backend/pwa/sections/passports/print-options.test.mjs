import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('./print-options.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/export function printOptions[\s\S]*$/, '');
const { printQuery, ORDER_FORMATS } = await import('data:text/javascript;base64,' + Buffer.from(src.replace(/FORMATS = \[/, 'FORMATS = [')).toString('base64'));

test('буклет, печать и подпись, ч/б, отмеченные позиции', () => {
  assert.deepEqual(printQuery({ variant: 'short', mode: 'print', seal: true, sign: true, bw: true, ids: ['a', 'b'] }),
    { variant: 'short', stamp: 1, mode: 'print', bw: 1, ids: 'a,b' });
});
test('без подписи — sign=0, без печати — seal=0, без обоих — без stamp', () => {
  assert.deepEqual(printQuery({ variant: 'full', mode: 'pages', seal: true }), { variant: 'full', stamp: 1, sign: 0 });
  assert.deepEqual(printQuery({ variant: 'full', mode: 'pages', sign: true }), { variant: 'full', stamp: 1, seal: 0 });
  assert.deepEqual(printQuery({ variant: 'short', mode: 'pages' }), { variant: 'short' });
});
test('все отмеченные — ids не передаётся; для заказа нет листа стенда', () => {
  assert.equal('ids' in printQuery({ variant: 'short', ids: null }), false);
  assert.deepEqual(ORDER_FORMATS.map((f) => f.mode), ['pages', 'print']);
});
