import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';
import { workerCreateBody, workerCreateContext, workerQuickReady } from './stock-worker-model.js';

const origin = 'http://c270.test';
const pipe = (id, width = 40, extra = {}) => ({ id, materialId: id, name: 'Труба ' + id, metal: 'pipe', categoryId: 'pipe-cat', categoryName: 'Профильная труба', materialGrade: 'Ст3', unit: 'м', countMode: 'single', quantity: 12, reservedQty: 0, washed: true,
  sectionProfile: { shape: 'rect', state: 'complete', label: width + '×20×2', widthMm: width, heightMm: 20, wallMm: 2 }, dims: { length: 6000 }, ...extra });
const categories = [{ id: 'pipe-cat', name: 'Профильная труба' }, { id: 'sheet-cat', name: 'Листовой металл' }, { id: 'foreign-cat', name: 'Дерево' }];
const source = [pipe('first'), pipe('long', 40, { washed: false, dims: { length: 12000 } }), pipe('small', 50), pipe('multiple', 60, { countMode: 'multiple' }),
  pipe('raw40', 40, { washed: false, unit: 'шт', quantity: 2, dims: { length: 6000 } }), pipe('raw50', 50, { washed: false, quantity: 24, dims: { length: 12000 } }),
  pipe('washedLong', 60, { washed: true, quantity: 2, dims: { length: 12000 } }),
  { id: 'sheet', materialId: 'sheet', name: 'Лист Ст3', metal: 'sheet', categoryId: 'sheet-cat', unit: 'лист', quantity: 3, countMode: 'single', materialGrade: 'Ст3', dims: { thickness: 3, width: 1250, length: 2500 }, notes: 'Лист' },
  pipe('foreign-zone', 70, { categoryId: 'foreign-cat' }), pipe('foreign-type', 80, { metal: 'sheet' })];

test('create DTO использует только явные оси, положительные мм и категорию своей зоны', () => {
  const context = workerCreateContext(pipe('a'), { length: 12000, washed: false });
  const body = workerCreateBody(context, 'pipe', categories.slice(0, 1));
  assert.deepEqual(body.dims, { width: 40, height: 20, thickness: 2, length: 12000 });
  assert.equal(body.washed, false); assert.equal(body.unit, 'м'); assert.equal(body.categoryId, 'pipe-cat');
  for (const key of ['quantity', 'initial', 'metal']) assert.equal(key in body, false);
  assert.throws(() => workerCreateBody({ ...context, categoryId: 'foreign-cat' }, 'pipe', categories.slice(0, 1)));
  assert.throws(() => workerCreateBody({ ...context, dims: { ...context.dims, length: null } }, 'pipe', categories));
  assert.throws(() => workerCreateBody({ ...context, shape: '' }, 'pipe', categories));
  const unknown = workerCreateContext({ ...pipe('u'), sectionProfile: { label: '40×20×2', state: 'unknown' } }, { length: null, washed: null });
  assert.equal(unknown.dims.width, undefined); assert.throws(() => workerCreateBody(unknown, 'pipe', categories));
  assert.equal(workerQuickReady(context, 'pipe'), true);
  assert.equal(workerQuickReady({ ...context, categoryName: '' }, 'pipe'), false);
  assert.equal(workerQuickReady({ ...context, dims: { ...context.dims, length: null } }, 'pipe'), false);
  assert.equal(workerQuickReady(unknown, 'pipe'), false);
});

let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t, { kind = 'pipe', readOnly = false, receive = false, materialId, draft, common = false, state = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' }); t.after(() => page.close());
  const items = structuredClone(source), calls = [], errors = [];
  if (state.fractional) items.find(item => item.id === 'first').quantity = 7;
  if (state.duplicate) items.push(pipe('duplicate'));
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ draft, kind }) => {
    localStorage.setItem('dca_access', 'fixture'); localStorage.setItem('dca_user', JSON.stringify({ id: 'fixture', role: 'admin', sections: ['stock', 'requests'] }));
    localStorage.setItem('dc-stock-zone-fixture', 'unchanged');
    localStorage.setItem('dc-ops-recent-in', JSON.stringify([{ id: 'foreign-zone', name: 'Чужая зона' }, { id: 'foreign-type', name: 'Чужой тип' }, { id: 'first', name: 'Разрешённая труба' }]));
    if (draft) localStorage.setItem('dc-ops-in:' + kind + ':zone', JSON.stringify(draft));
  }, { draft, kind });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const body = route.request().postDataJSON(), query = Object.fromEntries(url.searchParams); calls.push({ path: url.pathname, method, body, query });
      if (url.pathname === '/api/stock/zones') return route.fulfill({ json: { items: [{ id: 'zone', name: kind === 'pipe' ? 'Трубы' : 'Листовой материал' }] } });
      if (url.pathname === '/api/stock/categories') return route.fulfill({ json: { items: categories } });
      if (url.pathname.endsWith('/history')) return route.fulfill({ json: { items: [], total: 0 } });
      if (url.pathname === '/api/stock/items' && method === 'GET') {
        const found = Number(query.limit) >= 1000 ? items : items.filter(item => item.metal === kind && item.categoryId === kind + '-cat');
        return route.fulfill({ json: { items: found, total: found.length, page: 1, limit: Number(query.limit || 100) } });
      }
      if (url.pathname === '/api/stock/items' && method === 'POST') {
        if (state.delayCreate) await new Promise(resolve => setTimeout(resolve, state.delayCreate));
        if (state.failCreate) return route.fulfill({ status: 409, json: { message: 'Материал с таким названием уже есть' } });
        const created = { ...body, id: 'created', materialId: 'created', quantity: 0, countMode: 'single', metal: kind, sectionProfile: { shape: 'rect', state: 'complete', label: '50×20×2', widthMm: 50, heightMm: 20, wallMm: 2 } };
        items.push(created); return route.fulfill({ status: 201, json: created });
      }
      if (url.pathname.startsWith('/api/stock/items/') && method === 'GET') return route.fulfill({ json: items.find(item => item.id === url.pathname.split('/').at(-1)) || {} });
      if (url.pathname === '/api/stock/batch') {
        if (state.delayCount) await new Promise(resolve => setTimeout(resolve, state.delayCount));
        const found = body.lines.map(line => items.find(item => item.id === line.materialId));
        if (state.failCount || found.some((item, index) => !item || body.type === 'count' && body.lines[index].expected !== item.quantity)) return route.fulfill({ status: 409, json: { message: 'Остаток изменился. Обновите данные.' } });
        if (body.type === 'count') body.lines.forEach((line, index) => { found[index].quantity = line.qty; });
        return route.fulfill({ json: { lines: body.lines.length, moved: body.lines.length, batchId: 'batch' } });
      }
      return route.fulfill({ json: { items: [], counts: {} } });
    }
    if (url.pathname === '/app/fixture.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/app/ui/tokens.css"><link rel="stylesheet" href="/app/ui/base.css"><link rel="stylesheet" href="/app/ui/form.css"><link rel="stylesheet" href="/app/ui/kit/kit.css"></head><body></body></html>' });
    const file = url.pathname.slice('/app/'.length), type = { js: 'text/javascript', css: 'text/css', woff2: 'font/woff2' }[file.split('.').at(-1)];
    if (!type || file.includes('..')) return route.fulfill({ status: 404 });
    try { return route.fulfill({ contentType: type, body: await readFile(new URL('../' + file, import.meta.url)) }); } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto(origin + '/app/fixture.html');
  await page.evaluate(async ({ kind, readOnly, receive, materialId, common }) => {
    if (receive) {
      location.hash = '#stock?of=stockop&new=1&op=in' + (common ? '' : '&workerZone=zone&workerKind=' + kind) + (materialId ? '&materialId=' + materialId : '');
      const { stockOp } = await import('/app/sections/stock-ops.js'); window.operation = await stockOp.form.build(); document.body.append(window.operation.el);
    } else { const { mountStockWorktable } = await import('/app/sections/stock-worktable.js'); window.grid = mountStockWorktable(kind, { readOnly }); document.body.append(window.grid.el); }
  }, { kind, readOnly, receive, materialId, common });
  if (!receive) await page.locator('[data-material-id]').first().waitFor();
  return { page, calls, errors, items };
}
const writes = calls => calls.filter(call => call.method !== 'GET');
const confirm = page => page.locator('[data-worker-count-confirm]');
test('количество: Escape отменяет; Enter и Tab сразу сохраняют целые штуки в исходной единице', async t => {
  const { page, calls, items, errors } = await fixture(t, { state: { delayCount: 120 } });
  const input = page.locator('[data-material-id="first"] input.pg-in');
  await input.fill('7'); await input.press('Escape'); assert.equal(writes(calls).length, 0); assert.equal(await input.inputValue(), '2');
  await input.fill('3'); await input.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-material-id="first"] input[data-saved]'));
  assert.deepEqual(calls.find(call => call.path === '/api/stock/batch').body.lines[0], { materialId: 'first', qty: 18, expected: 12 });
  assert.equal(writes(calls).length, 1);
  const response = page.waitForResponse('**/api/stock/batch');
  await input.fill('0'); await input.press('Tab');
  assert.equal((await response).ok(), true);
  await page.waitForFunction(() => document.querySelector('[data-material-id="first"] .pg-worker-zero input')?.value === '0');
  assert.deepEqual(writes(calls)[1].body.lines, [{ materialId: 'first', qty: 0, expected: 18 }]);
  assert.equal(items.find(item => item.id === 'first').quantity, 0);
  assert.equal(await confirm(page).count(), 0); assert.deepEqual(errors, []);
});

test('показываются только штуки; некратный остаток и сумма метров видны в раскрытой строке', async t => {
  const { page, calls, errors } = await fixture(t, { state: { fractional: true } });
  const cell = page.locator('[data-material-id="first"]'), field = cell.locator('input.pg-in');
  assert.equal(await field.inputValue(), ''); assert.equal(await field.getAttribute('inputmode'), 'numeric');
  assert.equal(await cell.textContent(), '');
  await cell.locator('..').getByRole('button', { name: '40×20×2' }).click();
  await page.locator('[data-detail-material-id="first"] .stat').filter({ hasText: 'Всего метров' }).getByText('7 м', { exact: true }).waitFor();
  await page.getByText('Всего по строке: 19 м', { exact: true }).waitFor();
  async function save(field, value, key) {
    await field.fill(value); await field.press(key);
    await field.locator('xpath=self::*[@data-saved]').waitFor();
  }
  await save(field, '2', 'Enter');
  const long = page.locator('[data-material-id="long"] input.pg-in');
  await save(long, '2', 'Tab');
  const pieces = page.locator('[data-material-id="raw40"] input.pg-in');
  await save(pieces, '3', 'Enter');
  await page.evaluate(() => window.grid.reload());
  await page.getByText('Всего по строке: 36 м', { exact: true }).waitFor();
  await page.locator('[data-material-id="raw40"]').locator('..').getByRole('button', { name: '40×20×2' }).click();
  await page.locator('[data-detail-material-id="raw40"] .pg-worker-figures').getByText('18 м', { exact: true }).waitFor();
  assert.deepEqual(writes(calls).map(call => call.body.lines[0]), [
    { materialId: 'first', qty: 12, expected: 7 }, { materialId: 'long', qty: 24, expected: 12 }, { materialId: 'raw40', qty: 3, expected: 2 },
  ]);
  assert.deepEqual(errors, []);
});

test('буквы, дроби, пробелы и отрицательные значения отклоняются целиком', async t => {
  const { page, calls } = await fixture(t);
  const input = page.locator('[data-material-id="first"] input.pg-in');
  await input.focus(); await page.keyboard.insertText('2e3');
  assert.equal(await input.inputValue(), '2');
  await input.press('End'); await page.keyboard.insertText('-');
  assert.equal(await input.inputValue(), '2');
  const allowed = await input.evaluate(node => {
    const data = new DataTransfer(); data.setData('text/plain', '1,5');
    const allowed = node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, cancelable: true }));
    node.value = '1 5'; // Даже если браузер пропустил некорректное значение, записи нет.
    return allowed;
  });
  assert.equal(allowed, false);
  await input.press('Enter');
  await page.locator('.toast').filter({ hasText: 'Введите целое неотрицательное количество труб.' }).waitFor();
  assert.equal(await input.inputValue(), '2'); assert.equal(writes(calls).length, 0);
});

test('внешний reload сохраняет черновик и каретку; конфликт 409 не перезаписывает остаток', async t => {
  const { page, calls, items, errors } = await fixture(t);
  const first = page.locator('[data-material-id="first"] input.pg-in');
  await first.fill('8'); await first.evaluate(node => node.setSelectionRange(1, 1));
  items.find(item => item.id === 'first').quantity = 40;
  await page.evaluate(() => window.grid.reload());
  assert.equal(await first.inputValue(), '8'); assert.equal(await first.evaluate(node => document.activeElement === node && node.selectionStart === 1), true);
  await first.press('Enter');
  await page.locator('.toast').filter({ hasText: 'Остаток изменился' }).waitFor();
  assert.equal(calls.find(call => call.path === '/api/stock/batch').body.lines[0].expected, 12);
  assert.equal(items.find(item => item.id === 'first').quantity, 40);
  assert.equal(calls.some(call => call.body?.force), false);
  await page.waitForFunction(() => document.querySelector('[data-material-id="first"] input.pg-in')?.value === ''); assert.deepEqual(errors, []);
});

test('пустая координата: только количество, reload сохраняет черновик; при совпавших сечениях ввод только в существующие материалы', async t => {
  const { page, calls, errors } = await fixture(t, { state: { duplicate: true } });
  const ambiguous = page.getByText('Совпадает сечение', { exact: true });
  assert.equal(await ambiguous.count(), 2);
  assert.equal(await page.locator('tbody tr').filter({ has: ambiguous }).locator('[data-worker-create]').count(), 0);
  await page.locator('[data-material-id="duplicate"]').locator('xpath=..').locator('[data-worker-row]').click();
  await page.locator('[data-detail-material-id="duplicate"]').getByText('Труба duplicate', { exact: true }).waitFor();
  const empty = page.locator('[data-worker-create="cell"][title*="50×20×2"][title*="Мытая"]').first();
  assert.equal(await empty.evaluate(node => node.tagName), 'INPUT');
  const key = await empty.getAttribute('data-worker-key');
  await empty.click(); await empty.fill('3');
  assert.equal(await page.locator('[data-worker-entry]').count(), 0); assert.equal(writes(calls).length, 0);
  await page.evaluate(() => window.grid.reload());
  const again = page.locator(`[data-worker-key="${key}"]`);
  await again.waitFor(); assert.equal(await again.inputValue(), '3');
  await again.press('Escape'); assert.equal(await again.inputValue(), '');
  assert.equal(writes(calls).length, 0); assert.deepEqual(errors, []);
});

test('пустая координата: createOnly с zone, три трубы по 12 м; count failure повторяет только count', async t => {
  const state = { failCount: true }, { page, calls, errors } = await fixture(t, { state });
  const cell = page.locator('[data-worker-create="cell"][title*="60×20×2"][title$="12 м"]').first();
  await cell.fill('3'); await cell.press('Enter');
  await page.locator('[data-worker-entry-error]:visible').waitFor();
  assert.equal(writes(calls).length, 2);
  state.failCount = false; await cell.press('Enter');
  await page.locator('[data-material-id="created"]').waitFor();
  const created = calls.filter(call => call.path === '/api/stock/items' && call.method === 'POST'); assert.equal(created.length, 1);
  assert.equal(created[0].query.zoneId, 'zone'); assert.equal(created[0].body.categoryId, 'pipe-cat'); assert.equal(created[0].body.unit, 'м');
  assert.deepEqual(created[0].body.dims, { width: 60, height: 20, thickness: 2, length: 12000 });
  assert.deepEqual(calls.filter(call => call.path === '/api/stock/batch').map(call => call.body.lines[0]), Array(2).fill({ materialId: 'created', qty: 36, expected: 0 }));
  assert.deepEqual(errors, []);
});

test('пустая координата: после сбоя повтор с нулём сверяет остаток и оставляет конфликт видимым', async t => {
  const state = { failCount: true }, { page, calls, items, errors } = await fixture(t, { state });
  const cell = page.locator('[data-worker-create="cell"][title*="60×20×2"][title$="12 м"]').first();
  await cell.fill('3'); await cell.press('Enter');
  await cell.locator('..').getByText('Материал создан, количество не сохранено.', { exact: false }).waitFor();
  const created = items.find(item => item.id === 'created');
  created.quantity = 12;
  state.failCount = false;
  await cell.fill('0'); await cell.press('Enter');
  await cell.locator('..').getByText('Материал создан, количество не сохранено.', { exact: false }).waitFor();
  assert.equal(await cell.inputValue(), '0');
  assert.equal(await cell.getAttribute('data-saved'), null);
  assert.deepEqual(writes(calls).map(call => call.path), ['/api/stock/items', '/api/stock/batch', '/api/stock/batch']);
  assert.deepEqual(writes(calls)[2].body.lines, [{ materialId: 'created', qty: 0, expected: 0 }]);
  assert.equal(created.quantity, 12);
  await cell.press('Escape');
  const actual = page.locator('[data-material-id="created"] input.pg-in');
  await actual.waitFor();
  assert.equal(await actual.inputValue(), '1');
  assert.deepEqual(errors, []);
});

for (const kind of ['pipe', 'sheet']) test(kind + ': новый размер/формат, пропуски не додумываются, явный confirm и409 дубля', async t => {
  const { page, calls, errors } = await fixture(t, { kind, state: { failCreate: true } });
  await page.locator('[data-worker-create="new"]').click(); const entry = page.locator('[data-worker-entry]');
  await entry.getByRole('button', { name: 'Проверить', exact: true }).click(); await entry.getByText('Выберите категорию своей складской зоны.', { exact: true }).waitFor();
  assert.equal(writes(calls).length, 0);
  await entry.getByLabel('Категория', { exact: true }).selectOption(kind + '-cat'); await entry.getByLabel('Единица учёта', { exact: true }).fill(kind === 'pipe' ? 'м' : 'лист');
  if (kind === 'pipe') await entry.getByLabel('Вид сечения', { exact: true }).selectOption('round');
  await entry.getByRole('button', { name: 'Проверить', exact: true }).click(); await entry.getByText('Укажите положительные размеры в миллиметрах.', { exact: true }).waitFor();
  for (const [label, value] of kind === 'pipe' ? [['Диаметр, мм', '30'], ['Толщина, мм', '2'], ['Длина, мм', '6000']] : [['Толщина, мм', '4'], ['Ширина, мм', '1250'], ['Длина, мм', '2500']]) await entry.getByLabel(label, { exact: true }).fill(value);
  await entry.getByRole('button', { name: 'Проверить', exact: true }).click(); await entry.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await entry.getByText('Материал с таким названием уже есть', { exact: true }).waitFor();
  assert.equal(calls.filter(call => call.path === '/api/stock/batch').length, 0); assert.equal(await entry.isVisible(), true); assert.deepEqual(errors, []);
});

for (const kind of ['pipe', 'sheet']) test(kind + ': readonly/multiple не получают create/count обхода', async t => {
  const { page, calls } = await fixture(t, { kind, readOnly: true });
  assert.equal(await page.locator('[data-worker-create],input.pg-in').count(), 0); assert.equal(writes(calls).length, 0);
});

test('поздний ответ после ухода не возвращает подтверждение/фокус; черновики очищаются', async t => {
  const { page, calls, errors } = await fixture(t, { state: { delayCount: 150 } });
  const input = page.locator('[data-material-id="first"] input.pg-in'); await input.fill('3'); await input.press('Enter');
  await page.evaluate(() => { window.grid.destroy(); window.grid.el.remove(); const next = document.createElement('input'); next.id = 'next'; document.body.append(next); next.focus(); });
  await page.waitForTimeout(200); assert.equal(await page.evaluate(() => document.activeElement.id), 'next'); assert.equal(await confirm(page).count(), 0); assert.equal(writes(calls).length, 1); assert.deepEqual(errors, []);
});

for (const kind of ['pipe', 'sheet']) test(kind + ': context receive фильтрует список/recent/draft/прямойID, сохраняет глобальную зону', async t => {
  const { page, calls, errors } = await fixture(t, { kind, receive: true, materialId: 'foreign-zone', draft: [{ id: 'foreign-zone', qty: '3' }] });
  await page.getByLabel('Найти позицию', { exact: true }).focus(); await page.waitForTimeout(150);
  assert.equal(await page.locator('.sop-lines [data-id]').count(), 0);
  assert.equal(await page.getByText('Чужая зона', { exact: true }).count(), 0); assert.equal(await page.getByText('Чужой тип', { exact: true }).count(), 0);
  await page.getByLabel('Найти позицию', { exact: true }).fill('Неизвестный новый металл');
  assert.equal(await page.getByText(/Создать «/).count(), 0);
  assert.equal(await page.getByRole('button', { name: '+ Принять без счёта', exact: true }).count(), 0);
  await assert.rejects(() => page.evaluate(() => window.operation.read().values.save())); assert.equal(writes(calls).length, 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('dc-stock-zone-fixture')), 'unchanged');
  assert.ok(calls.some(call => call.path === '/api/stock/items' && call.query.zoneId === 'zone' && call.query.limit === '1000')); assert.deepEqual(errors, []);
});

test('scope допускает только pipe+свою категорию; общий picker сохраняет generic-create', async t => {
  const { page } = await fixture(t, { receive: true, common: true });
  const accepted = await page.evaluate(async () => {
    const { workerReceiveScope } = await import('/app/sections/stock-worker-scope.js'); const scope = workerReceiveScope({ workerZone: 'zone', workerKind: 'pipe' });
    const rows = await scope.items(); return rows.map(item => item.id);
  });
  assert.deepEqual(accepted.sort(), ['first', 'long', 'multiple', 'raw40', 'raw50', 'small', 'washedLong']);
  await page.getByRole('button', { name: '+ Принять без счёта', exact: true }).click();
  await page.getByLabel('Найти позицию', { exact: true }).focus(); await page.waitForTimeout(100);
  await page.getByLabel('Найти позицию', { exact: true }).fill('Совсем новая позиция'); await page.getByText('Создать «Совсем новая позиция»', { exact: true }).waitFor();
});

for (const kind of ['pipe', 'sheet']) test(kind + ': scoped draft/recent и подтверждённая приёмка используют только свой материал', async t => {
  const allowed = kind === 'pipe' ? 'first' : 'sheet';
  const { page, calls, errors } = await fixture(t, { kind, receive: true, draft: [{ id: 'foreign-zone', qty: '6' }, { id: 'foreign-type', qty: '7' }, { id: allowed, qty: '3' }] });
  await page.locator('.sop-lines [data-id="' + allowed + '"]').waitFor();
  assert.deepEqual(await page.locator('.sop-lines [data-id]').evaluateAll(nodes => nodes.map(node => node.dataset.id)), [allowed]);
  await page.evaluate(() => window.operation.read().values.save());
  const line = calls.find(call => call.path === '/api/stock/batch').body.lines[0];
  assert.deepEqual(line, { materialId: allowed, qty: 3 });
  assert.equal(await page.evaluate(() => localStorage.getItem('dc-stock-zone-fixture')), 'unchanged'); assert.deepEqual(errors, []);
});

test('ожидающий count не крадёт фокус/черновик другой ячейки', async t => {
  const { page, errors } = await fixture(t, { state: { delayCount: 150 } });
  const first = page.locator('[data-material-id="first"] input.pg-in'), next = page.locator('[data-material-id="small"] input.pg-in');
  await first.fill('3'); await first.press('Enter');
  await next.fill('17'); await next.evaluate(node => node.setSelectionRange(1, 1)); await page.waitForTimeout(200);
  assert.equal(await next.inputValue(), '17'); assert.equal(await next.evaluate(node => document.activeElement === node && node.selectionStart === 1), true); assert.deepEqual(errors, []);
});

test('уход во время create оставляет созданный0 без позднего автоматического count', async t => {
  const { page, calls, errors } = await fixture(t, { state: { delayCreate: 150 } });
  const cell = page.locator('[data-worker-create="cell"][title*="60×20×2"]').first();
  await cell.fill('3'); await cell.press('Enter');
  await page.evaluate(() => { window.grid.destroy(); window.grid.el.remove(); }); await page.waitForTimeout(200);
  assert.equal(calls.filter(call => call.path === '/api/stock/items' && call.method === 'POST').length, 1);
  assert.equal(calls.filter(call => call.path === '/api/stock/batch').length, 0); assert.deepEqual(errors, []);
});

test('заполнение пустой мытой ячейки кликом мимо поля не списывает остаток немытой', async t => {
  const { page, calls, errors, items } = await fixture(t);
  const cell = page.locator('[data-worker-create="cell"][title*="50×20×2"][title*="Мытая"]').first();
  await cell.fill('4'); await page.getByRole('heading', { name: 'Трубы', exact: true }).click();
  await page.locator('[data-material-id="created"]').waitFor();
  assert.deepEqual(calls.filter(call => call.path === '/api/stock/batch').map(call => call.body.lines), [[{ materialId: 'created', qty: 48, expected: 0 }]]);
  assert.equal(await page.locator('.pg-worker-confirm').count(), 0);
  assert.equal(items.find(item => item.id === 'raw50').quantity, 24); assert.deepEqual(errors, []);
});

test('пересчёт мытой трубы меняет только её остаток, даже если есть пара в немытой', async t => {
  const { page, calls, errors, items } = await fixture(t);
  const input = page.locator('[data-material-id="first"] input.pg-in');
  await input.fill('3'); await input.press('Enter');
  await input.locator('xpath=self::*[@data-saved]').waitFor();
  assert.deepEqual(calls.find(call => call.path === '/api/stock/batch').body.lines,
    [{ materialId: 'first', qty: 18, expected: 12 }]);
  assert.equal(items.find(item => item.id === 'first').quantity, 18);
  assert.equal(items.find(item => item.id === 'raw40').quantity, 2);
  assert.equal(await confirm(page).count(), 0);
  assert.deepEqual(errors, []);
});
