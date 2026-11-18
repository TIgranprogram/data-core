import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const clean = (v) => JSON.parse(JSON.stringify(v));
class Element {
  constructor(tag, attrs, children) {
    this.tag = tag; this.attrs = attrs || {}; this.value = this.attrs.value || ''; this.children = []; this.listeners = {};
    this.classList = { add() {}, remove() {}, toggle() {} }; this.hidden = !!this.attrs.hidden;
    this.append(...children);
  }
  append(...nodes) { for (const node of nodes.flat(Infinity)) if (node != null && node !== false) { this.children.push(node); if (node instanceof Element) node.parent = this; } }
  replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
  get firstChild() { return this.children[0]; }
  get textContent() { return this.children.map((x) => x.textContent ?? String(x)).join(''); }
  set textContent(v) { this.replaceChildren(String(v)); }
  setAttribute(k, v) { this.attrs[k] = v; }
  focus() { this.focused = true; }
  remove() { this.parent.children = this.parent.children.filter((x) => x !== this); }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  dispatchEvent(e) { return this.listeners[e.type]?.(e); }
  find(fn) { if (fn(this)) return this; for (const n of this.children) if (n instanceof Element) { const found = n.find(fn); if (found) return found; } }
  querySelector(selector) {
    if (selector === '.ms-del button') return this.find((x) => x.attrs.class === 'ms-del')?.find((x) => x.tag === 'button');
    return this.find((x) => (x.attrs.class || '').split(' ').includes(selector.slice(1)));
  }
  click() { return this.attrs.onclick?.({ currentTarget: this }); }
  change() { return this.dispatchEvent({ type: 'change', stopPropagation() {} }); }
}
const h = (tag, attrs, ...children) => new Element(tag, attrs, children);
const dicts = { mats: [{ id: 'steel', name: 'Труба', code: 'STEEL' }, { id: 'wood', name: 'Доска', code: 'WOOD' }, { id: 'paint', name: 'Краска', kind: 'coating' }], sortament: [], parts: [{ id: 'frame', name: 'Каркас' }] };
const row = (passportText = 'Ручной паспорт', techText = 'Ручное техописание') => ({ materialId: 'steel', sizes: ['∅89×3'], partIds: ['frame'], passportText, techText });
const snapshot = () => ({ rows: [row()], coatingIds: ['paint'], coatingTexts: [{ materialId: 'paint', passportText: 'Покрытие А', techText: 'Окраска А' }, { materialId: 'paint', passportText: 'Покрытие Б', techText: 'Окраска Б' }] });

async function fixture({ confirm = true, proposal = snapshot(), copied = snapshot(), response = {} } = {}) {
  const coats = [], calls = [], cache = new Map();
  const context = vm.createContext({ setTimeout: () => 0, clearTimeout() {}, Event: class { constructor(type) { this.type = type; } } });
  const common = {
    h, session: { canEdit: true, role: 'admin' }, normSearch: (s) => String(s || '').trim().toLowerCase(),
    stack: (...children) => h('div', null, ...children),
    button: (opts) => h('button', { onclick: opts.onClick }, opts.label),
    api: async (url, options) => { calls.push({ url, options }); if (url === '/showcase?limit=200') return { items: [{ id: 'other', name: 'Другое изделие' }] }; if (url === '/showcase/other') return { materialsSpec: copied }; return { items: [] }; },
    attachCombo() {}, toast() {}, toastError: (e) => { throw e; }, sideForm: (options) => options,
    confirmDlg: async () => confirm, materialsFromComposition: async () => ({ materialsSpec: proposal, ...response }),
    tagPick: () => {
      let ids = []; const pick = { el: h('div'), setScope() {}, get value() { return JSON.stringify(ids); }, set value(v) { ids = typeof v === 'string' ? JSON.parse(v) : v; } };
      coats.push(pick); return pick;
    },
    catNames: (v) => String(v || ''),
  };
  const actual = new Set(['ui/materials-spec.js', 'sections/tech-sheet.js', 'sections/products/form-fields.js', 'sections/products/materials-proposal.js']);
  async function load(rel) {
    if (cache.has(rel)) return cache.get(rel);
    const code = fs.readFileSync(path.join(root, rel), 'utf8');
    const mod = new vm.SourceTextModule(code, { context, identifier: rel }); cache.set(rel, mod);
    const imports = new Map();
    for (const m of code.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g)) imports.set(m[2], [...new Set([...(imports.get(m[2]) || []), ...m[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0])])]);
    await mod.link(async (ref) => {
      const next = path.posix.normalize(path.posix.join(path.posix.dirname(rel), ref));
      if (actual.has(next)) return load(next);
      const names = imports.get(ref);
      return new vm.SyntheticModule(names, function () { for (const name of names) this.setExport(name, common[name] ?? (() => {})); }, { context });
    });
    return mod;
  }
  const mod = await load('ui/materials-spec.js'); await mod.evaluate();
  const widget = (value) => {
    const w = mod.namespace.materialsSpec({ value, dicts, text: 'Сохранённый текст' });
    // C144: покрытия — select, не tagPick; эмулятор для старых тестов
    const sel = w.el.find((x) => x.attrs['aria-label'] === 'Добавить покрытие');
    const coatApi = {
      el: sel || h('select'),
      get value() {
        const ids = [];
        w.el.find((x) => x.attrs.class === 'ms-coat-picked')?.children.forEach((li) => {
          const btn = li.find?.((n) => n.tag === 'button');
          if (btn) ids.push('paint'); // имена из dicts; для теста достаточно длины через change
        });
        return JSON.stringify([...((w.spec()?.coatingIds) || [])]);
      },
      set value(v) {
        const want = typeof v === 'string' ? JSON.parse(v || '[]') : (v || []);
        const picked = w.el.find((x) => x.attrs.class === 'ms-coat-picked');
        while (picked?.children?.length) {
          const btn = picked.children[0].find?.((n) => n.tag === 'button');
          btn?.click();
        }
        for (const id of want) {
          if (!sel) break;
          sel.value = id;
          sel.change();
        }
      },
      change() { return sel?.change(); },
    };
    coats.push(coatApi);
    return w;
  };
  return { coats, calls, load, widget };
}

test('открытие, изменение размеров и повторное открытие сохраняют снимки без записи', async () => {
  const f = await fixture(); const w = f.widget(snapshot());
  assert.deepEqual(clean(w.spec()), snapshot());
  const size = w.el.find((x) => x.attrs['aria-label'] === 'Размеры'); size.value = '100×4'; await size.change();
  const next = clean(w.spec()); assert.equal(next.rows[0].techText, 'Ручное техописание'); assert.deepEqual(next.rows[0].sizes, ['∅89×3', '100×4']);
  w.set(w.value); assert.deepEqual(clean(w.spec()), next);
  assert.match(w.el.textContent, /Тексты взяты из состава/);
  assert.equal(f.calls.length, 0);
});

test('смена материала очищает обе фразы, повторный выбор того же сохраняет', async () => {
  const f = await fixture(); const w = f.widget(snapshot());
  const input = w.el.find((x) => x.attrs['aria-label'] === 'Материал, строка 1');
  input.value = 'Труба'; await input.change(); assert.equal(w.spec().rows[0].passportText, 'Ручной паспорт');
  input.value = 'Доска'; await input.change();
  assert.equal(w.spec().rows[0].materialId, 'wood'); assert.equal(w.spec().rows[0].passportText, undefined); assert.equal(w.spec().rows[0].techText, undefined);
});

test('удалённое покрытие теряет тексты; повторное добавление не возвращает старые фразы', async () => {
  const f = await fixture(); const w = f.widget(snapshot());
  f.coats[0].value = []; assert.equal(w.spec().coatingTexts, undefined);
  f.coats[0].value = ['paint']; assert.equal(w.spec().coatingTexts, undefined);
});

test('копирование не теряет другую фразу той же части/материала и варианты покрытия', async () => {
  const copied = snapshot(); copied.rows = [row('Другая фраза', 'Другая техфраза')]; copied.coatingTexts = [{ materialId: 'paint', techText: 'Окраска В' }];
  const f = await fixture({ copied }); const w = f.widget(snapshot());
  await w.el.find((x) => x.tag === 'button' && x.textContent === 'Скопировать таблицу из изделия').click();
  const input = w.el.find((x) => x.attrs['aria-label'] === 'Изделие, из которого копировать'); input.value = 'Другое изделие'; await input.change();
  assert.deepEqual(clean(w.spec().rows.map((r) => r.techText)), ['Ручное техописание', 'Другая техфраза']); assert.equal(w.spec().coatingTexts.length, 3);
  input.value = 'Другое изделие'; await input.change(); assert.equal(w.spec().rows.length, 2); assert.equal(w.spec().coatingTexts.length, 3);
  assert.ok(f.calls.every((c) => !c.options?.method));
});

test('Из состава: отмена не меняет черновик, принятие добавляет новые строки и сохраняет ручные', async () => {
  for (const confirm of [false, true]) {
    const proposal = snapshot(); proposal.rows = [row('Новый паспорт', 'Новое техописание')]; proposal.coatingTexts = [{ materialId: 'paint', techText: 'Новое покрытие' }];
    const f = await fixture({ confirm, proposal }); const w = f.widget(snapshot());
    const mod = await f.load('sections/products/form-fields.js'); await mod.evaluate();
    await mod.namespace.fromComposition({ id: 'product' }).run(w);
    assert.equal(w.spec().rows[0].techText, 'Ручное техописание');
    assert.equal(w.spec().rows.length, confirm ? 2 : 1);
    if (confirm) assert.equal(w.spec().rows[1].techText, 'Новое техописание');
    assert.equal(w.spec().coatingTexts.length, 2);
    await mod.namespace.fromComposition({ id: 'product' }).run(w);
    assert.equal(w.spec().rows.length, confirm ? 2 : 1);
    assert.equal(f.calls.length, 0);
  }
});

test('источник строки проходит read/set/copy без общей ссылки и не требует словарного partIds', async () => {
  const sp = snapshot();
  sp.rows[0].partIds = [];
  sp.rows[0].sourceRefs = [{ kind: 'part', refId: 'part-1', name: 'Опора', code: 'ОП.01', path: [{ kind: 'module', refId: 'module-1', name: 'Рама', code: 'Р.01', lineId: 'line-1' }] }];
  const f = await fixture({ copied: sp });
  const w = f.widget(sp);
  assert.deepEqual(clean(w.spec()), sp);
  sp.rows[0].sourceRefs[0].name = 'Изменено снаружи';
  assert.equal(w.spec().rows[0].sourceRefs[0].name, 'Опора');
  assert.match(w.el.textContent, /Из состава: Рама · Р.01/);
  w.set(w.value);
  assert.equal(w.spec().rows[0].sourceRefs[0].name, 'Опора');
  assert.match(w.el.textContent, /необязательно/);
});

test('техописание печатает ручную фразу целиком; без неё остаются размер и допуск', async () => {
  const f = await fixture(); const mod = await f.load('sections/tech-sheet.js'); await mod.evaluate();
  const sp = snapshot(); sp.rows.push(row('', ''));
  const out = clean(mod.namespace.specRows(sp, dicts));
  assert.equal(out[0].text, 'Ручное техописание'); assert.doesNotMatch(out[0].text, /89|толщина/);
  assert.match(out[1].text, /Труба ∅89×3, толщина/);
  assert.deepEqual(out[2], { name: 'Покрытие', text: 'Окраска А, Окраска Б' });
  assert.equal(mod.namespace.specRows({ rows: [], coatingIds: ['paint'] }, dicts)[0].text, 'Краска');
  assert.equal(mod.namespace.specRows({ rows: [], coatingIds: [], coatingTexts: sp.coatingTexts }, dicts).length, 0);
});


test('предложение только покрытия принимается в пустую таблицу вместе с ручными вариантами', async () => {
  const proposal = snapshot(); proposal.rows = [];
  const f = await fixture({ proposal }); const w = f.widget(null);
  const mod = await f.load('sections/products/form-fields.js'); await mod.evaluate();
  await mod.namespace.fromComposition({ id: 'product' }).run(w);
  assert.deepEqual(clean(w.spec()), proposal);
  assert.equal(f.calls.length, 0);
});

test('фокус на удалении покрытия не пересоздаёт кнопку до щелчка', async () => {
  const f = await fixture();
  const w = f.widget(snapshot());
  const findRemove = () => w.el.find((x) => x.attrs['aria-label'] === 'Убрать покрытие');
  const before = findRemove();
  assert.ok(before);
  await w.el.dispatchEvent({ type: 'focusin' });
  assert.equal(findRemove(), before);
  before.click();
  assert.deepEqual(clean(w.spec().coatingIds), []);
  assert.deepEqual(clean(w.spec().coatingTexts || []), []);
});


test('техописание использует имя физического источника без обязательной словарной роли', async () => {
  const f = await fixture(); const mod = await f.load('sections/tech-sheet.js'); await mod.evaluate();
  const rows = [{ ...row('', ''), partIds: [], sourceRefs: [{ name: 'Опора', code: 'ОП.01' }] }, row('', '')];
  const out = clean(mod.namespace.specRows({ rows }, dicts));
  assert.equal(out[0].name, 'Опора · ОП.01');
  assert.equal(out[1].name, 'Каркас');
});


test('материал по названию требует явного принятия и в пустой таблице', async () => {
  const f = await fixture({ confirm: false, response: { hintedSources: [{ name: 'Опора', sourceRefs: [] }] } });
  const w = f.widget(null);
  const mod = await f.load('sections/products/form-fields.js'); await mod.evaluate();
  await mod.namespace.fromComposition({ id: 'product' }).run(w);
  assert.equal(w.spec(), null);
});

test('конфликт показывает было и предложено, кнопка ведёт к сохранённой строке', async () => {
  const f = await fixture(); const w = f.widget(snapshot());
  w.showProposal({ reports: [{ rowIndex: 0, changes: [{ field: 'materialId', before: 'steel', after: 'wood' }] }] });
  assert.match(w.el.textContent, /«Труба» → «Доска»/);
  await w.el.find((n) => n.tag === 'button' && n.textContent === 'Править строку 1').click();
  assert.equal(w.el.find((n) => n.attrs['aria-label'] === 'Материал, строка 1').focused, true);
  assert.equal(w.spec().rows[0].materialId, 'steel');
});

test('неизвестный источник не исчезает из значения и требует материал до сохранения', async () => {
  const f = await fixture(); const w = f.widget(null);
  w.showProposal({ unmatched: [{ name: 'Стойка', sourceRefs: [{ kind: 'part', refId: 'part-1', name: 'Стойка', path: [] }] }] });
  await w.el.find((n) => n.tag === 'button' && n.textContent === 'Указать материал').click();
  assert.equal(w.spec().rows[0].sourceRefs[0].refId, 'part-1');
  assert.equal(JSON.parse(w.value).rows.length, 1);
  assert.throws(() => w.validate(), /Строка 2: выберите материал/);
  assert.match(w.el.textContent, /Строка 2: выберите материал/);
  const filled = w.spec(); filled.rows[0].materialId = 'steel'; w.set(filled);
  assert.equal(w.validate(), true);
  assert.equal(JSON.parse(w.value).rows[0].sourceRefs[0].refId, 'part-1');
});

test('101 неизвестный источник создаёт сохраняемые группы 100+1 без потери и дублей', async () => {
  const f = await fixture(); const w = f.widget(null);
  const sourceRefs = Array.from({ length: 101 }, (_, i) => ({ kind: 'part', refId: 'part-' + i, name: 'Стойка', path: [] }));
  w.showProposal({ unmatched: [{ name: 'Стойки', sourceRefs }] });
  const add = w.el.find((n) => n.tag === 'button' && n.textContent === 'Указать материал');
  await add.click(); await add.click();
  assert.deepEqual(clean(w.spec().rows.map((r) => r.sourceRefs.length)), [100, 1]);
  const filled = w.spec(); filled.rows.forEach((r) => { r.materialId = 'steel'; }); w.set(filled);
  assert.equal(w.validate(), true);
  assert.equal(w.spec().rows.flatMap((r) => r.sourceRefs).length, 101);
});
