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
