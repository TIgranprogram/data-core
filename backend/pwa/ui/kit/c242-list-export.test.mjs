import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { listQuery, viewStore } from './list-view.js';

const source = readFileSync(new URL('../list-export.js', import.meta.url), 'utf8').replace(/^import .*\r?\n/gm, '').replace('export async function exportList', 'async function exportList');
function fixture({ total = 10123, change, onPage } = {}) {
  const calls = [], files = [], messages = [], controls = [], columns = [{ key: 'id', label: 'ID' }, { key: 'n', label: 'Количество', cls: 'num right' }];
  const box = { disabled: false, textContent: 'Ещё ▾', classList: { add() {}, remove() {} }, after() {} };
  const context = vm.createContext({ Node: class {}, setTimeout, console, button: options => { const control = { ...options, remove() {} }; controls.push(control); return control; },
    api: async (path, options) => {
      calls.push({ path, query: { ...options.query } }); const page = options.query.page, start = (page - 1) * 500;
      onPage?.({ page, controls, columns });
      return change?.(page) || { items: Array.from({ length: Math.min(500, Math.max(0, total - start)) }, (_, index) => ({ id: 'id-' + (start + index), n: start + index })), total, page, limit: 500 };
    },
    downloadXlsx: (name, rows, title) => files.push({ name, rows, title }), toast: message => messages.push(message), toastError: error => messages.push(error.message),
  });
  const run = vm.runInContext(source + '\nexportList;', context);
  return { calls, files, messages, controls, columns, box, run: (options = {}) => run({ title: 'Склад', path: '/stock/items', query: { zoneId: 'pipe', availability: 'none' }, sort: 'sectionSize', columns, maxRows: Infinity, ...options }, box) };
}

for (const total of [10001, 10123]) test('полный экспорт ' + total + ': все ID/порядок, последняя неполная страница и один snapshot', async () => {
  const f = fixture({ total, onPage({ page, columns }) { if (page === 2) columns[0].label = 'Изменено после старта'; } });
  await f.run();
  assert.equal(f.files.length, 1); const rows = f.files[0].rows;
  assert.equal(rows.length, total + 1); assert.equal(rows[0][0], 'ID');
  for (let index = 0; index < total; index++) assert.equal(rows[index + 1][0], 'id-' + index);
  assert.ok(f.calls.every(call => call.query.zoneId === 'pipe' && call.query.availability === 'none' && call.query.sort === 'sectionSize'));
  assert.equal(f.calls.length, Math.ceil(total / 500)); assert.equal(f.box.textContent, 'Ещё ▾'); assert.equal(f.box.disabled, false);
});

for (const kind of ['empty', 'short', 'duplicate', 'total-change', 'bad-page', 'too-large']) test('нет частичного XLSX при ' + kind, async () => {
  const f = fixture({ total: 600, change(page) {
    if (kind === 'short' && page === 1) return { items: Array.from({ length: 499 }, (_, i) => ({ id: String(i) })), total: 600, page, limit: 500 };
    if (kind === 'too-large') return { items: [], total: 1048576, page, limit: 500 };
    if (page === 2) return { items: kind === 'duplicate' ? [{ id: 'id-0' }] : [], total: kind === 'total-change' ? 599 : 600, page: kind === 'bad-page' ? 1 : page, limit: 500 };
  } });
  await f.run(); assert.equal(f.files.length, 0); assert.ok(f.messages.some(value => /остановлен|изменился|предел строк/.test(value)));
});

test('отмена во время второй GET страницы: ноль загрузок файла', async () => {
  const f = fixture({ onPage({ page, controls }) { if (page === 2) controls[0].onClick(); } });
  await f.run(); assert.equal(f.files.length, 0); assert.equal(f.calls.length, 2); assert.ok(f.messages.includes('Экспорт отменён. Файл не создан.'));
});

test('старый список без exportLimit сохраняет 10000 и явное предупреждение', async () => {
  const f = fixture({ total: 10123 }); await f.run({ maxRows: undefined });
  assert.equal(f.files[0].rows.length, 10001); assert.ok(f.messages.some(value => value.includes('первые 10 000')));
});

test('listQuery фиксирует params/filters, старые board исключения и sortFor совместимы', async () => {
  const L = { path: '/production-orders', query: async params => ({ zoneId: params.zone, filter: 'active' }), sortDefault: 'name', sortFor: params => params.zone === 'pipe' ? 'sectionSize' : 'sheetSize' };
  const original = { q: '80×60×3', zone: 'pipe', status: 'paid' }, filters = [{ key: 'status' }, { key: 'availability' }];
  assert.deepEqual(await listQuery(L, original, filters, true), { search: '80×60×3', zoneId: 'pipe' });
  assert.deepEqual(await listQuery(L, { ...original, availability: 'none' }, filters), { search: '80×60×3', zoneId: 'pipe', filter: 'active', status: 'paid', availability: 'none' });
  const oldStorage = globalThis.localStorage; globalThis.localStorage = { getItem() { return ''; } };
  try {
    assert.equal(viewStore(L, () => original).st().sort, 'sectionSize');
    assert.equal(viewStore(L, () => ({ ...original, sort: '-name' })).st().sort, '-name');
    assert.equal(viewStore({ sortDefault: 'name' }, () => ({})).st().sort, 'name');
  } finally { globalThis.localStorage = oldStorage; }
});
