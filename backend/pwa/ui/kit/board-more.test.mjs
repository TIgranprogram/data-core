import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { viewStore } from './list-view.js';

const source = readFileSync(new URL('./board.js', import.meta.url), 'utf8');
const paintSource = source.slice(source.indexOf('  function paint('), source.indexOf('  let loadedAt ='));

function fixture({ params = {}, saved = '', section = 'requests', column = {}, total = 104 } = {}) {
  let route = { page: '4', status: 'requested', q: 'крепёж', ft: 'supplier:abc', companyId: 'company-1', ...params };
  const patches = [], fetches = [], nodes = [];
  const memory = new Map(saved ? [['dc-view-' + section, saved]] : []);
  const localStorage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = localStorage;
  const mode = viewStore({ viewKey: section, board: { default: true } }, () => route);
  const isBoard = () => { const previous = globalThis.localStorage; globalThis.localStorage = localStorage; try { return mode.st().board; } finally { globalThis.localStorage = previous; } };
  globalThis.localStorage = originalStorage;
  const body = { replaceChildren: (...items) => nodes.splice(0, nodes.length, ...items), append: (...items) => nodes.push(...items) };
  const col = { c: { query: { status: 'paid' }, ...column }, body, shown: 0, rows: [], page: 1 };
  const context = vm.createContext({
    board: {}, session: { canEdit: false }, per: 30, qty: String,
    h: () => ({}), cardEl: row => ({ row }),
    link: options => ({ options, remove() { const index = nodes.indexOf(this); if (index >= 0) nodes.splice(index, 1); } }),
    patch: changes => { patches.push(changes); route = { ...route, ...changes }; for (const key of Object.keys(route)) if (route[key] === undefined) delete route[key]; },
    fetchCol: async (query, page, sequence) => { fetches.push({ query, page, sequence }); return { items: [{ id: 'second' }], total }; },
    toastError: error => { throw error; },
  });
  const paint = vm.runInContext(paintSource + '\npaint;', context);
  paint(col, { items: [{ id: 'first' }], total }, false, 17);
  return { col, patches, fetches, isBoard, route: () => route, saved: () => memory.get('dc-view-' + section) };
}

test('ссылка из default, сохранённой и явной доски открывает таблицу нужного статуса', () => {
  for (const options of [{}, { saved: 'board' }, { params: { view: 'board' }, saved: 'table' }]) {
    const box = fixture(options);
    assert.equal(box.isBoard(), true);
    assert.equal(box.col.more.options.label, 'ещё 103 — списком →');
    box.col.more.options.onClick();
    assert.equal(box.isBoard(), false);
    assert.deepEqual(box.route(), { view: 'table', status: 'paid', q: 'крепёж', ft: 'supplier:abc', companyId: 'company-1' });
    assert.equal(box.saved(), options.saved || undefined);
  }
});

test('другая общая доска использует тот же явный список и сохраняет фильтры', () => {
  const box = fixture({ section: 'work', params: { view: 'board', personId: 'person-1' }, column: { query: { status: 'done' } } });
  box.col.more.options.onClick();
  assert.equal(box.isBoard(), false);
  assert.equal(box.route().status, 'done');
  assert.equal(box.route().personId, 'person-1');
  assert.equal(box.route().ft, 'supplier:abc');
  assert.equal(box.route().q, 'крепёж');
  assert.equal(box.route().page, undefined);
});

test('колонка без собственного status не снимает текущий фильтр статуса', () => {
  const box = fixture({ column: { query: { stage: 'shipped' } } });
  box.col.more.options.onClick();
  assert.equal(box.route().view, 'table');
  assert.equal(box.route().status, 'requested');
});

test('portion дозагружает вторую страницу в колонку, не меняя адрес и режим', async () => {
  const box = fixture({ column: { portion: true, per: 1 }, total: 2 });
  assert.equal(box.col.more.options.label, 'ещё 1 из 1 →');
  await box.col.more.options.onClick({ currentTarget: { disabled: false } });
  assert.equal(box.patches.length, 0);
  assert.equal(box.isBoard(), true);
  assert.equal(box.col.page, 2);
  assert.equal(box.col.rows.map(row => row.id).join(','), 'first,second');
  assert.equal(box.fetches[0].page, 2);
  assert.equal(box.fetches[0].sequence, 17);
  assert.equal(box.col.more, null);
});

test('группировка полученных и отменённых заявок сохраняется, для оплаченных не добавляется', () => {
  const requests = readFileSync(new URL('../../sections/requests.js', import.meta.url), 'utf8');
  const expression = requests.match(/^    periods: (.+),$/m)[1];
  const periods = vm.runInNewContext('(' + expression + ')', { session: { canMoney: false } });
  assert.equal(typeof periods({ status: 'received' }).date, 'function');
  assert.equal(typeof periods({ status: 'cancelled' }).date, 'function');
  assert.equal(periods({ status: 'paid' }), null);
});
