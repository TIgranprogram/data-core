// node --test tools/dc.test.mjs — разбор и форматирование dc, без сети.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseErrors, formatErrors, parseFill, parseGitStatus, parseAheadBehind, lastTestLog, parseJest, fmtTime, orderStats } from './dc.mjs';

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

test('backupWord: возраст копии из /api/health', async () => {
  const { backupWord } = await import('./dc.mjs');
  assert.deepEqual(backupWord(JSON.stringify({ details: { backup: { status: 'up', ageHours: 5 } } })), { bad: false, text: '5 ч' });
  assert.equal(backupWord(JSON.stringify({ error: { backup: { status: 'down', ageHours: 40 } } })).bad, true);
  assert.equal(backupWord('').text, 'не отвечает');
});

import fs from 'node:fs';
import { cmdStatus } from './dc.mjs';
test('T23: dc status — отдельный live transport; в тесте только fake GET/curl', () => {
  const calls = [], lines = [];
  const code = cmdStatus({
    prodGetFn: (route) => { calls.push(['GET', route]); return { ok: true, text: JSON.stringify({ status: 'ok', info: { backup: { ageHours: 1 } } }) }; },
    runFn: (file, args) => { calls.push([file, ...args]); return { code: 0, stdout: file === 'git' ? 'abcdef0' : JSON.stringify({ v: 'abcdef0', n: 1, date: '2026-11-03' }) }; },
    sayFn: (s) => lines.push(s), logFn() {}, testLogFn: () => 'fake unit', nightFn: () => 'fake night',
  });
  assert.equal(code, 0); assert.deepEqual(calls[0], ['GET', '/api/health']);
  assert.equal(calls[1][0], 'curl'); assert.ok(calls[1].at(-1).endsWith('/app/version.json'));
  assert.match(lines[0], /Прод: health ok/);
});
test('T23: check и full не вызывают dc status неявно', () => {
  const source = fs.readFileSync(new URL('dc.mjs', import.meta.url), 'utf8');
  for (const [start, end] of [['function cmdCheck()', 'export function cmdStatus'], ['function cmdFull()', 'function cmdLogs']]) assert.doesNotMatch(source.slice(source.indexOf(start), source.indexOf(end)), /cmdStatus\s*\(|['"]status['"]|prodGet\s*\(/);
});

test('orderStats: экран чист, если его файлов нет среди нарушений', () => {
  const st = orderStats({ total: 7, byFile: { 'backend/pwa/sections/home.js': 3, 'backend/pwa/sections/products/a.js': 2, 'backend/pwa/ui/base.css': 2 } }, ['home.js', 'products', 'qr.js', 'chat.js']);
  assert.deepEqual(st, { pct: 50, clean: 2, screens: 4, violations: 7 });
});
