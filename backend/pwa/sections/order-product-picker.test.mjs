import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const source = (file) => readFileSync(new URL(file, import.meta.url), 'utf8')
  .replace(/^import [\s\S]*? from '[^']+';\r?\n/gm, '').replace(/^export /gm, '');
const clean = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));
const item = (id) => ({ id, name: 'Тренажёр ' + id, sku: id });

class Element {
  constructor(tag, attrs, ...children) {
    this.tag = tag;
    this.attrs = attrs || {};
    this.value = this.attrs.value ?? '';
    this.inert = false;
    this.isConnected = true;
    this.events = {};
    this.replaceChildren(...children);
  }
  replaceChildren(...children) { this.children = children.flat(Infinity).filter(Boolean); }
  addEventListener(kind, listener) { this.events[kind] = listener; }
  querySelector() { return find(this, (el) => el.tag === 'input'); }
  focus() {}
  scrollIntoView() {}
}

function find(node, predicate) {
  if (!(node instanceof Element)) return;
  if (predicate(node)) return node;
  for (const child of node.children) {
    const match = find(child, predicate);
    if (match) return match;
  }
}

function harness() {
  const requests = [], writes = [], timers = [], updates = [];
  const section = (o) => new Element('section', o, o.body);
  const button = (o) => new Element('button', o, o.label);
  const args = {};
  const route = { section: 'partners', params: { of: 'orders', open: 'line-1' } };
  const sandbox = vm.createContext({
    api(path, { query } = {}) {
      if (path === '/showcase/groups') return Promise.resolve([
        { id: 's1', name: 'Тренажёры' }, { id: 's2', name: 'Спорт' },
        { id: 'g1', parentId: 's1', name: 'Скамьи' }, { id: 'g2', parentId: 's2', name: 'Стойки' },
      ]);
      if (path === '/showcase/similar') return Promise.resolve([]);
      return new Promise((resolve, reject) => requests.push({ path, query: clean(query), resolve, reject }));
    },
    patchVersioned(path, row, body) {
      return new Promise((resolve, reject) => writes.push({ path, row: clean(row), body: clean(body), resolve, reject }));
    },
    session: { canEdit: true }, current: () => route,
    onChange: (fn) => { args.change = fn; return () => { args.change = null; }; },
    h: (...all) => new Element(...all), button, section,
    busyBlock: (name) => new Element('busy', { name }), empty: (o) => new Element('empty', o),
    enhanceSelect() {}, failBlock: (error, retry, options) => new Element('fail', { error, retry, ...options }),
    field: (label, control) => new Element('field', { label }, control, new Element('input')),
    fieldRow: (...children) => new Element('fieldRow', null, children),
    openCard(panel, params, ctx) {
      Object.assign(args, { panel, params, ctx, form: panel.form.build() });
      return { close() { args.form.el.isConnected = false; args.detached = true; } };
    },
    posPic: (p) => new Element('photo', p), row: (o) => new Element('row', o),
    searchBox: (o) => {
      const input = new Element('input');
      args.search = (value) => { input.value = value; o.onSearch(value); };
      return { el: new Element('search', null, input), input, set: (v) => { input.value = v; }, focus() {} };
    },
    select: (o) => new Element('select', o), sideNote: (note) => new Element('note', null, note),
    sku: (val) => new Element('sku', { val }), stack: (...children) => new Element('stack', null, children),
    table: (o) => new Element('table', o), toast: (message) => { args.toast = message; },
    setTimeout: (fn) => timers.push(fn),
  });
  vm.runInContext(source('./order-product-picker.js') + '\nglobalThis.open = openOrderProductPicker;', sandbox);
  const line = { id: 'line-1', version: 6, title: 'Исходное название', qty: 4, orderId: 'order-1' };
  sandbox.open(line, { setRow: (r) => updates.push(r), reload: () => updates.push('reload') }, {});
  const { el } = args.form;
  const get = (tag, key, value) => find(el, (x) => x.tag === tag && x.attrs[key] === value);
  const result = () => get('table', 'label', 'Изделия');
  const show = (index, ids, total = ids.length) => requests[index].resolve({ items: ids.map(item), total,
    facets: { series: [{ value: 'Тест', n: 2 }] } });
  const pick = () => result().attrs.rows[0].onClick();
  const save = () => args.panel.form.create(args.panel.form.toBody(args.form.read().values));
  const filter = (label, val) => get('select', 'label', label).attrs.onChange(val);
  timers.shift()();
  return { args, requests, writes, updates, line, get, result, show, pick, save, filter, route };
}

test('подгружает каталог постранично и отбрасывает старый ответ при смене поиска или фильтра', async () => {
  const h = harness();
  h.args.search('жим');
  assert.deepEqual(h.requests[1].query, { search: 'жим', groupId: '', series: '', page: 1, limit: 20, sort: 'name', facets: 1 });
  h.show(1, ['жим'], 44);
  await tick();
  h.show(0, ['старый']);
  await tick();
  assert.equal(h.result().attrs.rows[0].data, 'жим');
  h.get('button', 'label', 'Показать ещё').attrs.onClick();
  assert.equal(h.requests[2].query.page, 2);
  assert.equal(h.requests[2].query.facets, undefined);
  h.filter('Раздел', 's1');
  assert.equal(h.requests[3].query.groupId, 's1');
  assert.deepEqual(h.get('select', 'label', 'Группа').children.map((x) => x.attrs.value), ['', 'g1']);
  h.show(3, ['в разделе']);
  h.show(2, ['устаревшая вторая страница']);
  await tick();
  assert.equal(h.result().attrs.rows[0].data, 'в разделе');
  h.filter('Группа', 'g1');
  assert.equal(h.requests[4].query.groupId, 'g1');
  h.filter('Серия', 'Тест');
  assert.equal(h.requests[5].query.series, 'Тест');
  h.filter('Раздел', 's2');
  assert.equal(h.requests[6].query.groupId, 's2');
  assert.equal(h.requests[6].query.series, '');
});

test('обновление сохраняет поиск, ошибка даёт повтор, сброс запрашивает весь каталог', async () => {
  const h = harness();
  h.args.search('жим');
  h.show(1, []);
  await tick();
  assert.ok(h.get('empty', 'title', 'Изделия не найдены'));
  const refreshing = h.get('button', 'label', 'Обновить каталог').attrs.onClick();
  assert.equal(h.requests[2].query.search, 'жим');
  h.requests[2].reject(new Error('Ошибка каталога'));
  await refreshing;
  h.get('fail', 'text', 'Не загрузились изделия').attrs.retry();
  assert.equal(h.requests[3].query.page, 1);
  h.show(3, ['выдано']);
  await tick();
  assert.equal(h.result().attrs.rows[0].data, 'выдано');
  h.get('button', 'label', 'Сбросить фильтры').attrs.onClick();
  assert.equal(h.requests[4].query.search, '');
});

test('предварительный выбор и отмена не записывают позицию и оставляют адрес карточки', async () => {
  const h = harness();
  h.show(0, ['пример']);
  await tick();
  assert.equal(h.args.form.read().errors, true);
  h.pick();
  assert.ok(h.get('section', 'title', 'Выбранное изделие'));
  assert.equal(h.args.form.dirty(), false);
  h.args.ctx.close();
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.updates, []);
  assert.equal(h.args.change, null);
  assert.deepEqual(h.route, { section: 'partners', params: { of: 'orders', open: 'line-1' } });
});

test('подтверждение записывает только productId с исходной версией и не отправляет дубль', async () => {
  const h = harness();
  h.show(0, ['пример']);
  await tick();
  h.pick();
  h.line.version = 7;
  const saving = h.save();
  await assert.rejects(h.save(), /уже сохраняется/);
  const [{ path, row, body, resolve }] = h.writes;
  assert.equal(h.writes.length, 1);
  assert.equal(path, '/incomes/line-1');
  assert.deepEqual(row, { id: 'line-1', version: 6 });
  assert.deepEqual(body, { productId: 'пример' });
  const saved = { ...h.line, productId: 'пример' };
  resolve(saved);
  await saving;
  h.args.ctx.close();
  assert.deepEqual(h.updates, [saved]);
});

test('конфликт оставляет видимый выбор без повторной записи и обновляет позицию при выходе', async () => {
  const h = harness();
  h.show(0, ['пример']);
  await tick();
  h.pick();
  const saving = h.save();
  h.writes[0].reject(Object.assign(new Error('Старая версия'), { status: 409 }));
  await assert.rejects(saving, /Позицию заказа уже изменили/);
  assert.ok(h.get('section', 'title', 'Выбранное изделие'));
  assert.equal(h.args.form.conflicted, true);
  assert.equal(h.args.form.read().errors, true);
  await assert.rejects(h.args.panel.form.create({ productId: 'пример' }), /Позицию заказа уже изменили/);
  assert.equal(h.writes.length, 1);
  h.args.ctx.close();
  assert.deepEqual(h.updates, ['reload']);
});

test('каталог из сопоставления сохраняет штатный POST только при отдельном подтверждении', async () => {
  const calls = [];
  let picker;
  const sandbox = vm.createContext({
    session: { role: 'manager' }, button: (o) => o,
    api: async (path, opts) => calls.push(clean({ path, opts })),
    openProductPicker: (line, handler) => { picker = { line, handler }; },
  });
  vm.runInContext(source('./salesorders-matching.js') + '\nglobalThis.build = catalogButton;', sandbox);
  const button = sandbox.build({ lineId: 'line-1', title: 'Исходное название', state: 'auto', productId: 'current' });
  button.onClick({ stopPropagation() {}, currentTarget: {} });
  assert.equal(button.label, 'Выбрать из каталога');
  assert.equal(picker.line.productId, 'current');
  assert.equal(picker.handler.allowCurrent, true);
  assert.deepEqual(calls, []);
  await picker.handler.save('new');
  assert.deepEqual(calls, [{ path: '/matching/confirm', opts: { method: 'POST', body: { lineId: 'line-1', productId: 'new' } } }]);
});
