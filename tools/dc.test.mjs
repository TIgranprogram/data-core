// node --test tools/dc.test.mjs — разбор и форматирование dc, без сети.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseErrors, formatErrors, parseFill, parseGitStatus, parseAheadBehind, lastTestLog, parseJest, fmtTime } from './dc.mjs';

const sample = JSON.stringify({ items: [
  { count: 8, lastAt: '2026-10-30T13:32:10.852Z', message: 'Медленно: products 7907 мс', name: 'SlowScreen', section: 'products', sampleStack: 'первая\nвторая' },
  { count: 3, lastAt: '2026-10-30T09:12:56.262Z', message: 'FN.x is not a function', name: 'TypeError', section: 'stock', sampleStack: 'TypeError\n at' },
] });

test('parseErrors: разбор и мусор', () => {
  assert.equal(parseErrors(sample).length, 2);
  assert.equal(parseErrors('не json'), null);
  assert.equal(parseErrors('{"a":1}'), null);
});

test('formatErrors: стек только у SlowScreen, лимит строк', () => {
  const l = formatErrors(parseErrors(sample));
  assert.equal(l.length, 3);
  assert.match(l[0], /^8× Медленно: products 7907 мс · products · /);
  assert.equal(l[1], '    ↳ первая');
  const many = parseErrors(JSON.stringify({ items: Array.from({ length: 30 }, () => ({ count: 1, message: 'm', name: 'E', lastAt: '2026-01-01T00:00:00Z' })) }));
  assert.equal(formatErrors(many).length, 10);
});

test('parseFill: топ-5 по убыванию', () => {
  const j = JSON.stringify({ total: 30, groups: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ area: 'A', title: 't' + n, count: n })) });
  const f = parseFill(j);
  assert.equal(f.groups.length, 5);
  assert.equal(f.groups[0].count, 7);
  assert.equal(parseFill('x'), null);
});

test('git: статус и отставание', () => {
  assert.deepEqual(parseGitStatus(' M a.js\n?? b\n?? c\nA  d\n'), { changed: 2, untracked: 2 });
  assert.deepEqual(parseAheadBehind('1\t3\n'), { ahead: 1, behind: 3 });
  assert.equal(parseAheadBehind('fatal'), null);
});

test('TEST-LOG и jest', () => {
  assert.match(lastTestLog('| дата |\n| 2026-10-29 | база | full: ok | — |\n| 2026-10-30 | поверх | full: tsc 0 | — |'), /^2026-10-30: full: tsc 0/);
  assert.equal(lastTestLog('нет'), null);
  assert.equal(parseJest('Test Suites: 2 passed\nTests:       5 passed, 5 total').tests, '5 passed, 5 total');
});

test('fmtTime: неверная дата', () => {
  assert.equal(fmtTime('мусор'), '—');
  assert.match(fmtTime('2026-10-30T13:32:00Z'), /^\d\d\.10 \d\d:\d\d$/);
});
