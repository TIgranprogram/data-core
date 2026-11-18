import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('лист книжки выводит серверную проекцию и количества без самостоятельного раскрытия', () => {
  let table;
  const sandbox = vm.createContext({
    h: (_tag, _attrs, child) => child,
    kitTable: (options) => { table = options; return options; },
  });
  const source = readFileSync(new URL('./book-composition-tree.js', import.meta.url), 'utf8')
    .replace(/^import .+;\s*$/gm, '').replace('export function', 'function');
  vm.runInContext(source + '\nglobalThis.sheet = compositionSheet;', sandbox);
  sandbox.sheet([{ word: 'Модуль', label: 'Рама · Р.01', qty: 2, unit: 'шт', children: [
    { word: 'Деталь', label: 'Опора · ОП.01', qty: 6, unit: 'шт' },
  ] }, { word: 'Изделие', label: 'Лестница · Л.01', qty: 1, unit: 'шт' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(table.rows.map((r) => r.cells))), [
    ['Модуль', 'Рама · Р.01', '2 шт'], ['Деталь', '— Опора · ОП.01', '6 шт'], ['Изделие', 'Лестница · Л.01', '1 шт'],
  ]);
  assert.doesNotMatch(source, /api\(|\/materials|\/modules|\/showcase/);
});
test('черновик и выпущенный паспорт показывают только compositionSheet из своего ответа', () => {
  const source = readFileSync(new URL('./book-editor.js', import.meta.url), 'utf8');
  const begin = source.indexOf('function ensureComposition()');
  const code = source.slice(begin, source.indexOf('function editable', begin));
  for (const status of ['draft', 'issued']) {
    const projection = [{ word: 'Изделие', label: status, qty: 1, unit: 'шт' }];
    const sandbox = vm.createContext({ S: { r: { status, compositionSheet: projection } }, ctx: {} });
    vm.runInContext(code + '\nensureComposition();', sandbox);
    assert.equal(sandbox.ctx.compTree.lines, projection);
  }
  const blocks = readFileSync(new URL('./book-blocks.js', import.meta.url), 'utf8');
  assert.match(blocks, /modules.length && r.compositionPresentation !== 'tree'/);
});


function renderDescription(row) {
  const source = readFileSync(new URL('./book-blocks.js', import.meta.url), 'utf8');
  const modules = source.slice(source.indexOf('  const modules ='), source.indexOf('  const rulesList ='));
  const description = source.slice(source.indexOf('  const descrSection ='), source.indexOf('  const rulesSection ='));
  const output = [];
  const sandbox = vm.createContext({
    r: row, ctx: { compTree: { lines: [{ label: 'BOM', qty: 2 }] } },
    t: {}, plan: { descrNo: '1' },
    h: (tag, attrs, ...children) => ({ tag, attrs, children }), numText: String,
    push: (...nodes) => output.push(...nodes), hd: (v) => v, sub: (v) => v,
    specTable: () => [], compositionSheet: () => 'Дерево BOM', rulesList() {},
  });
  vm.runInContext(modules + description + '\ndescrSection();', sandbox);
  return JSON.stringify(output);
}

test('богатое описание both видно рядом с BOM, размеры не скрываются', () => {
  const rendered = renderDescription({ status: 'draft', compositionPresentation: 'both', modules: [{ name: 'Секция', qty: 2, dims: '1200×600', photoId: 'photo' }] });
  assert.match(rendered, /Дерево BOM/);
  assert.match(rendered, /Модули: сохранённое описание/);
  assert.match(rendered, /1200×600/);
});

test('доказанный простой дубль с marker tree не отображается второй раз', () => {
  const rendered = renderDescription({ status: 'draft', compositionPresentation: 'tree', modules: [{ name: 'Секция', qty: 2 }] });
  assert.match(rendered, /Дерево BOM/);
  assert.doesNotMatch(rendered, /Модули: сохранённое описание/);
});

test('старый issued без marker сохраняет legacy описание рядом с BOM', () => {
  const rendered = renderDescription({ status: 'issued', modules: [{ name: 'Исторический модуль', qty: 3, dims: '300×200' }] });
  assert.match(rendered, /Дерево BOM/);
  assert.match(rendered, /Модули: сохранённое описание/);
  assert.match(rendered, /Исторический модуль/);
});
