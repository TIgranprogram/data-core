import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';

const root = new URL('../', import.meta.url), origin = 'http://c240.test';
const samples = [
  { id: 'pipe-one', name: 'Труба профильная 40×20×2', metal: 'pipe', unit: 'м', sectionProfile: { shape: 'rect', label: '40×20×2', state: 'complete' }, assortment: '40×20×2', categoryName: 'Профильная труба', materialGrade: 'Ст3', washed: true, quantity: 12, reservedQty: 6, dims: { length: 6000, thickness: 2 } },
  { id: 'sheet-one', name: 'Лист Ст3 3 мм', metal: 'sheet', unit: 'лист', materialGrade: 'Ст3', quantity: 8, reservedQty: 2, notes: 'Проверено кладовщиком', dims: { thickness: 3, length: 2500, width: 1250 } },
];
let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, { user = { role: 'director', sections: ['stock'] }, view = 'pipe', theme = 'light' } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  t.after(() => page.close());
  const person = { id: 'c240-user', username: 'c240', displayName: 'Проверка экрана', canMoney: false, ...user };
  const records = structuredClone(samples).map(item => ({ countMode: 'single', ...item })), calls = [], errors = [];
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
      const body = route.request().postDataJSON(); calls.push({ path: url.pathname, method, body });
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: person });
      if (url.pathname === '/api/stock/zones') return route.fulfill({ json: { items: [{ id: 'pipe-zone', name: 'Трубы' }, { id: 'sheet-zone', name: 'Листовой материал' }] } });
      if (url.pathname === '/api/stock/categories') return route.fulfill({ json: { items: [{ id: 'pipe-cat', name: 'Профильная труба' }] } });
      if (url.pathname === '/api/supply/lookups') return route.fulfill({ json: { categories: [{ name: 'Профильная труба' }], units: ['м', 'лист'] } });
      if (url.pathname === '/api/stock/items') {
        if (method === 'POST') { const created = { id: 'created-pipe', ...body, countMode: 'single', quantity: 0, metal: 'pipe', photos: [] }; records.push(created); return route.fulfill({ json: created }); }
        const found = records.filter(item => !url.searchParams.get('zoneId') || item.metal === (url.searchParams.get('zoneId') === 'pipe-zone' ? 'pipe' : 'sheet'));
        return route.fulfill({ json: { items: found, total: found.length, page: 1, limit: 100 } });
      }
      if (url.pathname === '/api/stock/items/created-pipe') return route.fulfill({ json: records.find(item => item.id === 'created-pipe') });
      if (url.pathname === '/api/stock/batch') { const line = body.lines[0]; const item = records.find(row => row.id === line.materialId); if (item) item.quantity = line.qty; }
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
    await page.locator('table.list tbody tr').first().waitFor();
    assert.ok(await page.getByRole('link', { name: 'Экран «Труборез»', exact: true }).count());
    assert.ok(await page.getByRole('link', { name: 'Экран «Лазер лист»', exact: true }).count());
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

test('родной экран Трубореза: подтверждённый пересчёт в метрах и компактное создание', async t => {
  const { page, calls, errors } = await fixture(t, { user: { role: 'r-pipe', baseRole: 'manager', roleLabel: 'Труборез', sections: ['stock'], stockViews: ['sheet'] } });
  const field = page.locator('table input.pg-in').first(); await field.waitFor();
  await field.fill('3'); await field.press('Enter');
  await page.locator('[data-worker-count-confirm]').getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('table input.pg-in[data-saved]'));
  assert.deepEqual(calls.find(call => call.path === '/api/stock/batch').body.lines[0], { materialId: 'pipe-one', qty: 3, expected: 12 });
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
  const createdResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().includes('/api/stock/items?zoneId='));
  await entry.getByRole('button', { name: 'Сохранить', exact: true }).click(); await createdResponse;
  assert.equal(calls.filter(call => call.method === 'POST' && call.path === '/api/stock/items').length, 1);
  assert.deepEqual(calls.find(call => call.method === 'POST' && call.path === '/api/stock/items').body.dims, { width: 25, height: 25, thickness: 2, length: 6000 });
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
