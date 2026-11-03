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

const { panelStructureFindings, panelStructureSnapshot, RULES } = await import('./site-audit.mjs');

test('группа реального счёта без ссылки даёт n, legacy номер без id не даёт ложную ссылку', () => {
  const id = '507f1f77bcf86cd799439011';
  assert.deepEqual(panelStructureFindings({ groups: [{ key: id, label: 'Счёт № 34', hasEntry: false }] }).map(x => x.rule), ['n']);
  assert.equal(panelStructureFindings({ groups: [{ key: id, label: 'Счёт № 34', hasEntry: true }, { key: 'n:34', label: 'Счёт № 34', hasEntry: false }] }).length, 0);
});

test('несколько старых групп в одной простыне распознаются, одна группа не считается ошибкой', () => {
  assert.deepEqual(panelStructureFindings({ flatGroupHeadings: 2 }).map(x => x.rule), ['o']);
  assert.equal(panelStructureFindings({ flatGroupHeadings: 1 }).length, 0);
});

test('object Object в src распознаётся в обычном и URL-encoded виде', () => {
  for (const src of ['/db/[object Object]', '/app/[object%20Object]']) assert.deepEqual(panelStructureFindings({ imageSources: [src] }).map(x => x.rule), ['p']);
  assert.equal(panelStructureFindings({ imageSources: ['/uploads/photo.webp'] }).length, 0);
});

test('DOM snapshot не читает поля ввода и собирает только структурные признаки', () => {
  const keys = [];
  const doc = { querySelectorAll(s) { keys.push(s); if (s === '.k-gfold[data-group-key]') return [{ dataset: { groupKey: '507f1f77bcf86cd799439011' }, querySelector: () => ({ textContent: 'Счёт № 34', matches: () => true, querySelector: () => null }) }]; if (s === 'img[src]') return [{ getAttribute: () => '/uploads/photo.webp' }]; return []; } };
  const snap = panelStructureSnapshot(doc);
  assert.deepEqual(panelStructureFindings(snap), []);
  assert.equal(snap.groups[0].hasEntry, true);
  assert.equal(keys.length, 3);
  assert(!keys.some(x => /input|textarea|token/.test(x)));
});

test('новые правила присутствуют в штатном отчёте кнопки аудита', () => {
  for (const rule of ['n', 'o', 'p']) assert(RULES[rule]);
  const findings = panelStructureFindings({ flatGroupHeadings: 2, imageSources: ['[object Object]'] }).map(x => ({ ...x, widths: [390], screen: 'Счёт' }));
  const r = buildReport(findings, { date: '2026-11-03', base: 'QA', screens: 1, panels: 1 });
  assert.match(r, /o\).*: 1/);
  assert.match(r, /p\).*: 1/);
});
