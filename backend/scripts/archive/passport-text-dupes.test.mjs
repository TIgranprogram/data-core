// Тесты нормализации и похожести (БЗ-6 Э3b): node --test backend/scripts/passport-text-dupes.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
const { normalize, dice, levenshtein, levRatio, isNearDuplicate, groupExact, findNearDuplicates, byCategory } = createRequire(import.meta.url)('./lib/text-dupes.js');

test('normalize: регистр, ё, пробелы, точка, кавычки', () => {
  assert.equal(normalize('  «Ёлка  Сталь».  '), 'елка сталь');
  assert.equal(normalize('Сталь; '), 'сталь');
  assert.equal(normalize('"Сталь" 09Г2С'), 'сталь 09г2с');
  assert.equal(normalize(null), '');
  assert.equal(normalize('...'), '');
});

test('dice и levenshtein', () => {
  assert.equal(dice('a b c', 'a b c'), 1);
  assert.equal(dice('a b', 'c d'), 0);
  assert.ok(dice('сталь 09г2с лист', 'сталь 09г2с') > 0.79);
  assert.equal(levenshtein('кот', 'кит'), 1);
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('aaaa', 'bbbbbbbb', 2), 3);
  assert.equal(levRatio('', ''), 0);
});

test('isNearDuplicate', () => {
  assert.equal(isNearDuplicate('сталь 09г2с', 'сталь 09г2с'), false);
  assert.equal(isNearDuplicate('труба стальная оцинкованная', 'труба стальная оцинкованая'), true);
  assert.equal(isNearDuplicate('сталь листовая горячекатаная', 'резина техническая пищевая'), false);
  assert.equal(isNearDuplicate('сталь', 'резина'), false);
});

test('groupExact: варианты написания и канонический', () => {
  const g = groupExact(new Map([['Сталь.', 5], ['сталь', 12], ['«Сталь»', 1], ['Резина', 3]]));
  assert.equal(g.length, 1);
  assert.equal(g[0].total, 18);
  assert.equal(g[0].canonical, 'сталь');
  assert.equal(g[0].variants.length, 3);
});

test('findNearDuplicates: пары и лимит', () => {
  const m = new Map([['Труба стальная оцинкованная', 4], ['Труба стальная оцинкованая', 2], ['Резина', 9]]);
  const r = findNearDuplicates(m);
  assert.equal(r.pairs.length, 1);
  assert.equal(r.pairs[0].countA, 4);
  assert.equal(findNearDuplicates(m, { maxUnique: 1 }).skipped, 2);
});

test('byCategory', () => {
  const r = byCategory([
    { category: 'A', value: 'Сталь' }, { category: 'A', value: 'сталь.' }, { category: 'A', value: 'Медь' },
    { category: null, value: 'x' }, { category: 'B', value: '' },
  ]);
  assert.deepEqual(r[0], { category: 'A', passports: 3, distinctRaw: 3, distinctNorm: 2 });
  assert.equal(r.find((x) => x.category === '(без категории)').passports, 1);
  assert.equal(r.some((x) => x.category === 'B'), false);
});
