import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

async function fixture({ ids = ['first'], can = true, bindFail = false, postFail = false, pending } = {}) {
  let opened; let paused = false; let refreshed = 0;
  const requests = [];
  const node = (...children) => ({ children, append(...xs) { this.children.push(...xs); }, replaceChildren(...xs) { this.children = xs; refreshed++; }, closest() {}, contains() { return false; } });
  const kit = Object.fromEntries(['actions', 'button', 'enhanceSelect', 'field', 'fieldRow', 'hint', 'row', 'segmented', 'select', 'sideNote', 'textInput', 'toast'].map((name) => [name, node]));
  kit.toastError = node;
  Object.assign(kit, { stack: node, link: (options) => options, buildForm: () => ({ el: { addEventListener() {} } }) });
  const ctx = {
    code: 'BLG', prod: { id: 'product', passportDefaults: { elements: ids, warrantyMonths: 18 } },
    elRows: [], elNames: new Map(), els: { setRows() {}, setIds() {} },
    pause: () => { paused = true; return () => { paused = false; }; },
    waitForSaves: async () => { await pending; },
    refreshStatus: async () => {},
  };
  const noop = () => {};
  const deps = {
    '../../../ui/kit/card.js': { openCard: (section, options, callbacks) => { opened = { section, options, callbacks }; } },
    '../../../core/api.js': { api: async (path, options) => {
      requests.push({ path, ...options });
      if (postFail) { postFail = false; throw new Error('POST failed'); }
      return { id: 'new', kind: 'product', categories: 'BLG', ...options.body };
    } },
    '../../../ui/kit/index.js': kit,
    '../common.js': { V2_NUMS: [], canEdit: () => can },
    '../funnel/api.js': { patchProduct: noop, setFacets: noop, putDefaults: async (prod, patch) => {
      requests.push({ path: 'defaults', body: patch });
      if (bindFail) { bindFail = false; throw new Error('PUT failed'); }
      prod.passportDefaults = { ...prod.passportDefaults, ...patch };
    } },
    '../traits.js': { jointsPick: noop }, './model.js': { num: Number },
  };
  const context = createContext({ document: { activeElement: null } });
  const mod = new SourceTextModule(readFileSync(new URL('./control.js', import.meta.url), 'utf8'), { context });
  await mod.link((key) => { const values = deps[key]; return new SyntheticModule(Object.keys(values), function () { for (const [k, v] of Object.entries(values)) this.setExport(k, v); }, { context }); });
  await mod.evaluate();
  const tree = mod.namespace.elementsEditor(ctx);
  const find = (n) => n?.onClick ? n : n?.children?.map(find).find(Boolean);
  find(tree)?.onClick();
  return { ctx, requests, opened, get paused() { return paused; }, get refreshed() { return refreshed; } };
}

test('сохраняет две строки и ждёт предыдущую запись выбора перед привязкой', async () => {
  const pending = Promise.withResolvers();
  const f = await fixture({ pending: pending.promise });
  assert.equal(f.paused, true);
  const result = f.opened.section.form.create({ name: 'Указатель', usageRules: 'Первая строка\nВторая строка' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.requests.length, 1);
  f.ctx.prod.passportDefaults.elements = ['first', 'second'];
  pending.resolve(); await result;
  assert.deepEqual([...f.ctx.prod.passportDefaults.elements], ['first', 'second', 'new']);
  assert.equal(f.requests[0].body.usageRules, 'Первая строка\nВторая строка');
  assert.equal(f.ctx.prod.passportDefaults.warrantyMonths, 18);
  f.opened.callbacks.close(); assert.equal(f.paused, false);
});

test('ошибка привязки сохраняет id: повтор обновляет элемент, не создаёт дубль', async () => {
  const f = await fixture({ bindFail: true });
  await assert.rejects(f.opened.section.form.create({ name: 'Указатель' }), /PUT failed/);
  assert.equal(f.paused, true);
  await f.opened.section.form.create({ name: 'Указатель', usageRules: 'Дополнено' });
  assert.equal(f.requests.filter((r) => r.method === 'POST').length, 1);
  assert.equal(f.requests.filter((r) => r.method === 'PATCH').length, 1);
  assert.deepEqual([...f.ctx.prod.passportDefaults.elements], ['first', 'new']);
});

test('ошибка создания допускает повтор, отмена не меняет исходный выбор', async () => {
  const f = await fixture({ postFail: true });
  await assert.rejects(f.opened.section.form.create({ name: 'Указатель' }), /POST failed/);
  f.opened.callbacks.close();
  assert.equal(f.paused, false); assert.equal(f.refreshed, 0);
  assert.deepEqual([...f.ctx.prod.passportDefaults.elements], ['first']);
});

test('три выбранных элемента сохраняются; четвёртый только в справочнике', async () => {
  const f = await fixture({ ids: ['one', 'two', 'three'] });
  await f.opened.section.form.create({ name: 'Четвёртый' });
  assert.equal(f.requests.some((r) => r.path === 'defaults'), false);
  assert.deepEqual([...f.ctx.prod.passportDefaults.elements], ['one', 'two', 'three']);
  assert.equal(f.ctx.elRows[0].id, 'new');
});

test('без права редактировать общие тексты нет перехода к созданию', async () => {
  const f = await fixture({ can: false }); assert.equal(f.opened, undefined);
});


test('чужая категория или компонент сохраняются в справочнике без привязки к паспорту', async () => {
  for (const body of [{ categories: 'TRN' }, { kind: 'part' }]) {
    const f = await fixture();
    await f.opened.section.form.create({ name: 'Другой элемент', ...body });
    assert.equal(f.requests.some((r) => r.path === 'defaults'), false);
    assert.deepEqual([...f.ctx.prod.passportDefaults.elements], ['first']);
    assert.equal(f.ctx.elRows[0].id, 'new');
  }
});

async function editors(prod = {}) {
  const requests = []; const fields = []; const notices = [];
  const node = (...children) => ({ children });
  const kit = Object.fromEntries(['buildForm', 'enhanceSelect', 'field', 'fieldRow', 'link', 'row', 'segmented', 'select', 'sideNote', 'stack', 'hint'].map((key) => [key, node]));
  kit.button = (opts) => opts;
  kit.toast = (message) => notices.push(message);
  kit.toastError = node;
  kit.textInput = (opts) => {
    const handlers = {}; const field = { value: opts.value, el: node(), input: { addEventListener: (event, fn) => { handlers[event] = fn; } }, change: () => handlers.change() };
    fields.push(field); return field;
  };
  const context = createContext({});
  const deps = {
    '../../../ui/kit/card.js': { openCard() {} }, '../../../core/api.js': { api() {} },
    '../../../ui/kit/index.js': kit, '../common.js': { V2_NUMS: [], canEdit() {} },
    '../funnel/api.js': { setFacets() {}, patchProduct: async (id, body) => requests.push(body), putDefaults: async (prod, body) => { requests.push(body); Object.assign(prod.passportDefaults, body); } },
    '../traits.js': { jointsPick() {} }, './model.js': { num: (v) => String(v ?? '').trim() && Number.isFinite(Number(v)) ? Number(v) : null },
  };
  const mod = new SourceTextModule(readFileSync(new URL('./control.js', import.meta.url), 'utf8'), { context });
  await mod.link((key) => new SyntheticModule(Object.keys(deps[key]), function () { for (const [k, v] of Object.entries(deps[key])) this.setExport(k, v); }, { context }));
  await mod.evaluate();
  const saves = [];
  const ctx = { prod: { id: 'p', passportDefaults: {}, ...prod }, can: true, pending: new Map(), save: (job) => { const task = job(); saves.push(task); return task; } };
  return { ctx, requests, fields, notices, mod: mod.namespace, wait: () => Promise.all(saves) };
}

test('значение по умолчанию не записывается до явного принятия', async () => {
  const f = await editors();
  const tree = f.mod.numEditor(f.ctx, 'warrantyMonths', 'Гарантия', 24);
  assert.equal(f.requests.length, 0);
  assert.equal(f.fields[0].value, 24);
  await tree.children[1].onClick();
  assert.equal(f.ctx.prod.passportDefaults.warrantyMonths, 24);
  assert.equal(f.ctx.pending.size, 0);
});

test('частичные размеры сохраняются, очистка не уничтожает соседние значения', async () => {
  const f = await editors({ dimensions: { length: 100, width: 200, unit: 'мм' } });
  f.mod.dimsEditor(f.ctx);
  f.fields[0].value = ''; f.fields[0].change(); await f.wait();
  assert.equal(f.requests[0].dimensions.length, null);
  assert.equal(f.requests[0].dimensions.width, 200);
  assert.equal(f.requests[0].dimensions.height, null);
});

test('габариты в сантиметрах переводятся без потери перед правкой', async () => {
  const f = await editors({ dimensions: { length: 10, width: 20, unit: 'см' } });
  f.mod.dimsEditor(f.ctx);
  assert.equal(f.fields[0].value, 100);
  f.fields[2].value = 300; f.fields[2].change(); await f.wait();
  assert.equal(f.requests[0].dimensions.width, 200);
  assert.equal(f.requests[0].dimensions.unit, 'мм');
});

test('очистка веса отправляется, ошибочное число показывает сообщение', async () => {
  const f = await editors({ weightKg: 12 });
  f.mod.weightEditor(f.ctx);
  f.fields[0].value = ''; f.fields[0].change(); await f.wait();
  assert.equal(f.requests[0].weightKg, null);
  f.fields[0].value = -1; f.fields[0].change();
  assert.equal(f.requests.length, 1);
  assert.equal(f.notices.length, 1);
});
