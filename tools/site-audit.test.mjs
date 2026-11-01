// node --test tools/site-audit.test.mjs — чистые функции большой проверки, без браузера.
import test from 'node:test';
import assert from 'node:assert/strict';

process.argv[1] = 'x';
const { mergeFindings, buildReport, summaryLines } = await import('./site-audit.mjs');

test('mergeFindings склеивает ширины', () => {
  const m = mergeFindings([{ rule: 'a', screen: 's', sel: 'b', text: 't', w: 390 }, { rule: 'a', screen: 's', sel: 'b', text: 't', w: 1600 }, { rule: 'd', screen: 's', sel: 'b', text: 't', w: 390 }]);
  assert.equal(m.length, 2);
  assert.deepEqual(m[0].widths, [390, 1600]);
});

test('buildReport не длиннее лимита и считает правила', () => {
  const f = Array.from({ length: 500 }, (_, i) => ({ rule: 'e', screen: 'экран' + i, sel: 'p', text: 'x', widths: [390] }));
  const r = buildReport(f, { date: '2026-11-01', base: 'b', screens: 1, panels: 1, code: [] });
  assert.ok(r.split('\n').length <= 201);
  assert.match(r, /e\) сжатый текст «столбиком»: 500/);
});

test('summaryLines до 15 строк', () => {
  assert.ok(summaryLines({ date: 'd', screens: 1, panels: 2, total: 0, byRule: { a: 0 }, code: ['x'] }).length <= 15);
});
