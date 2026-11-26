import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';
import { workerCreateBody, workerCreateContext, workerQuickReady, workerWashCounterpart } from './stock-worker-model.js';

const origin = 'http://c270.test';
const pipe = (id, width = 40, extra = {}) => ({ id, materialId: id, name: 'Труба ' + id, metal: 'pipe', categoryId: 'pipe-cat', categoryName: 'Профильная труба', materialGrade: 'Ст3', unit: 'м', countMode: 'single', quantity: 12, reservedQty: 0, washed: true,
  sectionProfile: { shape: 'rect', state: 'complete', label: width + '×20×2', widthMm: width, heightMm: 20, wallMm: 2 }, dims: { length: 6000 }, ...extra });
const categories = [{ id: 'pipe-cat', name: 'Профильная труба' }, { id: 'sheet-cat', name: 'Листовой металл' }, { id: 'foreign-cat', name: 'Дерево' }];
const source = [pipe('first'), pipe('long', 40, { washed: false, dims: { length: 12000 } }), pipe('small', 50), pipe('multiple', 60, { countMode: 'multiple' }),
  pipe('raw40', 40, { washed: false, quantity: 5, dims: { length: 6000 } }), pipe('raw50', 50, { washed: false, quantity: 7, dims: { length: 12000 } }),
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
  const washed = pipe('washed', 40, { washed: true });
  assert.equal(workerWashCounterpart(washed, source)?.id, 'raw40');
  assert.equal(workerWashCounterpart({ ...washed, washed: false }, source), null);
  const quickContext = workerCreateContext(pipe('washed', 50), { length: 12000, washed: true });
  assert.equal(workerWashCounterpart(quickContext, source)?.id, 'raw50');
});

let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(t, { kind = 'pipe', readOnly = false, receive = false, materialId, draft, common = false, state = {} } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, serviceWorkers: 'block' }); t.after(() => page.close());
  const items = structuredClone(source), calls = [], errors = [];
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
const save = page => confirm(page).getByRole('button', { name: 'Сохранить', exact: true });

test('количество: blur/Отмена/Escape без POST; Enter подтверждает и единственная отправка в исходной unit', async t => {
  const { page, calls, errors } = await fixture(t, { state: { delayCount: 120 } });
  const input = page.locator('[data-material-id="first"] input.pg-in');
  await input.fill('3'); await input.press('Tab'); await confirm(page).waitFor(); assert.equal(writes(calls).length, 0);
  assert.ok((await confirm(page).textContent()).includes('12 → 3 м'));
  await confirm(page).getByRole('button', { name: 'Отмена', exact: true }).click(); assert.equal(await input.inputValue(), '12');
  await input.fill('7'); await input.press('Escape'); assert.equal(writes(calls).length, 0); assert.equal(await input.inputValue(), '12');
  await input.fill('3'); await input.press('Enter'); assert.equal(writes(calls).length, 0);
  await save(page).evaluate(node => { node.click(); node.click(); });
  await page.waitForFunction(() => document.querySelector('[data-material-id="first"] input[data-saved]'));
  assert.deepEqual(calls.find(call => call.path === '/api/stock/batch').body.lines[0], { materialId: 'first', qty: 3, expected: 12 });
  assert.equal(writes(calls).length, 1); assert.deepEqual(errors, []);
});

test('один pending на view; внешний reload сохраняет черновик/caret и frozen expected,409 не перезаписывает', async t => {
  const { page, calls, items, errors } = await fixture(t);
  const first = page.locator('[data-material-id="first"] input.pg-in'), second = page.locator('[data-material-id="small"] input.pg-in');
  await first.fill('8'); await first.press('Enter'); await second.fill('9'); await second.press('Enter');
  assert.equal(await confirm(page).count(), 1); assert.equal(await confirm(page).getAttribute('data-worker-count-confirm'), 'small');
  await first.focus(); await first.press('Enter'); await first.evaluate(node => node.setSelectionRange(1, 1));
  items.find(item => item.id === 'first').quantity = 40;
  await page.evaluate(() => window.grid.reload());
  assert.equal(await first.inputValue(), '8'); assert.equal(await first.evaluate(node => document.activeElement === node && node.selectionStart === 1), true);
  assert.ok((await confirm(page).textContent()).includes('12 → 8 м'));
  await save(page).click(); await confirm(page).getByText('Остаток изменился. Обновите данные.', { exact: true }).waitFor();
  assert.equal(calls.find(call => call.path === '/api/stock/batch').body.lines[0].expected, 12);
  assert.equal(items.find(item => item.id === 'first').quantity, 40); assert.equal(await first.inputValue(), '8');
  assert.equal(calls.some(call => call.body?.force), false);
  await confirm(page).getByRole('button', { name: 'Обновить остаток', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-material-id="first"] input.pg-in')?.value === '40'); assert.deepEqual(errors, []);
});

test('пустая координата: только количество в ячейке, форма не открывается, reload сохраняет черновик', async t => {
  const { page, calls, errors } = await fixture(t);
  const empty = page.locator('[data-worker-create="cell"]').first();
  assert.equal(await empty.evaluate(node => node.tagName), 'INPUT');
  assert.ok((await empty.getAttribute('title')).includes('40×20×2')); assert.ok((await empty.getAttribute('title')).includes('Мытая'));
  const key = await empty.getAttribute('data-worker-key');
  await empty.click(); await empty.fill('3');
  assert.equal(await page.locator('[data-worker-entry]').count(), 0); assert.equal(writes(calls).length, 0);
  await page.evaluate(() => window.grid.reload());
  const again = page.locator(`[data-worker-key="${key}"]`);
  await again.waitFor(); assert.equal(await again.inputValue(), '3');
  await again.press('Escape'); assert.equal(await again.inputValue(), '');
  assert.equal(writes(calls).length, 0); assert.deepEqual(errors, []);
});

test('пустая координата: createOnly с zone,3м не превращаются в штуки; count failure повторяет только count', async t => {
  const state = { failCount: true }, { page, calls, errors } = await fixture(t, { state });
  const cell = page.locator('[data-worker-create="cell"][title*="60×20×2"]').first();
  await cell.fill('3'); await cell.press('Enter');
  await page.locator('[data-worker-entry-error]:visible').waitFor();
  assert.equal(writes(calls).length, 2);
  state.failCount = false; await cell.press('Enter');
  await page.locator('[data-material-id="created"]').waitFor();
  const created = calls.filter(call => call.path === '/api/stock/items' && call.method === 'POST'); assert.equal(created.length, 1);
  assert.equal(created[0].query.zoneId, 'zone'); assert.equal(created[0].body.categoryId, 'pipe-cat'); assert.equal(created[0].body.unit, 'м');
  assert.deepEqual(created[0].body.dims, { width: 60, height: 20, thickness: 2, length: 6000 });
  assert.deepEqual(calls.filter(call => call.path === '/api/stock/batch').map(call => call.body.lines[0]), Array(2).fill({ materialId: 'created', qty: 3, expected: 0 }));
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
  const input = page.locator('[data-material-id="first"] input.pg-in'); await input.fill('3'); await input.press('Enter'); await save(page).click();
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
  await first.fill('3'); await first.press('Enter'); await save(page).click();
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

test('мытая ячейка предлагает списать остаток с немытой того же размера; отказ ничего не списывает', async t => {
  const { page, calls, errors, items } = await fixture(t);
  const cell = page.locator('[data-worker-create="cell"][title*="50×20×2"][title*="Мытая"]').first();
  await cell.fill('4'); await cell.press('Enter');
  const panel = page.locator('[data-worker-transfer]'); await panel.waitFor();
  assert.ok((await panel.textContent()).includes('В «Не мытая» 7 м. Списать 4 м?'));
  assert.equal(writes(calls).length, 0);
  await panel.getByRole('button', { name: 'Только добавить', exact: true }).click();
  await page.locator('[data-material-id="created"]').waitFor();
  assert.deepEqual(calls.filter(call => call.path === '/api/stock/batch').map(call => call.body.lines), [[{ materialId: 'created', qty: 4, expected: 0 }]]);
  assert.equal(items.find(item => item.id === 'raw50').quantity, 7); assert.deepEqual(errors, []);
});

test('подтверждение и списание: одна пачка меняет мытую и немытую, отказ оставляет немытую', async t => {
  const { page, calls, errors, items } = await fixture(t);
  const input = page.locator('[data-material-id="first"] input.pg-in');
  await input.fill('15'); await input.press('Enter');
  const panel = confirm(page);
  await panel.getByRole('button', { name: /Списать 3 м с «Не мытая»/ }).click();
  await page.waitForFunction(() => document.querySelector('[data-material-id="raw40"] .pg-in')?.value === '2');
  assert.deepEqual(calls.find(call => call.path === '/api/stock/batch').body.lines,
    [{ materialId: 'first', qty: 15, expected: 12 }, { materialId: 'raw40', qty: 2, expected: 5 }]);
  assert.equal(items.find(item => item.id === 'first').quantity, 15);
  assert.equal(items.find(item => item.id === 'raw40').quantity, 2);
  await page.locator('[data-material-id="small"] input.pg-in').fill('5');
  await page.locator('[data-material-id="small"] input.pg-in').press('Enter');
  assert.equal(await confirm(page).getByRole('button', { name: /с «Не мытая»/ }).count(), 0);
  assert.deepEqual(errors, []);
});
