import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function fixture() {
  const listeners = new Map();
  const document = { activeElement: null, addEventListener: (type, fn) => listeners.set(type, fn),
    removeEventListener: (type) => listeners.delete(type), body: { append(node) { document.dialog = node; } } };
  const h = (tag, attrs = {}, ...children) => ({ tag, attrs, children: children.filter((child) => child && typeof child === 'object'), isConnected: true,
    focus() { document.activeElement = this; }, remove() { this.isConnected = false; },
    querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.tag === selector ? [child] : []), ...child.querySelectorAll(selector)]); } });
  const source = readFileSync(new URL('./gallery.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const scope = vm.createContext({ document, h, PREFIX: '/db', mark: (node) => node });
  vm.runInContext(source, scope);
  const before = h('button'); before.focus();
  const openZoom = vm.runInContext('openZoom', scope);
  return { openZoom, document, listeners, before };
}
const event = (key) => ({ type: 'keydown', key, stopPropagation() {}, preventDefault() {} });

test('крупное фото имеет видимое закрытие и возвращает фокус исходной кнопке', () => {
  const f = fixture();
  f.openZoom([{ url: '/uploads/photo.png' }]);
  const box = f.document.dialog;
  const [close] = box.querySelectorAll('button');
  assert.equal(close.attrs['aria-label'], 'Закрыть фото');
  assert.equal(box.attrs['aria-modal'], 'true');
  assert.equal(f.document.activeElement, close);
  f.listeners.get('keydown')(event('Tab'));
  assert.equal(f.document.activeElement, close);
  close.attrs.onclick({ type: 'click', stopPropagation() {} });
  assert.equal(box.isConnected, false);
  assert.equal(f.document.activeElement, f.before);
  assert.equal(f.listeners.has('keydown'), false);
});

test('Escape закрывает, а Tab и стрелки сохраняют управление внутри увеличенного фото', () => {
  const f = fixture();
  f.openZoom([{ url: '/uploads/a.png' }, { url: '/uploads/b.png' }]);
  const box = f.document.dialog;
  const controls = box.querySelectorAll('button');
  f.listeners.get('keydown')(event('Tab'));
  assert.equal(f.document.activeElement, controls[1]);
  f.listeners.get('keydown')(event('ArrowRight'));
  assert.equal(box.children[0].src, '/db/uploads/b.png');
  assert.equal(box.isConnected, true);
  f.listeners.get('keydown')(event('Escape'));
  assert.equal(box.isConnected, false);
  assert.equal(f.document.activeElement, f.before);
});

function cardOpener(f, imageClass = 'g-big') {
  const src = 'https://example.test/db/uploads/cover.png';
  const owner = { isConnected: true, images: [], querySelectorAll() { return this.images; } };
  const makeImage = (url = src) => ({ isConnected: true, src: url,
    matches: (selector) => selector === 'img.g-big, img.pgal-img',
    closest: (selector) => selector === 'aside[data-k="drawer"]' ? owner : null,
    focus() { f.document.activeElement = this; }, className: imageClass });
  const opener = makeImage();
  owner.images = [opener]; opener.focus();
  return { owner, opener, makeImage };
}

for (const imageClass of ['g-big', 'pgal-img']) {
  test(`Escape возвращает фокус заменённому ${imageClass} с тем же src в исходной панели`, () => {
    const f = fixture();
    const { owner, opener, makeImage } = cardOpener(f, imageClass);
    f.openZoom([{ url: '/uploads/cover.png' }]);
    opener.isConnected = false;
    const replacement = makeImage(); owner.images = [replacement];
    f.listeners.get('keydown')(event('Escape'));
    assert.equal(f.document.activeElement, replacement);
  });
}

test('подключённый исходный opener важнее другого изображения в панели', () => {
  const f = fixture();
  const { owner, opener, makeImage } = cardOpener(f);
  f.openZoom([{ url: '/uploads/cover.png' }]);
  owner.images = [makeImage()];
  f.listeners.get('keydown')(event('Escape'));
  assert.equal(f.document.activeElement, opener);
});

for (const mode of ['wrong-asset', 'dead-owner']) {
  test(`закрытие не переводит фокус на посторонний рисунок: ${mode}`, () => {
    const f = fixture();
    const { owner, opener, makeImage } = cardOpener(f);
    f.openZoom([{ url: '/uploads/cover.png' }]);
    const replacement = makeImage(mode === 'wrong-asset' ? 'https://example.test/db/uploads/other.png' : opener.src);
    owner.images = [replacement]; opener.isConnected = false;
    if (mode === 'dead-owner') owner.isConnected = false;
    const focusBeforeClose = f.document.activeElement;
    f.listeners.get('keydown')(event('Escape'));
    assert.equal(f.document.activeElement, focusBeforeClose);
    assert.notEqual(f.document.activeElement, replacement);
  });
}
