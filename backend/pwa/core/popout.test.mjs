import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function fixture(opener) {
  const stored = new Map([['dc-popout-dict', '1'], ['dc-popout-products', '1']]);
  const location = { origin: 'http://localhost:3102', pathname: '/app/', hash: '#dicts?d=passportParts&of=dict&open=p', reload() { this.reloaded = true; } };
  const window = { name: 'dc-solo-dict', opener, close() { this.closed = true; } };
  const localStorage = { getItem: (k) => stored.get(k), removeItem: (k) => stored.delete(k), setItem: (k, v) => stored.set(k, v) };
  const source = readFileSync(new URL('./popout.js', import.meta.url), 'utf8').replace(/^export /gm, '');
  const context = vm.createContext({ window, location, localStorage });
  vm.runInContext(source + '\nglobalThis.restore = returnToPanel;', context);
  return { stored, location, window, restore: context.restore };
}

test('возвращает точную запись в приложение и забывает только старый режим справочника', () => {
  const opener = { location: { origin: 'http://localhost:3102', pathname: '/app/', hash: '#dicts' }, focus() { this.focused = true; } };
  const f = fixture(opener);
  f.restore('dict');
  assert.equal(opener.location.hash, f.location.hash);
  assert.equal(opener.focused, true);
  assert.equal(f.window.closed, true);
  assert.equal(f.stored.has('dc-popout-dict'), false);
  assert.equal(f.stored.get('dc-popout-products'), '1');
});

test('без основного окна переоткрывает текущий адрес в обычной оболочке', () => {
  const f = fixture(null);
  f.restore('dict');
  assert.equal(f.window.name, '');
  assert.equal(f.window.closed, undefined);
  assert.equal(f.location.reloaded, true);
});
