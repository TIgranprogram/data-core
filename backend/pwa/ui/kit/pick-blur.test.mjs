import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function fixture() {
  const timers = [], handlers = new Map(), picked = [];
  const document = { activeElement: null, addEventListener() {} };
  const classList = { add() {}, remove() {} };
  let box;
  const input = { value: 'Ногоступ', classList, parentElement: { classList },
    insertAdjacentElement(_, node) { box = node; }, setAttribute() {}, addEventListener: (name, fn) => handlers.set(name, fn),
    dispatchEvent: (event) => handlers.get(event.type)?.(event) };
  const h = (tag, attrs = {}, ...children) => ({ tag, ...attrs, classList, children,
    contains(node) { return this.children.includes(node); }, replaceChildren(...items) { this.children = items; }, querySelector: () => null });
  const source = readFileSync(new URL('./pick.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replace(/export /g, '');
  const scope = vm.createContext({ document, window: { matchMedia: () => ({ matches: false }) }, h, mark: (node) => node,
    normSearch: (text) => text.toLowerCase(), searchTokens: (text) => [text.toLowerCase()], highlight: (text) => text, placeList() {},
    MutationObserver: class { observe() {} }, Event: class { constructor(type) { this.type = type; } }, setTimeout: (fn) => timers.push(fn) });
  vm.runInContext(source, scope);
  vm.runInContext('attachCombo', scope)(input, { options: [{ label: 'Ногоступ', value: 'foot' }], onPick: (option) => picked.push(option) });
  return { input, document, timers, handlers, picked, get box() { return box; } };
}

test('отложенный blur не закрывает новый подбор после возврата фокуса в исходное поле', () => {
  const f = fixture();
  f.document.activeElement = {};
  f.handlers.get('blur')();
  f.document.activeElement = f.input;
  f.handlers.get('input')();
  assert.equal(f.box.hidden, false);
  f.timers.shift()();
  assert.equal(f.box.hidden, false);
  assert.equal(f.box.children[0].role, 'option');
});

test('выбор мышью закрывает список и отменяет повторную активацию поля через label', () => {
  const f = fixture();
  f.document.activeElement = f.input;
  f.input.dispatchEvent = (event) => f.handlers.get(event.type)?.(event);
  f.handlers.get('input')();
  const option = f.box.children[0];
  option.onmousedown({ preventDefault() {} });
  assert.equal(f.picked.length, 0);
  let cancelled = false;
  option.onclick({ preventDefault() { cancelled = true; }, stopPropagation() {} });
  if (!cancelled) f.handlers.get('click')(); // обычная активация label повторила бы клик по input
  assert.equal(cancelled, true);
  assert.equal(f.picked.length, 1);
  assert.equal(f.box.hidden, true);
});

test('после настоящего ухода в другое поле список закрывается, фокус внутри списка сохраняет его', () => {
  const f = fixture();
  f.handlers.get('input')();
  const option = f.box.children[0];
  f.document.activeElement = option;
  f.handlers.get('blur')(); f.timers.shift()();
  assert.equal(f.box.hidden, false);
  f.document.activeElement = {};
  f.handlers.get('blur')(); f.timers.shift()();
  assert.equal(f.box.hidden, true);
});

test('выбор стрелкой и Enter по-прежнему закрывает список и передаёт значение один раз', () => {
  const f = fixture();
  f.document.activeElement = f.input;
  f.handlers.get('focus')();
  f.handlers.get('input')();
  for (const key of ['ArrowDown', 'Enter']) f.handlers.get('keydown')({ key, preventDefault() {}, stopPropagation() {} });
  assert.equal(f.picked.length, 1);
  assert.equal(f.picked[0].value, 'foot');
  assert.equal(f.box.hidden, true);
});
