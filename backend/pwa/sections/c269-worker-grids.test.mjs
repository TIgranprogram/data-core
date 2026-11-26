import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';
import { workerPipeBlocks, workerSheetBlocks, workerCountBody, workerPipeMetres, workerPipePieces } from './stock-worker-model.js';

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
test('пересчёт труб: 2×6→12м, 2×12→24м, шт без умножения, raw expected и доступ', () => {
  const count = (item, value) => workerCountBody(item, value, 'Трубы', 'pipe').lines[0];
  assert.deepEqual(count(pipe('id', { quantity: 7 }), '2'), { materialId: 'id', qty: 12, expected: 7 });
  assert.equal(count(pipe('id', { dims: { length: 12000 } }), '2').qty, 24);
  assert.equal(count(pipe('id', { unit: 'шт', dims: {} }), '2').qty, 2);
  assert.equal(count(pipe('id'), '0').qty, 0);
  for (const extra of [{countMode: 'multiple'}, {countMode: 'unknown'}, {countMode: undefined}, {unit: 'кг'}, {dims: {}}]) assert.throws(() => count(pipe('id', extra), '3'));
  for (const value of ['', '-1', 'nan', '3,5', '3.5', 'Infinity']) assert.throws(() => count(pipe('id'), value));
  assert.equal(workerCountBody({ ...pipe('sheet'), unit: 'лист' }, '3,5', 'Листы', 'sheet').lines[0].qty, 3.5);
});
test('остаток с дробной трубой остаётся в метрах, учитывается только погрешность float', () => {
  assert.equal(workerPipePieces(pipe('id', { quantity: 7 })), null);
  assert.equal(workerPipeMetres(pipe('id', { quantity: 7 })), 7);
  assert.equal(workerPipePieces(pipe('id', { quantity: 12 + Number.EPSILON * 8 })), 2);
  assert.equal(workerPipePieces(pipe('id', { quantity: 0 })), 0);
  assert.equal(workerPipeMetres(pipe('raw', { unit: 'шт', quantity: 3 })), 18);
  assert.equal(workerPipeMetres(pipe('id', { quantity: 7, dims: {} })), 7);
  assert.equal(workerPipeMetres(pipe('raw', { unit: 'шт', quantity: 3, dims: {} })), null);
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
async function fixture(t, { kind = 'pipe', readOnly = false, many = false, fail = false, delayHistory = 0, failHistory = false, historyItems, mixedMetals = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' }); t.after(() => page.close());
  const items = many ? Array.from({ length: 103 }, (_, n) => pipe('m-' + n, { sectionProfile: { shape: 'rect', state: 'complete', label: (20 + n) + '×20×2', widthMm: 20 + n, heightMm: 20, wallMm: 2 } })) : kind === 'pipe' ? structuredClone(sourceRows)
    : [{ id: 'sheet', materialId: 'sheet', name: 'Лист Ст3', metal: 'sheet', materialGrade: 'Ст3', unit: 'лист', quantity: 4, reservedQty: 1, countMode: 'single', dims: { thickness: 3, width: 1250, length: 2500 }, notes: 'Примечание' },
      { id: 'cut', materialId: 'cut', name: 'Обрезок', metal: 'sheet', unit: 'шт', quantity: 0, countMode: 'multiple', offcutOf: 'sheet', dims: { thickness: 3, width: 500, length: 600 } }];
  if (mixedMetals) items.unshift({ ...items[0], id: 'stainless', materialId: 'stainless', materialGrade: 'AISI304' },
    { ...items[0], id: 'unclassified', materialId: 'unclassified', materialGrade: 'Неизвестная марка' });
  const calls = [], errors = [], historyAttempts = new Map();
  let activeHistory = 0, maxHistory = 0;
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('dca_access', 'fixture'); localStorage.setItem('dca_user', JSON.stringify({ id: 'test', role: 'admin' })); });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), method = route.request().method(), query = Object.fromEntries(url.searchParams);
    if (url.origin !== 'http://c269.test') return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const body = route.request().postDataJSON(); calls.push({ path: url.pathname, method, query, body });
      if (/^\/api\/stock\/items\/[^/]+\/(requests|reservations)$/.test(url.pathname)) {
        return route.fulfill({ json: { items: [], total: 0, page: Number(query.page), limit: Number(query.limit) } });
      }
      if (url.pathname.endsWith('/history')) {
        const id = decodeURIComponent(url.pathname.split('/').at(-2)); historyAttempts.set(id, (historyAttempts.get(id) || 0) + 1);
        activeHistory++; maxHistory = Math.max(maxHistory, activeHistory);
        if (delayHistory) await new Promise(resolve => setTimeout(resolve, delayHistory));
        try {
          if (failHistory && id === 'six' && historyAttempts.get(id) === 1) return await route.fulfill({ status: 400, json: { message: 'История недоступна' } });
          const recent = historyItems || [{ kind: 'movement', type: 'count', qty: items.find(item => item.materialId === id)?.quantity ?? 0, date: '2026-11-26T08:30:00Z', note: 'Проверка количества', issuedTo: 'Получатель', source: 'fixture' }];
          return await route.fulfill({ json: { items: recent, total: recent.length } });
        } finally { activeHistory--; }
      }
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
  return { page, calls, errors, items, historyAttempts, maxHistory: () => maxHistory };
}
for (const kind of ['pipe', 'sheet']) test(kind + ': обычная сталь перед нержавеющей, отдельный акцент в обеих темах', async t => {
  const { page } = await fixture(t, { kind, mixedMetals: true });
  const titles = page.locator('.pg-title');
  const labels = await titles.allTextContents();
  const firstStainless = labels.findIndex(label => label.startsWith('Нержавеющая сталь'));
  const firstUnknown = labels.findIndex(label => label.startsWith('Металл не уточнён'));
  assert.ok(firstUnknown > 0 && firstStainless > firstUnknown);
  assert.ok(labels.slice(0, firstUnknown).every(label => label.startsWith('Обычная сталь')));
  assert.ok(labels.slice(firstStainless).every(label => label.startsWith('Нержавеющая сталь')));
  for (const [theme, width] of [['light', 1440], ['dark', 1024]]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const background = locator => locator.evaluate(node => getComputedStyle(node).backgroundColor);
    assert.notEqual(await background(titles.first()), await background(titles.nth(firstStainless)));
  }
});
test('pipe: динамические столбцы, уникальные ID, ноль и отсутствие phantom inputs', async t => {
  const { page, calls, errors, items } = await fixture(t);
  const ids = await page.locator('[data-material-id]').evaluateAll(nodes => nodes.map(node => node.dataset.materialId));
  assert.deepEqual(ids.sort(), items.map(item => item.materialId).sort());
  assert.ok((await page.locator('thead').allTextContents()).join(' ').includes('7,5 м'));
  assert.equal(await page.locator('[data-material-id="unknown"] input.pg-in').count(), 0);
  assert.equal(await page.locator('[data-material-id="unknown"]').textContent(), '—');
  assert.equal(await page.locator('td .pg-worker-source').count(), 0);
  assert.match(await page.locator('[data-material-id="duplicate"]').getAttribute('title'), /Труба duplicate/);
  assert.equal(await page.locator('[data-material-id="unknown"] .pg-worker-zero').count(), 1);
  assert.equal(await page.locator('td[aria-label="Материала нет"] input').count(), 0);
  const height = await page.locator('input.pg-in').first().evaluate(node => node.getBoundingClientRect().height); assert.equal(height, 48);
  assert.deepEqual(calls.filter(call => call.method !== 'GET'), []); assert.deepEqual(errors, []);
});
const proof = process.env.C273_PROOF_DIR;
if (proof) for (const [theme, width] of [['light', 1440], ['dark', 1024]]) {
  test(`снимки C273: ${theme}, ${width}`, async t => {
    const { page } = await fixture(t, { mixedMetals: true });
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await mkdir(proof, { recursive: true });
    const ordinary = page.locator('.pg-block.k-round').first();
    const stainless = page.locator('.pg-block.k-steel').first();
    await ordinary.locator('input.pg-in').first().focus();
    await ordinary.screenshot({ path: join(proof, `${theme}-steel.png`) });
    await stainless.screenshot({ path: join(proof, `${theme}-stainless.png`) });
    await ordinary.locator('[data-worker-row]').first().click();
    await ordinary.getByText(/Всего по строке/).waitFor();
    await page.screenshot({ path: join(proof, `${theme}-detail.png`) });
  });
}
test('пересчёт и внешний reload сохраняют фокус, черновик, каретку следующей ячейки', async t => {
  const { page, calls, errors } = await fixture(t);
  const field = page.locator('[data-material-id="six"] input.pg-in');
  await field.fill('3'); await field.press('Enter');
  await page.waitForFunction(() => document.querySelector('input[data-saved]'));
  const next = page.locator('input[data-worker-key="duplicate:count"]'); await next.focus(); await next.fill('17'); await next.evaluate(node => node.setSelectionRange(1, 1));
  await page.evaluate(() => window.grid.reload());
  assert.equal(await next.inputValue(), '17'); assert.equal(await next.evaluate(node => document.activeElement === node && node.selectionStart === 1), true);
  assert.deepEqual(calls.find(call => call.path === '/api/stock/batch').body.lines[0], { materialId: 'six', qty: 18, expected: 12 });
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
  await page.locator('[data-worker-count-confirm]').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('input.pg-in[data-saved]'));
  assert.equal(await input.evaluate(node => document.activeElement === node), true);
  await page.evaluate(() => window.grid.reload());
  assert.equal(await input.evaluate(node => document.activeElement === node), true);
});
test('внешний reload сохраняет примечание sheet, черновик и каретку', async t => {
  const { page, calls } = await fixture(t, { kind: 'sheet' });
  const cell = page.locator('[data-material-id="sheet"]');
  const note = cell.locator('input.pg-note'); await note.fill('Черновик'); await note.evaluate(node => node.setSelectionRange(2, 2));
  await page.evaluate(() => window.grid.reload());
  assert.equal(await note.inputValue(), 'Черновик');
  assert.equal(await note.evaluate(node => document.activeElement === node && node.selectionStart === 2), true);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
});
test('ошибка пересчёта возвращает сохранённый остаток в ячейку', async t => {
  const { page, items } = await fixture(t, { fail: true });
  const input = page.locator('[data-material-id="six"] input.pg-in');
  await input.fill('99'); await input.press('Enter');
  await page.locator('.toast').filter({ hasText: 'Остаток изменился' }).waitFor();
  assert.equal(await input.inputValue(), '2');
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
test('кнопка сечения без стрелки раскрывает только подстроку; история ленивая,≤2, кэшируется, количество не раскрывает', async t => {
  const { page, calls, errors, maxHistory } = await fixture(t, { delayHistory: 60 });
  assert.equal(calls.filter(call => call.path.endsWith('/history')).length, 0);
  const cell = page.locator('[data-material-id="six"]'), main = cell.locator('xpath=..'), toggle = main.locator('button[data-worker-row]');
  const detail = page.locator('#' + await toggle.getAttribute('aria-controls'));
  assert.equal(await toggle.textContent(), '40×20×2'); assert.equal(await detail.isVisible(), false);
  await cell.locator('input.pg-in').click(); assert.equal(await detail.isVisible(), false);
  await toggle.click(); await page.waitForFunction(() => document.querySelectorAll('.pg-worker-operation-matrix tbody tr').length === 3);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await detail.locator('td').first().getAttribute('colspan'), String(await main.locator('th,td').count()));
  assert.deepEqual(await detail.locator('[data-detail-material-id]').evaluateAll(nodes => nodes.map(node => node.dataset.detailMaterialId).sort()), ['nonstandard', 'six', 'twelve']);
  assert.equal(maxHistory(), 2); assert.equal(calls.filter(call => call.path.endsWith('/history')).length, 3);
  assert.ok((await detail.textContent()).includes('Автор не указан')); assert.ok((await detail.textContent()).includes('Кому: Получатель'));
  await cell.locator('input.pg-in').press('Enter');
  assert.equal(await page.locator('[data-material-id="duplicate"] input.pg-in').evaluate(node => document.activeElement === node), true);
  await toggle.press('Space'); assert.equal(await detail.isVisible(), false);
  await toggle.press('Enter'); await page.waitForTimeout(100); assert.equal(calls.filter(call => call.path.endsWith('/history')).length, 3);
  assert.deepEqual(errors, []);
});
test('история ошибки повторяется отдельно; закрытие/уход не открывают подстроку поздним ответом', async t => {
  const { page, calls } = await fixture(t, { delayHistory: 70, failHistory: true });
  const toggle = page.locator('[data-material-id="six"]').locator('xpath=..').locator('button[data-worker-row]');
  await toggle.click();
  const variant = page.locator('[data-detail-material-id="six"]');
  await variant.getByRole('button', { name: 'Повторить', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-detail-material-id="six"] .pg-worker-operation-matrix tbody tr'));
  assert.equal(calls.filter(call => call.path.endsWith('/six/history')).length, 2);
  await toggle.click(); await page.waitForTimeout(100);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click(); await page.evaluate(() => window.grid.destroy()); await page.waitForTimeout(100);
  assert.equal(calls.filter(call => call.path.endsWith('/six/history')).length, 2);
});
test('pipe примечание в подстроке сохраняется; собственный reload хранит раскрытие/черновик/focus и обновляет cache только этогоID', async t => {
  const { page, calls, historyAttempts } = await fixture(t);
  const toggle = page.locator('[data-material-id="six"]').locator('xpath=..').locator('button[data-worker-row]'); await toggle.click();
  const note = page.locator('[data-detail-material-id="six"] input.pg-note'); await note.fill('Черновик трубы'); await note.evaluate(node => node.setSelectionRange(3, 3));
  await page.evaluate(() => window.grid.reload());
  assert.equal(await note.inputValue(), 'Черновик трубы'); assert.equal(await note.evaluate(node => document.activeElement === node && node.selectionStart === 3 && !node.closest('tr').hidden), true);
  await note.press('Enter'); await page.waitForFunction(() => document.querySelector('[data-detail-material-id="six"] .pg-note[data-saved]'));
  await page.evaluate(() => window.grid.reload()); await page.waitForTimeout(100);
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(historyAttempts.get('six') >= 2); assert.equal(historyAttempts.get('twelve'), 1);
  assert.deepEqual(calls.find(call => call.method === 'PATCH').body, { notes: 'Черновик трубы' });
});
test('пересчёт открытой строки инвалидирует только её материал и показывает новые операции после reload', async t => {
  const { page, historyAttempts } = await fixture(t);
  const cell = page.locator('[data-material-id="six"]');
  await cell.locator('xpath=..').locator('button[data-worker-row]').click();
  await page.waitForFunction(() => document.querySelectorAll('.pg-worker-operation-matrix tbody tr').length === 3);
  await cell.locator('input.pg-in').fill('3'); await cell.locator('input.pg-in').press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-material-id="six"] input[data-saved]'));
  await page.evaluate(() => window.grid.reload()); await page.waitForTimeout(100);
  assert.equal(historyAttempts.get('six'), 2); assert.equal(historyAttempts.get('twelve'), 1);
  assert.ok((await page.locator('[data-detail-material-id="six"] .pg-worker-history').textContent()).includes('18 м'));
});
test('readonly подстрока не создаёт полей записи, sheet-note остаётся только в основной строке', async t => {
  const { page, calls } = await fixture(t, { kind: 'sheet', readOnly: true });
  await page.locator('[data-material-id="sheet"] button[data-worker-row]').click();
  const detail = page.locator('[data-detail-material-id="sheet"]'); await detail.waitFor();
  assert.equal(await detail.locator('input').count(), 0);
  assert.equal(calls.filter(call => call.method !== 'GET').length, 0);
});
test('аккордеон единственный между блоками: переключение сохраняет черновик без PATCH и reload не теряет его', async t => {
  const { page, calls } = await fixture(t);
  const first = page.locator('[data-material-id="six"]').locator('xpath=..').locator('button[data-worker-row]');
  const another = page.locator('[data-material-id="pieces"]').locator('xpath=..').locator('button[data-worker-row]');
  await first.click();
  const note = page.locator('[data-detail-material-id="six"] input.pg-note'); await note.fill('Черновик без записи');
  await another.click();
  assert.equal(await first.getAttribute('aria-expanded'), 'false'); assert.equal(await another.getAttribute('aria-expanded'), 'true');
  assert.equal(await page.locator('.pg-worker-detail:not([hidden])').count(), 1);
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
  await first.click(); assert.equal(await note.inputValue(), 'Черновик без записи');
  await page.evaluate(() => window.grid.reload());
  assert.equal(await page.locator('.pg-worker-detail:not([hidden])').count(), 1); assert.equal(await note.inputValue(), 'Черновик без записи');
  await note.focus(); await note.evaluate(node => node.setSelectionRange(2, 2));
  await page.evaluate(() => window.grid.reload());
  assert.equal(await note.evaluate(node => document.activeElement === node && node.selectionStart === 2), true);
  await another.evaluate(node => node.click());
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 0);
  await first.click(); assert.equal(await note.inputValue(), 'Черновик без записи');
  await note.focus(); await note.press('Enter'); await page.waitForFunction(() => document.querySelector('[data-detail-material-id="six"] input[data-saved]'));
  assert.equal(calls.filter(call => call.method === 'PATCH').length, 1);
});
for (const theme of ['light', 'dark']) test('аккордеон / ' + theme + ': мягкий фон, отдельная карточка и акцент открытой кнопки', async t => {
  const { page } = await fixture(t);
  await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
  const toggle = page.locator('[data-material-id="six"]').locator('xpath=..').locator('button[data-worker-row]'); await toggle.click();
  const styles = await page.evaluate(() => {
    const resolve = token => { const probe = document.createElement('div'); probe.style.background = 'var(' + token + ')'; document.body.append(probe); const color = getComputedStyle(probe).backgroundColor; probe.remove(); return color; };
    return { detail: getComputedStyle(document.querySelector('.pg-worker-detail:not([hidden]) > td')).backgroundColor,
      card: getComputedStyle(document.querySelector('[data-detail-material-id="six"] > .form-block')).backgroundColor,
      accent: getComputedStyle(document.querySelector('button[data-worker-row][aria-expanded="true"]')).boxShadow,
      primary: resolve('--primary-soft'), surface: resolve('--surface') };
  });
  assert.equal(styles.detail, styles.primary); assert.equal(styles.card, styles.surface); assert.notEqual(styles.accent, 'none');
  assert.equal(await page.locator('[data-detail-material-id="six"] .k-sec-fhead').textContent(), 'Мытая · 6 м');
  assert.equal(await page.locator('[data-detail-material-id="six"] .k-sec-fhead h3').count(), 1);
  const sizes = await page.locator('[data-detail-material-id="six"] .pg-worker-figures').evaluate(node => [...node.querySelectorAll('.stat b')].map(value => parseFloat(getComputedStyle(value).fontSize)));
  assert.ok(sizes[0] > sizes[1]);
  await page.setViewportSize({ width: 1024, height: 1000 });
  assert.equal(await page.locator('.pg-worker-detail-content').first().evaluate(node => getComputedStyle(node).gridTemplateColumns.trim().split(/\s+/).length), 1);
});
test('матрица операций убирает повтор типа/автора, сохраняет хронологию и помещается на1024', async t => {
  for (const types of [Array(5).fill('adjust'), ['adjust', 'adjust', 'out', 'adjust', 'in']]) {
    const historyItems = types.map((type, index) => ({ type, kind: 'movement', qty: 5 - index, date: new Date(Date.UTC(2026, 10, 26, 12 - index)).toISOString(), note: 'Проверенная операция', source: 'Таблица труб' }));
    const { page } = await fixture(t, { historyItems }); await page.setViewportSize({ width: 1024, height: 1000 });
    await page.locator('[data-material-id="six"]').locator('xpath=..').locator('button[data-worker-row]').click();
    const history = page.locator('[data-detail-material-id="six"] .pg-worker-history');
    await history.locator('.pg-worker-operation-matrix').first().waitFor();
    const headings = await history.locator('.pg-worker-operation-group > h3').allTextContents();
    assert.deepEqual(headings, types.every(type => type === 'adjust') ? ['Корректировка'] : ['Корректировка', 'Списание', 'Корректировка', 'Приход']);
    assert.deepEqual(await history.locator('tbody tr td:nth-child(2) strong').allTextContents(), ['5 м', '4 м', '3 м', '2 м', '1 м']);
    assert.equal(await history.getByText('Автор не указан · Источник: Таблица труб', { exact: true }).count(), headings.length);
    assert.equal(await history.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
  }
});
