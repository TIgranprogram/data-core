import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';

const root = new URL('../', import.meta.url), origin = 'http://c240.test';
const coordinatePath = '/api/stock/items/from-coordinate';
const samples = [
  { id: 'pipe-one', name: 'Труба профильная 40×20×2', metal: 'pipe', unit: 'м', sectionProfile: { shape: 'rect', label: '40×20×2', state: 'complete' }, assortment: '40×20×2', categoryId: 'pipe-cat', categoryName: 'Профильная труба', materialGrade: 'Ст3', washed: true, quantity: 12, reservedQty: 6, dims: { length: 6000, thickness: 2 } },
  { id: 'sheet-one', name: 'Лист Ст3 3 мм', metal: 'sheet', unit: 'лист', categoryId: 'sheet-cat', materialGrade: 'Ст3', quantity: 8, reservedQty: 2, notes: 'Проверено кладовщиком', dims: { thickness: 3, length: 2500, width: 1250 } },
];
let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, { user = { role: 'director', sections: ['stock'] }, view = 'pipe', theme = 'light', quickFailure = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  t.after(() => page.close());
  const person = { id: 'c240-user', username: 'c240', displayName: 'Проверка экрана', canMoney: false, ...user };
  const records = structuredClone(samples).map(item => ({ countMode: 'single', ...item })), calls = [], errors = [];
  if (quickFailure) records.push({ ...records[0], id: 'other-size', washed: false, dims: { length: 12000 },
    sectionProfile: { shape: 'rect', state: 'complete', label: '50×20×2', widthMm: 50, heightMm: 20, wallMm: 2 } });
  let rejected = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ person, theme }) => {
    localStorage.setItem('dc-theme', theme); localStorage.setItem('dca_user', JSON.stringify(person));
    localStorage.setItem('dca_access', 'fixture'); localStorage.setItem('dca_refresh', 'fixture');
    const add = EventTarget.prototype.addEventListener;
    window.c240Events = new WeakMap();
    EventTarget.prototype.addEventListener = function(type, ...args) {
      const names = window.c240Events.get(this) || []; names.push(type); window.c240Events.set(this, names);
      return add.call(this, type, ...args);
    };
  }, { person, theme });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const body = route.request().postDataJSON(); calls.push({ path: url.pathname, zoneId: url.searchParams.get('zoneId'), method, body });
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: person });
      if (url.pathname === '/api/stock/zones') return route.fulfill({ json: { items: [{ id: 'pipe-zone', name: 'Трубы' }, { id: 'sheet-zone', name: 'Листовой материал' }] } });
      if (url.pathname === '/api/stock/categories') return route.fulfill({ json: { items: url.searchParams.get('zoneId') === 'sheet-zone' ? [{ id: 'sheet-cat', name: 'Листовой материал' }] : [{ id: 'pipe-cat', name: 'Профильная труба' }] } });
      if (url.pathname === '/api/supply/lookups') return route.fulfill({ json: { categories: [{ name: 'Профильная труба' }], units: ['м', 'лист'] } });
      if (url.pathname === coordinatePath && method === 'POST') {
        const created = { id: 'created-pipe', ...body, countMode: 'single', quantity: 0, metal: 'pipe', photos: [] };
        records.push(created);
        return route.fulfill({ status: 201, json: created });
      }
      if (url.pathname === '/api/stock/items') {
        const found = records.filter(item => !url.searchParams.get('zoneId') || item.metal === (url.searchParams.get('zoneId') === 'pipe-zone' ? 'pipe' : 'sheet'));
        return route.fulfill({ json: { items: found, total: found.length, page: 1, limit: 100 } });
      }
      if (url.pathname === '/api/stock/items/created-pipe') return route.fulfill({ json: records.find(item => item.id === 'created-pipe') });
      if (url.pathname === '/api/stock/batch') {
        if (quickFailure && !rejected) { rejected = true; return route.fulfill({ status: 409, json: { message: 'Пересчёт не принят.' } }); }
        const line = body.lines[0]; const item = records.find(row => row.id === line.materialId);
        if (item) item.quantity = line.qty;
      }
      return route.fulfill({ json: { items: [], counts: {}, metrics: {}, feed: [], week: [] } });
    }
    if (url.pathname === '/app/version.json') return route.fulfill({ json: { v: 'fixture' } });
    const file = url.pathname.slice('/app/'.length) || 'index.html';
    const type = { js: 'text/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' }[file.split('.').pop()];
    if (!url.pathname.startsWith('/app/') || !type) return route.fulfill({ status: 404 });
    try { return route.fulfill({ contentType: type, body: await readFile(new URL(file, root)) }); } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto(origin + '/app/#stock?view=' + view);
  return { page, calls, errors };
}

for (const [view, theme] of [['pipe', 'light'], ['sheet', 'dark']]) {
  test('директор: ' + view + ' только для чтения, даже синтетические события не пишут', async t => {
    const { page, calls, errors } = await fixture(t, { view, theme });
    await page.locator('table [aria-label^="Фактически"]').first().waitFor();
    for (const [screen, label] of [['pipe', 'Экран «Труборез»'], ['sheet', 'Экран «Лазер лист»']]) {
      const link = page.locator(`a.side-link[href="#stock?view=${screen}"]`);
      await link.waitFor({ state: 'visible' });
      assert.equal(await link.locator('.lbl').textContent(), label);
    }
    const fields = page.locator('table input');
    assert.equal(await fields.count(), 0);
    const surfaces = page.locator('table [aria-label^="Фактически"], table [aria-label^="Примечание"]');
    assert.ok(await surfaces.count());
    assert.ok(await surfaces.evaluateAll(nodes => nodes.every(node => node.tagName === 'SPAN' && !(window.c240Events.get(node) || []).some(name => ['blur', 'keydown', 'change', 'input'].includes(name)))));
    if (view === 'sheet') assert.equal(await page.getByLabel('Примечание, Лист Ст3 3 мм', { exact: true }).textContent(), 'Проверено кладовщиком');
    await page.getByRole('textbox', { name: 'Найти материал', exact: true }).fill(view === 'pipe' ? '40×20×2' : 'Ст3 3');
    assert.equal(await page.locator('table.list tbody tr:not(.pg-worker-detail)').count(), 1);
    if (process.env.C240_PROOF_DIR) { await mkdir(process.env.C240_PROOF_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.C240_PROOF_DIR, view + '-director-' + theme + '.png'), fullPage: true }); }
    await surfaces.evaluateAll(nodes => nodes.forEach(node => {
      node.value = '999';
      for (const type of ['input', 'change', 'focus', 'blur']) node.dispatchEvent(new Event(type, { bubbles: true }));
      for (const key of ['Enter', 'Tab', 'ArrowDown']) node.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }));
    await page.waitForTimeout(100);
    assert.deepEqual(calls.filter(call => !['GET', 'HEAD'].includes(call.method)), []);
    assert.deepEqual(errors, []);
  });
}

test('родной экран Трубореза: пересчёт по Enter с записью в метрах и компактное создание', async t => {
  const { page, calls, errors } = await fixture(t, { user: { role: 'r-pipe', baseRole: 'manager', roleLabel: 'Труборез', sections: ['stock'], stockViews: ['sheet'] } });
  const field = page.locator('table input.pg-in').first(); await field.waitFor();
  const counted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/api/stock/batch'));
  await field.fill('3'); await field.press('Enter'); await counted;
  assert.equal(await page.locator('[data-worker-count-confirm]').count(), 0);
  assert.deepEqual(calls.find(call => call.path === '/api/stock/batch').body.lines[0], { materialId: 'pipe-one', qty: 18, expected: 12 });
  await page.getByRole('button', { name: 'Добавить материал', exact: true }).click();
  const entry = page.locator('[data-worker-entry]'); await entry.getByLabel('Единица учёта', { exact: true }).waitFor();
  assert.equal(await page.locator('aside.drawer').count(), 0);
  await entry.getByLabel('Категория', { exact: true }).selectOption('pipe-cat');
  await entry.getByLabel('Вид сечения', { exact: true }).selectOption('rect');
  await entry.getByLabel('Единица учёта', { exact: true }).fill('м');
  await entry.getByLabel('Ширина, мм', { exact: true }).fill('25');
  await entry.getByLabel('Высота, мм', { exact: true }).fill('25');
  await entry.getByLabel('Толщина, мм', { exact: true }).fill('2');
  await entry.getByLabel('Длина, мм', { exact: true }).fill('6000');
  await entry.getByRole('button', { name: 'Проверить', exact: true }).click();
  const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === coordinatePath);
  await entry.getByRole('button', { name: 'Сохранить', exact: true }).click(); await createdResponse;
  const createCalls = calls.filter(call => call.method === 'POST' && call.path === coordinatePath);
  assert.equal(createCalls.length, 1);
  assert.equal(createCalls[0].zoneId, 'pipe-zone');
  assert.equal(createCalls[0].body.kind, 'pipe');
  assert.deepEqual(createCalls[0].body.dims, { width: 25, height: 25, thickness: 2, length: 6000 });
  assert.deepEqual(errors, []);
});

for (const [view, roleLabel] of [['pipe', 'Труборез'], ['sheet', 'Лазер лист']]) test(roleLabel + ': приёмка открывается через main/router, чужая зона не даёт форму', async t => {
  const { page, calls, errors } = await fixture(t, { view, user: { role: 'r-' + view, baseRole: 'manager', roleLabel, sections: ['stock'] } });
  await page.locator('[data-material-id]').first().waitFor();
  await page.getByRole('button', { name: 'Принять на склад', exact: true }).click();
  const search = page.locator('aside.drawer input[aria-label="Найти позицию"]');
  await search.waitFor({ state: 'attached', timeout: 5000 });
  await page.locator('aside.drawer').getByText(/Приёмка: только/).waitFor({ timeout: 5000 });
  assert.match(await page.evaluate(() => location.hash), new RegExp('workerZone=' + view + '-zone'));
  const foreign = view === 'pipe' ? 'sheet-zone' : 'pipe-zone';
  await page.evaluate(zone => { location.hash = location.hash.replace(/workerZone=[^&]+/, 'workerZone=' + zone); }, foreign);
  await page.locator('aside.drawer').getByText('Зона приёмки не относится к этому рабочему экрану.', { exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await search.count(), 0);
  assert.deepEqual(calls.filter(call => call.method === 'POST' && call.path.startsWith('/api/stock')), []);
  assert.deepEqual(errors, []);
});

test('main: событие create не убирает подсказку частичного успеха; Enter повторяет только count', async t => {
  const { page, calls, errors } = await fixture(t, { quickFailure: true, user: { role: 'r-pipe', baseRole: 'manager', roleLabel: 'Труборез', sections: ['stock'] } });
  const cell = page.locator('input[data-worker-create="cell"][title*="50×20×2"][title$="6 м"]').first();
  await cell.fill('2'); await cell.press('Enter');
  const partial = page.getByText('Материал создан, количество не сохранено. Enter — повторить. Escape — обновить таблицу.', { exact: true });
  await partial.waitFor();
  await page.waitForTimeout(450); // больше окна debounce dc:changed
  assert.equal(await partial.isVisible(), true);
  assert.equal(await cell.inputValue(), '2');
  await cell.press('Enter');
  await page.locator('[data-material-id="created-pipe"]').waitFor();
  assert.equal(calls.filter(call => call.method === 'POST' && call.path === coordinatePath).length, 1);
  assert.deepEqual(calls.filter(call => call.path === '/api/stock/batch').map(call => call.body.lines[0]),
    Array(2).fill({ materialId: 'created-pipe', qty: 12, expected: 0 }));
  assert.deepEqual(errors, []);
});

test('рабочий фон переключает котиков и собачек без перезагрузки', async t => {
  const { page, errors } = await fixture(t, { user: { role: 'r-pipe', baseRole: 'manager', roleLabel: 'Труборез', sections: ['stock'] } });
  await page.locator('canvas.cat-rain').waitFor({ state: 'attached' });
  const switched = await page.evaluate(async () => {
    const { startRain, stopRain } = await import('/app/ui/cat-rain.js');
    const cat = document.querySelector('canvas.cat-rain');
    startRain('cats');
    const sameCat = cat === document.querySelector('canvas.cat-rain');
    startRain('dogs');
    const dog = document.querySelector('canvas.cat-rain');
    const changed = !cat.isConnected && dog?.isConnected;
    startRain('dogs');
    const sameDog = dog === document.querySelector('canvas.cat-rain');
    stopRain();
    return [sameCat, changed, sameDog, document.querySelectorAll('canvas.cat-rain').length];
  });
  assert.deepEqual(switched, [true, true, true, 0]);
  assert.deepEqual(errors, []);
});

test('«Смотреть как» открывает обе рабочие сетки без элементов записи', async t => {
  const { page, calls, errors } = await fixture(t, { user: { role: 'admin', sections: [] } });
  await page.locator('.pg-worker-pipe input.pg-in').waitFor();
  for (const [view, label] of [['pipe', 'Труборез'], ['sheet', 'Лазер лист']]) {
    const selected = await page.evaluate(async ({ view, label }) => {
      const { rememberRoles, setViewAs } = await import('/app/core/view-as.js');
      rememberRoles([{ name: 'r-' + view, label, baseRole: 'manager', appSections: ['stock'] }]);
      const selected = setViewAs('r-' + view);
      location.hash = '#stock?view=' + view;
      return selected;
    }, { view, label });
    assert.equal(selected, true);
    await page.locator('.view-as').getByText(label, { exact: true }).waitFor();
    await page.locator('.pg-worker-' + view + ' [data-material-id]').first().waitFor();
    assert.equal(await page.locator('.pg-worker-' + view + ' input').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Принять на склад', exact: true }).count(), 0);
  }
  assert.deepEqual(calls.filter(call => call.method !== 'GET'), []);
  assert.deepEqual(errors, []);
});

test('родной Лазер лист сохраняет количество и примечание; admin сохраняет редактирование', async t => {
  for (const user of [{ role: 'r-sheet', baseRole: 'manager', roleLabel: 'Лазер лист', sections: ['stock'], stockViews: ['pipe'] }, { role: 'admin', sections: [], stockViews: [] }]) {
    const { page, calls, errors } = await fixture(t, { user, view: 'sheet' });
    const amount = page.getByLabel('Фактически, Лист Ст3 3 мм, лист', { exact: true }); await amount.waitFor();
    assert.equal(await amount.evaluate(node => node.readOnly), false);
    await amount.fill('9'); await amount.press('Enter');
    await page.locator('[data-worker-count-confirm]').getByRole('button', { name: 'Сохранить', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('table input.pg-in[data-saved]'));
    const note = page.getByLabel('Примечание, Лист Ст3 3 мм', { exact: true });
    await note.fill('Сверено'); await note.press('Enter');
    await page.waitForFunction(() => document.querySelector('input.pg-note[data-saved]'));
    assert.equal(calls.find(call => call.path === '/api/stock/batch').body.lines[0].qty, 9);
    assert.deepEqual(calls.find(call => call.method === 'PATCH' && call.path === '/api/stock/items/sheet-one').body, { notes: 'Сверено' });
    assert.deepEqual(errors, []);
  }
});
