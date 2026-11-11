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

const { panelStructureFindings, panelStructureSnapshot, gapFindings, RULES } = await import('./site-audit.mjs');

test('C087: голые поля без kit-контейнера — подписи, слипание и перекрытие', async () => {
  const { formControlFindings } = await import('./site-audit.mjs');
  const field = (top, labelled = true, group = 0, left = 0) => ({ sel: 'select', top, bottom: top + 36, left, right: left + 200, labelled, group });
  assert.deepEqual(formControlFindings([field(0, false), field(36, false)]).map(x => x.rule), ['fl', 'fl', 'fg']);
  assert.deepEqual(formControlFindings([field(0), field(48)]), []);
  assert.deepEqual(formControlFindings([field(0), field(0, true, 0, 220)]), []);
  assert.deepEqual(formControlFindings([field(0), field(36, true, 1)]), []);
  assert.match(formControlFindings([field(0), field(30)])[0].text, /перекрываются/);
});

test('C087: snapshot не считает aria-label видимой подписью, не читает value', async () => {
  const { formControlSnapshot } = await import('./site-audit.mjs');
  const group = {};
  const label = { tagName: 'LABEL', getBoundingClientRect: () => ({ width: 100, height: 20 }), childNodes: [{ nodeType: 3, textContent: 'Категория' }] };
  const input = (labels = []) => ({ tagName: 'SELECT', type: 'select-one', labels, id: '',
    get value() { throw new Error('Нельзя читать значения'); },
    getBoundingClientRect: () => ({ width: 200, height: 36, top: 20, bottom: 56, left: 0, right: 200 }),
    getAttribute: (name) => name === 'aria-label' ? 'Категория' : '',
    closest: (s) => s.startsWith('table') ? null : group });
  const doc = { querySelectorAll: () => [input(), input([label])], defaultView: { getComputedStyle: () => ({}) } };
  assert.deepEqual(formControlSnapshot(doc).map(x => x.labelled), [false, true]);
});

test('t: слипшиеся блоки и кнопки панели — находка; зазор 12px, перенос строки и другая колонка — нет', () => {
  const col = (tops) => tops.map(([t, b]) => ({ top: t, bottom: b, left: 0, right: 300 }));
  assert.deepEqual(gapFindings([{ sel: 's', dir: 'col', rects: col([[0, 60], [60, 120]]) }]).map((x) => x.rule), ['t']);
  assert.equal(gapFindings([{ sel: 's', dir: 'col', rects: col([[0, 60], [72, 120]]) }]).length, 0);
  assert.equal(gapFindings([{ sel: 's', dir: 'col', rects: [{ top: 0, bottom: 60, left: 0, right: 300 }, { top: 0, bottom: 60, left: 320, right: 600 }] }]).length, 0);
  const btn = (l, r, t = 0) => ({ top: t, bottom: t + 40, left: l, right: r });
  assert.deepEqual(gapFindings([{ sel: 'a', dir: 'row', rects: [btn(0, 80), btn(80, 160)] }]).map((x) => x.rule), ['t']);
  assert.equal(gapFindings([{ sel: 'a', dir: 'row', rects: [btn(0, 80), btn(88, 160)] }]).length, 0);
  assert.equal(gapFindings([{ sel: 'a', dir: 'row', rects: [btn(0, 80), btn(0, 80, 48)] }]).length, 0);
  assert.ok(RULES.t);
});

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

test('ДС-1: вид карточки и правила наведения', async () => {
  const { cardLookFindings, hoverRuleFindings } = await import('./site-audit.mjs');
  assert.deepEqual(cardLookFindings({ radius: '10px', borderTop: '1px', shadow: 'none' }), []);
  assert.equal(cardLookFindings({ radius: '7px', borderTop: '1px', shadow: 'none' }).length, 1);
  assert.equal(cardLookFindings({ radius: '10px', borderTop: '1px', shadow: 'rgba(0,0,0,.1) 0 1px 2px' }).length, 1);
  assert.deepEqual(cardLookFindings({ radius: '10px', borderTop: '1px', shadow: '0 0 0 2px red', selected: true }), []);
  assert.deepEqual(hoverRuleFindings([{ sel: '.k-hover:hover', transform: 'translateY(-2px)', shadow: 'var(--shadow)' }, { sel: '.tcard:hover', transform: '', shadow: 'var(--shadow)' }]), []);
  assert.equal(hoverRuleFindings([{ sel: '.k-hover:hover', transform: 'translateY(-2px)', shadow: 'var(--shadow-lg)' }]).length, 1);
  assert.equal(hoverRuleFindings([{ sel: '.col-body .tcard:hover', transform: 'translateY(-1px)', shadow: '' }]).length, 1);
});

test('правило v: поле выше содержимого', async () => {
  const { fieldHeightFindings } = await import('./site-audit.mjs');
  assert.deepEqual(fieldHeightFindings([{ sel: 'f', label: 'Гарантия', height: 260, content: 66 }]).map((x) => x.rule), ['v']);
  assert.equal(fieldHeightFindings([{ sel: 'f', label: 'Гарантия', height: 70, content: 66 }]).length, 0);
});
