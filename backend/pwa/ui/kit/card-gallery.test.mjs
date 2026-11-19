import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function fixture() {
  const zooms = [], changed = [], removed = [];
  const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.flat(Infinity).filter(Boolean),
    listeners: new Map(), classList: { toggle() {} },
    addEventListener(key, handler) { this.listeners.set(key, handler); },
    querySelectorAll(selector) { return this.children.flatMap((child) => typeof child === 'object'
      ? [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)] : []); },
  });
  const source = readFileSync(new URL('./card-gallery.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '').replace('export function gallery', 'function gallery');
  const context = vm.createContext({ h, PREFIX: '/db', openZoom: (...args) => zooms.push(args) });
  vm.runInContext(source + '\nglobalThis.subject = gallery;', context);
  const pics = [{ id: 'first', url: '/uploads/first.png' }, { id: 'second', url: '/uploads/second.png' }];
  const view = context.subject(pics, (pic) => removed.push(pic), (pic) => changed.push(pic));
  return { view, pics, zooms, changed, removed };
}

test('собственная галерея открывает общий доступный viewer с выбранным оригиналом без изменения обложки', () => {
  const f = fixture();
  const [big, strip] = f.view.children;
  strip.children[1].children[0].attrs.onclick();
  big.listeners.get('click')();
  assert.equal(f.zooms[0][0], f.pics);
  assert.equal(f.zooms[0][1], 1);
  assert.equal(f.changed.length, 0);
  assert.equal(f.removed.length, 0);
  assert.equal(f.view.delBtn.tag, 'button');
  assert.equal(f.pics[0].id, 'first');
});

test('собственная фотография открывается Enter и пробелом; прочие клавиши не запускают viewer', () => {
  const f = fixture(), big = f.view.children[0];
  assert.equal(big.attrs.tabindex, 0);
  const keydown = big.listeners.get('keydown');
  let prevented = 0, stopped = 0;
  for (const key of ['Enter', ' ', 'x']) keydown({ key, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  assert.equal(f.zooms.length, 2);
  assert.equal(prevented, 2);
  assert.equal(stopped, 2);
});
