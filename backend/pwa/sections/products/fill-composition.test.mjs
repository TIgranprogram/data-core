import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function fixture(canEdit) {
  const frames = [], events = [];
  const target = (name) => ({ focus: () => events.push(['focus', name]), scrollIntoView: () => events.push(['scroll', name]) });
  const summary = target('Состав');
  const sandbox = vm.createContext({
    requestAnimationFrame: (callback) => frames.push(callback), session: { canEdit },
    h: () => ({}), button: (opts) => ({ ...opts, ...target(opts.label) }),
    section: (props) => ({ ...props, isConnected: false, querySelector: () => summary }),
    setCompositionTarget: (row) => events.push(['editor', row.id]),
    patch: (params) => events.push(['route', params.of]),
  });
  const module = (name) => readFileSync(new URL(name, import.meta.url), 'utf8')
    .replace(/^import .+;\s*$/gm, '').replace(/^export \{.+;\s*$/gm, '').replace(/export /g, '');
  vm.runInContext(module('./card-blocks.js') + module('./fill-block.js'), sandbox);
  const { go, compositionBlock } = vm.runInContext('({ go, compositionBlock })', sandbox);
  return { go, compositionBlock, events, frames, row: { id: '1067', composition: [] } };
}

for (const tab of ['comp', 'files']) {
  test(`«Заполнить» из вкладки ${tab} раскрывает именно состав и фокусирует его правку`, async () => {
    const f = fixture(true);
    const other = { id: 'second', composition: [] };
    let displayed = tab === 'comp' ? f.compositionBlock(f.row) : null;
    if (displayed) assert.equal(displayed.open, false);
    const opened = [];
    f.go({ kind: 'product', key: 'composition' }, f.row, { openTab: (key) => {
      opened.push(key);
      queueMicrotask(() => { displayed = f.compositionBlock(f.row); displayed.isConnected = true; });
    } });
    assert.equal(f.compositionBlock(other).open, false);
    await Promise.resolve();
    assert.deepEqual(opened, ['comp']);
    assert.equal(displayed.open, true);
    assert.deepEqual(f.events, []);
    f.frames.shift()();
    assert.deepEqual(f.events, [['focus', 'Изменить состав'], ['scroll', 'Изменить состав']]);
    displayed.body[0].onClick();
    assert.deepEqual(f.events.slice(2), [['editor', '1067'], ['route', 'composition']]);
    assert.equal(f.compositionBlock(f.row).open, false);
  });
}

test('без права записи раскрывает состав и фокусирует заголовок', () => {
  const f = fixture(false);
  let block;
  f.go({ kind: 'product', key: 'composition' }, f.row, { openTab: () => { block = f.compositionBlock(f.row); } });
  block.isConnected = true;
  f.frames.shift()();
  assert.equal(block.open, true);
  assert.equal(block.body[0], null);
  assert.deepEqual(f.events, [['focus', 'Состав'], ['scroll', 'Состав']]);
});
