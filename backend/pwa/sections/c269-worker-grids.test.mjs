import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';
import { workerPipeBlocks, workerSheetBlocks, workerCountBody } from './stock-worker-model.js';

const pipe = (id, extra = {}) => ({ id, materialId: id, name: 'Труба ' + id, metal: 'pipe', materialGrade: 'Ст3', unit: 'м', countMode: 'single', quantity: 12, reservedQty: 1, washed: true,
  sectionProfile: { shape: 'rect', state: 'complete', label: '40×20×2', widthMm: 40, heightMm: 20, wallMm: 2 }, dims: { length: 6000 }, ...extra });
const sourceRows = [pipe('six'), pipe('twelve', { washed: false, dims: { length: 12000 } }), pipe('nonstandard', { dims: { length: 7500 } }), pipe('duplicate'),
  pipe('unknown', { washed: null, dims: {}, sectionProfile: { shape: 'unknown', state: 'unknown', label: 'Разобрать' }, quantity: 0 }),
  pipe('pieces', { unit: 'шт' }), pipe('offcut', { offcutOf: 'six', dims: { length: 1500 } }), pipe('multiple', { countMode: 'multiple' })];
test('матрица хранит все ID без суммы/перезаписи, фактические и неизвестные длины/мойку, отдельные unit и обрезки', () => {
  const blocks = workerPipeBlocks(sourceRows);
  assert.deepEqual(blocks.flatMap(b => b.rows.flatMap(row => [...row.cells.values()].map(item => item.materialId))).sort(), sourceRows.map(item => item.materialId).sort());
  assert.ok(blocks.some(b => b.unit === 'шт'));
  assert.ok(blocks.flatMap(b => b.columns).some(c => c.length === 7500));
  assert.ok(blocks.flatMap(b => b.columns).some(c => c.length === null && c.washed === null));
  assert.ok(blocks.flatMap(b => b.rows).some(row => row.collision));
  assert.equal(blocks.flatMap(b => b.rows.flatMap(row => [...row.cells.values()])).find(item => item.materialId === 'offcut').quantity, 12);
});
test('сохранение3м остаётся3м; single и точный materialId/expected обязательны', () => {
  assert.deepEqual(workerCountBody(pipe('id'), '3', 'Трубы').lines, [{ materialId: 'id', qty: 3, expected: 12 }]);
  assert.equal(workerCountBody(pipe('id'), '3,5', 'Трубы').lines[0].qty, 3.5);
  for (const mode of ['multiple', 'unknown', undefined]) assert.throws(() => workerCountBody(pipe('id', { countMode: mode }), '3', 'Трубы'));
  for (const value of ['', '-1', 'nan']) assert.throws(() => workerCountBody(pipe('id'), value, 'Трубы'));
});
test('листы группируются по явной марке/поверхности/unit без потери обрезков', () => {
  const rows = [{ id: 'a', materialGrade: 'Ст3', unit: 'лист' }, { id: 'b', materialGrade: 'Ст3', unit: 'лист', assortment: 'Лист рифлёный' }, { id: 'c', offcutOf: 'a', unit: 'шт' }];
  const blocks = workerSheetBlocks(rows);
  assert.equal(blocks.length, 3); assert.equal(blocks.flatMap(b => b.rows).length, 3);
  assert.ok(blocks.some(b => b.grade === 'Марка не указана'));
});

let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t, { kind = 'pipe', readOnly = false, many = false, fail = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }); t.after(() => page.close());
  const items = many ? Array.from({ length: 103 }, (_, n) => pipe('m-' + n, { sectionProfile: { shape: 'rect', state: 'complete', label: (20 + n) + '×20×2', widthMm: 20 + n, heightMm: 20, wallMm: 2 } })) : kind === 'pipe' ? structuredClone(sourceRows)
    : [{ id: 'sheet', materialId: 'sheet', name: 'Лист Ст3', metal: 'sheet', materialGrade: 'Ст3', unit: 'лист', quantity: 4, reservedQty: 1, countMode: 'single', dims: { thickness: 3, width: 1250, length: 2500 }, notes: 'Примечание' },
      { id: 'cut', materialId: 'cut', name: 'Обрезок', metal: 'sheet', unit: 'шт', quantity: 0, countMode: 'multiple', offcutOf: 'sheet', dims: { thickness: 3, width: 500, length: 600 } }];
  const calls = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('dca_access', 'fixture'); localStorage.setItem('dca_user', JSON.stringify({ id: 'test', role: 'admin' })); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), method = route.request().method(), query = Object.fromEntries(url.searchParams);
    if (url.origin !== 'http://c269.test') return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const body = route.request().postDataJSON(); calls.push({ path: url.pathname, method, query, body });
      if (url.pathname === '/api/stock/zones') return route.fulfill({ json: { items: [{ id: 'zone', name: kind === 'pipe' ? 'Трубы' : 'Листовой материал' }] } });
      if (url.pathname === '/api/stock/items' && method === 'GET') { const limit = Number(query.limit || 100), first = (Number(query.page || 1) - 1) * limit; return route.fulfill({ json: { items: items.slice(first, first + limit), total: items.length, page: Number(query.page || 1), limit } }); }
      if (url.pathname === '/api/stock/batch') { if (fail) return route.fulfill({ status: 409, json: { message: 'Остаток изменился' } }); const item = items.find(item => item.materialId === body.lines[0].materialId); item.quantity = body.lines[0].qty; return route.fulfill({ json: { ok: true } }); }
      if (method === 'PATCH') { const item = items.find(item => item.materialId === url.pathname.split('/').at(-1)); Object.assign(item, body); return route.fulfill({ json: item }); }
      return route.fulfill({ json: { items: [] } });
    }
    if (url.pathname === '/app/fixture.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/app/ui/tokens.css"><link rel="stylesheet" href="/app/ui/base.css"><link rel="stylesheet" href="/app/ui/list.css"><link rel="stylesheet" href="/app/ui/form.css"><link rel="stylesheet" href="/app/ui/screens.css"><link rel="stylesheet" href="/app/ui/kit/kit.css"></head><body></body></html>' });
    const file = url.pathname.slice('/app/'.length); const type = { js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' }[file.split('.').at(-1)];
    if (!url.pathname.startsWith('/app/') || file.includes('..') || !type) return route.fulfill({ status: 404 });
    try { return route.fulfill({ contentType: type, body: await readFile(new URL('../' + file, import.meta.url)) }); } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto('http://c269.test/app/fixture.html');
  await page.evaluate(async ({ kind, readOnly }) => { const { mountStockWorktable } = await import('/app/sections/stock-worktable.js'); window.grid = mountStockWorktable(kind, { readOnly }); document.body.append(window.grid.el); }, { kind, readOnly });
  await page.locator('.pg-table tbody tr').first().waitFor();
  return { page, calls, errors, items };
}
test('pipe: динамические столбцы, уникальные ID, ноль и отсутствие phantom inputs', async t => {
  const { page, calls, errors, items } = await fixture(t);
  const ids = await page.locator('[data-material-id]').evaluateAll(nodes => nodes.map(node => node.dataset.materialId));
  assert.deepEqual(ids.sort(), items.map(item => item.materialId).sort());
  assert.ok((await page.locator('thead').allTextContents()).join(' ').includes('7,5 м'));
  assert.ok(await page.getByText('Нет в наличии', { exact: true }).count());
  assert.equal(await page.locator('td[aria-label="Материала нет"] input').count(), 0);
  const height = await page.locator('input.pg-in').first().evaluate(node => node.getBoundingClientRect().height); assert.equal(height, 48);
  assert.deepEqual(calls.filter(call => call.method !== 'GET'), []); assert.deepEqual(errors, []);
});
test('пересчёт и внешний reload сохраняют фокус, черновик, каретку следующей ячейки', async t => {
  const { page, calls, errors } = await fixture(t);
  const field = page.locator('[data-material-id="six"] input.pg-in');
  await field.fill('3'); await field.press('Enter');
  await page.waitForFunction(() => document.querySelector('input[data-saved]'));
  const next = page.locator('input[data-worker-key="duplicate:count"]'); await next.focus(); await next.fill('17'); await next.evaluate(node => node.setSelectionRange(1, 1));
  await page.evaluate(() => window.grid.reload());
  assert.equal(await next.inputValue(), '17'); assert.equal(await next.evaluate(node => document.activeElement === node && node.selectionStart === 1), true);
  assert.deepEqual(calls.find(call => call.path === '/api/stock/batch').body.lines[0], { materialId: 'six', qty: 3, expected: 12 });
  assert.equal(calls.filter(call => call.path === '/api/stock/batch').length, 1); assert.deepEqual(errors, []);
});
test('Enter/стрелки переходят в видимые количества, пропуская скрытые примечания', async t => {
  const { page, errors } = await fixture(t);
  const first = page.locator('[data-material-id="six"] input.pg-in');
  await first.focus(); await first.press('Enter');
  assert.equal(await page.locator('[data-material-id="duplicate"] input.pg-in').evaluate(node => document.activeElement === node), true);
  await first.focus(); await first.press('End'); await first.press('ArrowRight');
  assert.equal(await page.locator('[data-material-id="nonstandard"] input.pg-in').evaluate(node => document.activeElement === node), true);
  assert.equal(await page.evaluate(() => document.activeElement.closest('details:not([open])') !== null), false);
  assert.deepEqual(errors, []);
});
for (const kind of ['pipe', 'sheet']) test(kind + ': readonly без write handlers и multiple без ввода', async t => {
  const { page, calls, errors } = await fixture(t, { kind, readOnly: true });
  assert.equal(await page.locator('table input').count(), 0);
  await page.locator('table [aria-label^="Фактически"], table [aria-label^="Примечание"]').evaluateAll(nodes => nodes.forEach(node => { node.value = '99'; node.dispatchEvent(new Event('blur')); node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }));
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0); assert.deepEqual(errors, []);
});
test('sheet: единицы/обрезки и запись примечания, Escape не сохраняет', async t => {
  const { page, calls, errors } = await fixture(t, { kind: 'sheet' });
  assert.ok(await page.getByText('Обрезок', { exact: true }).count());
  assert.equal(await page.locator('[data-material-id="cut"] input.pg-in').count(), 0);
  const note = page.getByLabel('Примечание, Лист Ст3', { exact: true });
  await note.fill('Отмена'); await note.press('Escape'); assert.equal(await note.inputValue(), 'Примечание');
  await note.fill('Сверено'); await note.press('Tab'); await page.waitForFunction(() => document.querySelector('.pg-note[data-saved]'));
  assert.deepEqual(calls.find(call => call.method === 'PATCH').body, { notes: 'Сверено' }); assert.deepEqual(errors, []);
});
test('последняя ячейка листов после Enter остаётся в фокусе', async t => {
  const { page } = await fixture(t, { kind: 'sheet' });
  const input = page.locator('[data-material-id="sheet"] input.pg-in');
  await input.fill('3'); await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('input.pg-in[data-saved]'));
  assert.equal(await input.evaluate(node => document.activeElement === node), true);
  await page.evaluate(() => window.grid.reload());
  assert.equal(await input.evaluate(node => document.activeElement === node), true);
});
test('внешний reload сохраняет раскрытое примечание pipe, черновик и каретку', async t => {
  const { page, calls } = await fixture(t);
  const cell = page.locator('[data-material-id="six"]');
  await cell.locator('summary').click();
  const note = cell.locator('input.pg-note'); await note.fill('Черновик'); await note.evaluate(node => node.setSelectionRange(2, 2));
  await page.evaluate(() => window.grid.reload());
  assert.equal(await note.inputValue(), 'Черновик');
  assert.equal(await note.evaluate(node => document.activeElement === node && node.selectionStart === 2 && node.closest('details').open), true);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
});
test('ошибка пересчёта возвращает исходное значение ячейки и не меняет данные', async t => {
  const { page, items } = await fixture(t, { fail: true });
  const input = page.locator('[data-material-id="six"] input.pg-in');
  await input.fill('99'); await input.press('Enter');
  await page.waitForFunction(() => { const node = document.querySelector('[data-material-id="six"] input.pg-in'); return node && !node.disabled && node.value === '12'; });
  assert.equal(items.find(item => item.materialId === 'six').quantity, 12);
});
test('103 материала: явная текущая страница, серверная page2 без cap10000', async t => {
  const { page, calls, errors } = await fixture(t, { many: true });
  assert.equal(await page.locator('[data-material-id]').count(), 100);
  assert.ok(await page.getByText(/Сетка содержит только эту страницу/).count());
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-material-id]').length === 3);
  assert.ok((await page.locator('.pg-worker').textContent()).includes('Страница 2 из 2'));
  assert.ok(calls.some(call => call.query.page === '2' && call.query.limit === '100' && call.query.sort === 'sectionSize'));
  assert.ok(calls.filter(call => call.path === '/api/stock/items').every(call => Number(call.query.limit) === 100)); assert.deepEqual(errors, []);
});
