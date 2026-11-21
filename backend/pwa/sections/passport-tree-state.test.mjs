import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const state = await import('data:text/javascript,' + encodeURIComponent(read('./passport-tree-state.js')));
const row = (id, extra = {}) => ({ id, parentId: 'purpose', text: 'Предназначено для размещения информации.',
  categories: 'BLG', allCategories: false, ...extra });

test('одинаковые фразы с разными ограничениями не являются дублями', () => {
  for (const extra of [{ groupIds: ['stand'] }, { kindIds: ['kind'] }, { facetValueIds: ['facet'] },
    { categories: 'TRN' }, { allCategories: true }, { partIds: ['part'] }, { isDefault: true }, { required: true }]) {
    assert.equal(state.phraseDuplicates([row('a'), row('b', extra)]).size, 0);
  }
});

test('дубли совпадают по тексту и применимости независимо от порядка множеств', () => {
  const a = row('a', { kindIds: ['one', 'two'], groupIds: ['stand'] });
  const b = row('b', { kindIds: ['two', 'one'], groupIds: ['stand'], text: '  ПРЕДНАЗНАЧЕНО   для размещения информации. ' });
  assert.deepEqual([...state.phraseDuplicates([a, b])], [['a', 2], ['b', 2]]);
  assert.equal(state.phraseDuplicates([row('empty-a', { text: '' }), row('empty-b', { text: ' ' })]).size, 0);
});

test('контейнер всех категорий не делает чужую баскетбольную ветку обязательной для TRN', () => {
  const root = { id: 'basket', allCategories: true };
  assert.equal(state.phraseRootApplies(root, [row('leaf', { parentId: 'basket', categories: 'DSP' })], 'TRN'), false);
  assert.equal(state.phraseRootApplies(root, [row('leaf', { parentId: 'basket', categories: 'DSP' })], 'DSP'), true);
  assert.equal(state.phraseRootApplies({ id: 'empty', categories: 'TRN', allCategories: false }, [], 'TRN'), true);
});

function screen(items) {
  const el = (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat(Infinity).filter(Boolean),
    replaceChildren(...next) { this.children = next.flat(Infinity).filter(Boolean); } });
  let quality;
  let category;
  const context = vm.createContext({
    ...state,
    api: async () => ({ items }),
    dictRows: async () => [{ code: 'TRN', name: 'Уличный тренажёр' }, { code: 'BLG', name: 'Благоустройство' }],
    h: el, canEditTexts: () => false, current: () => ({ params: {} }),
    busyBlock: () => el('p', null, 'Загрузка'), failBlock: (e) => { throw e; },
    qualityFilter: (opts) => { quality = opts; return el('filters'); },
    select: (opts) => { category = opts; return el('select'); },
    qualityBadges: () => [], empty: ({ title }) => el('p', null, title),
    searchBox: () => ({ el: el('input'), clear() {} }), withVars: (text) => [text],
    clamp:value=>value,table: ({ rows }) => el('table', null, ...rows.map((row) => el('tr', null, row.cells))),
    stack: (...children) => el('div', null, children), hint: (text) => el('p', null, text),
    button: ({ label }) => el('button', null, label), whenText: (raw) => raw,
  });
  vm.runInContext(read('./passport-dict-table.js').replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, ''), context);
  vm.runInContext(read('./passport-tree.js').replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '')
    + '\nglobalThis.mount = mountTree;', context);
  const view = context.mount();
  const text = (node) => typeof node === 'string' ? node : node.children.map(text).join(' ');
  return { view, text: () => text(view.el), select: (code) => category.onChange(code),
    mode: (value) => quality.onChange(value), counts: () => quality.counts };
}

const fixtures = [
  { id: 'purpose', name: 'Назначение', text: '', allCategories: true },
  row('info'), row('stand', { groupIds: ['stand'] }),
  { id: 'velo', name: 'Краткое описание — Вело', text: '', categories: 'TRN', allCategories: false },
  row('pedals', { parentId: 'velo', categories: 'TRN', text: 'Тренажёр состоит из рамы и педалей.' }),
];

test('экран считает качество внутри выбранной категории и не рисует чужие пустые разделы', async () => {
  const s = screen(fixtures);
  await s.view.reload();
  s.select('TRN');
  assert.equal(s.counts().dupes, 0);
  assert.equal(s.counts().empty, 0);
  assert.ok(s.text().includes('Краткое описание — Вело'));
  assert.ok(!s.text().includes('Предназначено для размещения информации.'));
  assert.ok(!s.text().includes('нет текста для типа'));
});

test('режим Дубли не скрывает лист, оставляя ложное Вариантов пока нет', async () => {
  const s = screen(fixtures);
  await s.view.reload();
  s.select('TRN');
  s.mode('dupes');
  assert.ok(s.text().includes('Дублей нет.'));
  assert.ok(!s.text().includes('Вариантов пока нет'));
  s.mode('all');
  assert.ok(s.text().includes('Тренажёр состоит из рамы и педалей.'));
});

test('настоящая пара дублей показывается только в своей категории', async () => {
  const s = screen([...fixtures, row('duplicate')]);
  await s.view.reload();
  s.select('BLG');
  assert.equal(s.counts().dupes, 2);
  s.mode('dupes');
  assert.ok(s.text().includes('Предназначено для размещения информации.'));
  s.select('TRN');
  assert.equal(s.counts().dupes, 0);
  assert.ok(s.text().includes('Дублей нет.'));
});
