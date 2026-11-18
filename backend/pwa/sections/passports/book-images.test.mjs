import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { imagesBody } from '../../core/passport-images.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
class Element {
  constructor(tag, attrs, children) { this.tag = tag; this.attrs = attrs || {}; this.children = []; this.hidden = !!attrs?.hidden; this.append(...children); }
  append(...kids) { this.children.push(...kids.flat().filter(Boolean)); }
  get firstChild() { return this.children[0]; }
}
function fixture({ inherited = false, status = 'draft', can = true, failPatch = false, kind = 'overview', images } = {}) {
  let row = { id: 'passport', status, images: [
    { kind: 'overview', photoId: 'old-a', caption: 'Старый' }, { kind: 'overview', photoId: 'old-b' },
    { kind: 'dimensions', photoId: 'dims', caption: 'Размеры' }, { kind: 'foundation', photoId: 'base' },
  ] };
  if (images) row.images = clone(images);
  if (inherited) row.effectiveImages = [{ kind: 'overview', photoId: 'product-view', fromProduct: true }];
  const drops = [], writes = [], requests = [];
  const kindOf = (i) => i.kind === 'safety_zone' ? 'safety' : i.kind || 'overview';
  const context = vm.createContext({
    PREFIX: '', kindOf, h: (tag, attrs, ...kids) => new Element(tag, attrs, kids), imagesBody,
    imgsOf: (r, kind) => (r.effectiveImages || r.images || []).filter((i) => kindOf(i) === kind), isRequired: () => false,
    iconButton: (o) => new Element('button', { onclick: o.onClick }, [o.label]),
    button: (o) => new Element('button', { onclick: o.onClick }, [o.label]),
    photoDrop: (o) => { drops.push(o); return new Element('drop', {}, []); },
    confirmDlg: async () => true, toastError(e) { throw e; },
    api: async (path, options) => {
      requests.push({ path, options });
      if (options?.method === 'PATCH') {
        if (failPatch) throw new Error('Нет связи');
        writes.push(clone(options.body)); row = { ...row, images: clone(options.body.images) };
      }
      return clone(row);
    },
  });
  const source = readFileSync(new URL('./book-images.js', import.meta.url), 'utf8').replace(/^import .+;\s*$/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\nglobalThis.show = imageStrip;', context);
  const ctx = { S: { r: clone(row) }, can, exclusive: (fn) => fn(), rerender() {} };
  const tree = context.show(ctx, kind, 'Общий вид', false);
  return { drops, writes, requests, tree, ctx, row: () => row, inheritNow: () => { row.effectiveImages = [{ kind: 'overview', photoId: 'live', fromProduct: true }]; } };
}

test('две последовательные загрузки PNG заменяют вид без дублей и сохраняют другие виды и подписи', async () => {
  const t = fixture();
  assert.match(t.drops[0].idleText, /Заменить/);
  assert.equal(t.drops[0].purpose, 'passport');
  await t.drops[0].attach('new-a.png');
  await t.drops[0].attach('new-b.png');
  assert.deepEqual(t.row().images.filter((i) => i.kind === 'overview').map((i) => i.photoId), ['new-b.png']);
  assert.deepEqual(t.row().images.filter((i) => i.kind !== 'overview').map((i) => [i.kind, i.photoId, i.caption]), [
    ['dimensions', 'dims', 'Размеры'], ['foundation', 'base', undefined],
  ]);
  assert.equal(t.writes.length, 2);
  assert.ok(t.requests.every((r) => !r.options?.method || r.options.method === 'PATCH'));
});

test('одновременные attach исполняются очередью: последний PNG выигрывает', async () => {
  const t = fixture();
  await Promise.all([t.drops[0].attach('a.png'), t.drops[0].attach('b.png')]);
  assert.deepEqual(t.row().images.filter((i) => i.kind === 'overview').map((i) => i.photoId), ['b.png']);
});

test('добавление ещё доступно отдельным действием и не превращает обычную загрузку в append', async () => {
  const t = fixture();
  assert.equal(t.drops.length, 1);
  const extra = t.tree.children.find((n) => n.tag === 'button' && n.children[0] === 'Добавить ещё');
  extra.attrs.onclick();
  assert.equal(t.drops.length, 2);
  assert.match(t.drops[1].idleText, /Добавить ещё/);
  await t.drops[1].attach('extra.png');
  assert.equal(t.row().images.filter((i) => i.kind === 'overview').length, 3);
  await t.drops[0].attach('replace.png');
  assert.deepEqual(t.row().images.filter((i) => i.kind === 'overview').map((i) => i.photoId), ['replace.png']);
});

test('inherited и readonly не предлагают запись raw images', () => {
  assert.equal(fixture({ inherited: true }).drops.length, 0);
  assert.equal(fixture({ can: false }).drops.length, 0);
});

test('свежий inherited перед PATCH блокирует устаревший upload', async () => {
  const t = fixture(); t.inheritNow();
  await assert.rejects(t.drops[0].attach('new.png'), /из изделия/);
  assert.equal(t.writes.length, 0);
});

test('неудача PATCH сохраняет прежний набор, issued проходит обычным PATCH паспорта', async () => {
  const failure = fixture({ failPatch: true });
  await assert.rejects(failure.drops[0].attach('new.png'), /Нет связи/);
  assert.equal(failure.row().images[0].photoId, 'old-a');
  const issued = fixture({ status: 'issued' });
  await issued.drops[0].attach('issued-new.png');
  assert.equal(issued.requests.find((r) => r.options?.method === 'PATCH').path, '/passports/passport');
});


test('старый safety_zone заменяется из safety, append не дублирует тот же снимок через alias', async () => {
  const t = fixture({ kind: 'safety', images: [
    { kind: 'safety_zone', photoId: 'old' }, { kind: 'safety', photoId: 'duplicate-kind' },
    { kind: 'overview', photoId: 'keep' },
  ] });
  await t.drops[0].attach('new');
  assert.deepEqual(t.row().images.map((i) => [i.kind, i.photoId]), [['overview', 'keep'], ['safety', 'new']]);
  const extra = t.tree.children.find((n) => n.tag === 'button' && n.children[0] === 'Добавить ещё');
  extra.attrs.onclick();
  t.row().images[1].kind = 'safety_zone';
  await t.drops[1].attach('new');
  assert.deepEqual(t.row().images.map((i) => [i.kind, i.photoId]), [['overview', 'keep'], ['safety', 'new']]);
});
