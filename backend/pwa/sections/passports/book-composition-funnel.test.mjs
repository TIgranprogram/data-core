/**
 * C142: воронка состава — сырьё не предлагаем, дети модуля с /composition.
 * loadCatalog / moduleKids / KIND_LABEL не экспортированы.
 * Тот же файл в vm.Script (не SourceTextModule): без браузера и без --experimental-vm-modules.
 * Публичный export book-composition-funnel.js не меняется.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const srcUrl = new URL('./book-composition-funnel.js', import.meta.url);
const source = readFileSync(srcUrl, 'utf8');

function el() {
  return {
    children: [],
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    replaceChildren(...xs) { this.children = xs; },
    append(...xs) { this.children.push(...xs); },
    closest() { return this; },
  };
}

/** Поднимает реальные функции файла; импорты — поля песочницы. */
function load(api) {
  const seen = { steps: null };
  const code = source
    .replace(/^import\s.+;\s*$/gm, '')
    .replace(/export\s+(async\s+function\s+mountCompositionFunnel)/, '$1')
    + '\n__out.KIND_LABEL = KIND_LABEL;\n'
    + '__out.loadCatalog = loadCatalog;\n'
    + '__out.moduleKids = moduleKids;\n'
    + '__out.mountCompositionFunnel = mountCompositionFunnel;\n';
  if (/^import\s/m.test(code) || /^export\s/m.test(code)) {
    throw new Error('не снялись import/export — vm.Script их не выполнит');
  }
  const sandbox = {
    api,
    session: { canEdit: false },
    h: () => el(),
    button: () => el(),
    hint: () => el(),
    stack: () => el(),
    textInput: () => ({ el: el(), value: '' }),
    empty: () => el(),
    select: () => el(),
    field: () => el(),
    funnel(opts) {
      seen.steps = opts.steps;
      return { el: el(), update(next) { if (next?.steps) seen.steps = next.steps; } };
    },
    toast() {},
    toastError() {},
    parseNum(v) {
      const n = Number(String(v ?? '').replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    },
    sidePanel: () => el(),
    __out: {},
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'book-composition-funnel.js' });
  return { ...sandbox.__out, steps: () => seen.steps };
}

test('сырьё не в шаге «Что», loadCatalog(raw) пуст', async () => {
  const calls = [];
  const mod = load(async (path) => { calls.push(path); return { composition: [] }; });
  assert.equal(Object.hasOwn(mod.KIND_LABEL, 'raw'), false);
  const raw = await mod.loadCatalog('raw');
  assert.equal(raw.length, 0);
  assert.deepEqual(calls, []);

  await mod.mountCompositionFunnel(el(), 'p1', {});
  const what = mod.steps().find((s) => s.key === 'kind');
  assert.equal(what.label, 'Что добавить');
  assert.deepEqual([...what.values.map((v) => v.id)], ['module', 'part', 'purchased']);
});

test('moduleKids зовёт /modules/:id/composition', async () => {
  const calls = [];
  const mod = load(async (path) => {
    calls.push(path);
    return [{ lineType: 'material', name: 'Труба', quantity: 2, unit: 'м' }];
  });
  const kids = await mod.moduleKids('mod-7');
  assert.deepEqual(calls, ['/modules/mod-7/composition']);
  assert.equal(kids.length, 1);
  assert.equal(kids[0].lineType, 'material');
  assert.equal(kids[0].name, 'Труба');
  assert.equal(kids[0].quantity, 2);
  assert.equal(kids[0].unit, 'м');
});

test('mountCompositionFunnel экспортируется, книжка его зовёт', async () => {
  assert.match(source, /export\s+async\s+function\s+mountCompositionFunnel\s*\(/);
  const side = readFileSync(new URL('./book-side-edit.js', import.meta.url), 'utf8');
  assert.match(side, /openCompositionInBook/);
  assert.match(side, /import\('\.\/book-composition-funnel\.js'\)/);
  assert.match(side, /mountCompositionFunnel\(slot,\s*productId/);

  const mod = load(async () => ({ composition: [] }));
  assert.equal(typeof mod.mountCompositionFunnel, 'function');
  const back = await mod.mountCompositionFunnel(el(), 'p2', {});
  assert.equal(typeof back.focus, 'function');
});
