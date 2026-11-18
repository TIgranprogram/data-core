import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { imagesBody } from '../../core/passport-images.js';

function load(row) {
  const writes = [], drops = [];
  const context = vm.createContext({
    PREFIX: '', canEdit: () => true, statusOf: () => 'draft', isRequired: () => false,
    kinds: () => [['overview', 'Общий вид', 'Обложка']], kindOf: (i) => i.kind,
    h: (tag, attrs, ...children) => ({ tag, attrs, children }), section: (opts) => opts,
    confirmDlg: async () => true, imagesBody,
    photoDrop: (opts) => { drops.push(opts); return { tag: 'drop' }; },
    api: async (_path, opts) => { if (opts?.method === 'PATCH') writes.push(opts.body); return row; },
    toastError: (e) => { throw e; },
  });
  const common = readFileSync(new URL('./common.js', import.meta.url), 'utf8')
    .match(/^export const imgsOf = .+$/m)[0].replace('export ', '');
  const card = readFileSync(new URL('./card-blocks.js', import.meta.url), 'utf8')
    .replace(/^import .+;\s*$/gm, '').replace(/export /g, '');
  vm.runInContext(common + '\n' + card + '\nglobalThis.show = imagesBlock;', context);
  const tree = context.show(row, { setRow() {} });
  const nodes = [];
  function visit(x) {
    if (Array.isArray(x)) { x.forEach(visit); return; }
    if (!x || typeof x !== 'object') return;
    nodes.push(x); visit(x.body); visit(x.children);
  }
  visit(tree);
  return { tree, writes, drops, remove: nodes.find((x) => x.attrs?.class === 'pf-del') };
}

test('рисунок из изделия показывается с верным счётчиком, без ложного удаления и загрузки поверх', () => {
  const t = load({ id: 'p1', images: [], effectiveImages: [{ kind: 'overview', photoId: 'inherited', url: '/p.png', fromProduct: true }] });
  assert.equal(t.tree.count, 1);
  assert.equal(t.remove, undefined);
  assert.equal(t.drops.length, 0);
});
test('свой рисунок удаляется по id и виду даже при отдельном объекте предпросмотра', async () => {
  const image = { kind: 'overview', photoId: 'own', url: '/own.png' };
  const t = load({ id: 'p1', images: [image], effectiveImages: [{ ...image, fromProduct: false }] });
  await t.remove.attrs.onclick();
  assert.equal(t.writes.length, 1);
  assert.equal(t.writes[0].images.length, 0);
});
