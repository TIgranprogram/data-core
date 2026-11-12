import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const clean = (v) => JSON.parse(JSON.stringify(v));
const original = { materialId: 'steel', sizes: ['∅89×3'], isCoating: false, passportText: 'Для паспорта', techText: 'Для техописания' };
async function fixture({ fail = false, history = [] } = {}) {
  const calls = [], rendered = [], cache = new Map();
  const target = { tag: 'span', text: 'Заказ № 42', toString: () => '[object HTMLSpanElement]' };
  const h = (tag, attrs, ...children) => ({ tag, children, append(...nodes) { this.children.push(...nodes); }, replaceChildren(...nodes) { this.children = nodes; }, querySelector() { return null; }, addEventListener() {} });
  let current = { ...original };
  const context = vm.createContext({});
  const common = {
    h, stack: (...children) => h('div', null, ...children), section: ({ body }) => h('details', null, body), row: (options) => { rendered.push(options); return h('div'); }, targetNote: () => target, session: {}, lookups: { reset() {} },
    loadMaterialDicts: async () => ({ mats: [{ id: 'steel', name: 'Труба' }] }),
    normSize: (v) => v, splitSizes: (v) => String(v).split(';'),
    errText: (e) => e.message,
    api: async (url, options) => {
      calls.push({ url, options });
      if (url === '/stock/items/item/history') return { items: history, total: history.length };
      if (url === '/dicts/passportMaterials') return { items: [] };
      if (url === '/materials/item') return { passportSpec: current };
      if (url === '/materials/item/passport-spec') { if (fail) { fail = false; throw new Error('Нет связи'); } current = { ...options.body }; return current; }
      if (url === '/stock/items/item') return { id: 'item', photos: [] };
      throw new Error('Неожиданный запрос: ' + url);
    },
  };
  async function load(rel) {
    if (cache.has(rel)) return cache.get(rel);
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    const mod = new vm.SourceTextModule(code, { context, identifier: rel }); cache.set(rel, mod);
    const imports = new Map();
    for (const m of code.matchAll(/(?:import|export)\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) imports.set(m[2], [...new Set([...(imports.get(m[2]) || []), ...m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0])])]);
    await mod.link((ref) => {
      if (ref === './stock-passport.js') return load('sections/stock-passport.js');
      const names = imports.get(ref);
      return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, common[name] ?? (() => {})); }, { context });
    });
    return mod;
  }
  const mod = await load('sections/stock-passport.js'); await mod.evaluate();
  const field = await mod.namespace.passportSpecField({ id: 'item' });
  return { calls, rendered, target, load, field, save: mod.namespace.savePassportSpec };
}

test('widget JSON.read объект и legacy строка одинаково сравниваются с исходными значениями', async () => {
  const f = await fixture();
  const object = JSON.parse(f.field.widget().value);
  await f.save('item', object);
  await f.save('item', JSON.stringify({ techText: original.techText, ...object }));
  assert.equal(f.calls.filter((r) => r.options?.method).length, 0);
  object.passportText = 'Новый текст'; await f.save('item', object);
  const writes = f.calls.filter((r) => r.options?.method);
  assert.equal(writes.length, 1); assert.equal(writes[0].url, '/materials/item/passport-spec');
  assert.deepEqual(clean(writes[0].options.body), { ...original, passportText: 'Новый текст' });
  await f.save('item', JSON.stringify(object)); assert.equal(f.calls.filter((r) => r.options?.method).length, 1);
});

test('снятие связи очищает материал и тексты, размеры без материала не передаются', async () => {
  const f = await fixture();
  await f.save('item', { materialId: '', sizes: ['100'], isCoating: true, passportText: ' ', techText: '' });
  assert.deepEqual(clean(f.calls.at(-1).options.body), { materialId: null, passportText: null, techText: null });
});

test('ошибка PATCH пробрасывается, повтор не пропускается сравнением с originals', async () => {
  const f = await fixture({ fail: true }); const edited = { ...original, techText: 'Новая фраза' };
  await assert.rejects(f.save('item', edited), /Нет связи/);
  await f.save('item', JSON.stringify(edited));
  assert.equal(f.calls.filter((r) => r.options?.method).length, 2);
});

test('stock.update отвергает частичное сохранение и позволяет повторить тот же ввод', async () => {
  const f = await fixture({ fail: true }); const mod = await f.load('sections/stock.js'); await mod.evaluate();
  const edited = { name: 'Позиция', passportSpec: { ...original, techText: 'Новая фраза' } };
  await assert.rejects(mod.namespace.stock.form.update('item', edited), /Основные данные сохранены.*Для паспорта.*Повторите сохранение/);
  const result = await mod.namespace.stock.form.update('item', edited); assert.equal(result.id, 'item');
  const writes = f.calls.filter((r) => r.url.endsWith('/passport-spec'));
  assert.equal(writes.length, 2); assert.equal(writes[1].options.body.techText, 'Новая фраза');
});


test('история склада передаёт назначение DOM-узлом и сохраняет примечание', async () => {
  const f = await fixture({ history: [{ type: 'out', qty: 2, date: '2026-11-12', note: 'Для сборки' }] });
  const mod = await f.load('sections/stock.js'); await mod.evaluate();
  mod.namespace.stock.card.extra({ id: 'item' });
  await new Promise((resolve) => setImmediate(resolve));
  const movement = f.rendered.find((r) => r.title === 'Списание');
  assert.ok(movement);
  assert.equal(movement.below.tag, 'span');
  assert.equal(movement.below.children[0], f.target);
  assert.equal(movement.below.children[1], ' · ');
  assert.equal(movement.below.children[2], 'Для сборки');
});
