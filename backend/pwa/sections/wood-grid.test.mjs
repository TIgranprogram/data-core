import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';

const root = new URL('../', import.meta.url);
const origin = 'http://wood.test';
const role = { role: 'r-wood', baseRole: 'manager', roleLabel: 'Деревообработка', sections: ['stock'], canMoney: false };
const samples = [
  { id: 'board', name: 'Доска сосновая', article: 'Д-01', categoryName: 'Дерево', unit: 'м', quantity: 24, reservedQty: 3, dims: { length: 3000, width: 100, thickness: 25 } },
  { id: 'ply', name: 'Фанера ФСФ', article: 'Ф-02', categoryName: 'Фанера', unit: 'лист', quantity: 6, reservedQty: 6, dims: { length: 1525, width: 1525, thickness: 12 } },
  { id: 'sheet', name: 'Лист МДФ', article: 'М-03', categoryName: 'Плиты', unit: 'м²', quantity: 10.5, reservedQty: 0, dims: { thickness: 16 } },
];
let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, { width = 1920, user = role, zone = true, items = samples, hash = '#stock' } = {}) {
  const page = await browser.newPage({ viewport: { width, height: width === 1920 ? 1080 : 1440 }, serviceWorkers: 'block' });
  t.after(() => page.close());
  const person = { id: 'test-wood', username: 'wood-test', displayName: 'Проверка', ...user };
  const calls = [], errors = [], records = structuredClone(items);
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(u => {
    localStorage.setItem('dca_user', JSON.stringify(u));
    localStorage.setItem('dca_access', 'local-fixture'); localStorage.setItem('dca_refresh', 'local-fixture');
  }, person);
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const pathname = url.pathname, method = route.request().method();
    if (pathname.startsWith('/api/')) {
      const query = Object.fromEntries(url.searchParams), body = route.request().postDataJSON();
      calls.push({ pathname, method, query, body });
      if (pathname === '/api/auth/me') return route.fulfill({ json: person });
      if (pathname === '/api/roles') return route.fulfill({ json: { items: [{ name: role.role, label: role.roleLabel,
        baseRole: role.baseRole, appSections: role.sections, moneyAccess: false }] } });
      if (pathname === '/api/stock/zones') return route.fulfill({ json: { items: zone ? [{ id: 'wood-zone', name: 'Деревообработка' }] : [] } });
      if (pathname === '/api/stock/items') {
        if (query.zoneId !== 'wood-zone' || query.held !== '1') return route.fulfill({ status: 403, json: {} });
        const found = records.filter(r => r.quantity > 0 && (r.name + r.article).toLowerCase().includes((query.search || '').toLowerCase()));
        return route.fulfill({ json: { items: found, total: found.length } });
      }
      if (pathname === '/api/stock/batch') {
        const line = body.lines[0]; records.find(r => r.id === line.materialId).quantity = line.qty;
      }
      return route.fulfill({ json: { items: [], counts: {}, metrics: {}, feed: [], week: [] } });
    }
    if (pathname === '/app/version.json') return route.fulfill({ json: { v: 'fixture' } });
    const path = pathname.slice('/app/'.length) || 'index.html';
    const type = { js: 'text/javascript', css: 'text/css', html: 'text/html', png: 'image/png', svg: 'image/svg+xml', woff2: 'font/woff2' }[path.split('.').pop()];
    if (!pathname.startsWith('/app/') || !type) return route.fulfill({ status: 404 });
    return route.fulfill({ contentType: type, body: await readFile(new URL(path, root)) });
  });
  await page.goto(origin + '/app/' + hash);
  return { page, calls, errors };
}

for (const width of [1920, 2560]) {
  test('Рабочая таблица и операции, ширина ' + width, async t => {
    const { page, calls, errors } = await fixture(t, { width });
    const table = page.getByRole('table', { name: 'Материалы деревообработки' });
    await table.waitFor();
    assert.equal(await table.locator('tbody tr').count(), 3);
    const plywood = table.getByRole('row').filter({ hasText: 'Фанера ФСФ' });
    assert.equal(await plywood.locator('td').nth(6).textContent(), '6');
    assert.equal(await plywood.locator('td').nth(7).textContent(), '0');
    assert.equal(await table.getByText(/Цена|Сумма|Стоимость/).count(), 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    if (process.env.C194_PROOF_DIR) {
      await page.screenshot({ path: process.env.C194_PROOF_DIR + '/wood-' + width + '.png', animations: 'disabled' });
    }
    const search = page.getByRole('textbox', { name: 'Найти материал' });
    await search.fill('Ф-02'); await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    const count = page.getByRole('textbox', { name: 'Фактически, Фанера ФСФ' });
    await count.fill('8'); await count.press('Enter');
    await page.waitForFunction(() => document.querySelector('tbody tr')?.children[7]?.textContent === '2');
    assert.deepEqual(calls.find(c => c.pathname === '/api/stock/batch').body.lines[0], { materialId: 'ply', qty: 8, expected: 6 });
    const note = page.getByRole('textbox', { name: 'Примечание, Фанера ФСФ' });
    await note.fill('Проверено'); await note.press('Enter');
    await page.waitForFunction(() => document.querySelector('input.pg-note.saved'));
    assert.deepEqual(calls.find(c => c.pathname === '/api/stock/items/ply').body, { notes: 'Проверено' });
    assert.ok(calls.filter(c => c.pathname === '/api/stock/items').every(c => c.query.held === '1' && c.query.zoneId === 'wood-zone'));
    assert.deepEqual(errors, []);
  });
}

test('Пустой остаток, роль только просмотра и недоступная зона', async t => {
  const read = await fixture(t, { user: { ...role, baseRole: 'user' } });
  await read.page.getByRole('table').waitFor();
  assert.equal(await read.page.locator('table input').count(), 0);
  const empty = await fixture(t, { items: [] });
  await empty.page.getByText('В зоне нет физических остатков').waitFor();
  const denied = await fixture(t, { zone: false, hash: '#stock?view=wood' });
  await denied.page.getByText('Зона «Деревообработка» недоступна').waitFor();
  assert.ok(!denied.calls.some(c => c.pathname === '/api/stock/items'));
});

test('Роли другого участка и мобильная роль сохраняют собственный старт', async t => {
  const other = await fixture(t, { user: { ...role, roleLabel: 'Лазер лист' }, hash: '#stock?view=wood' });
  await other.page.getByRole('heading', { name: 'Листы' }).waitFor();
  assert.ok(!other.calls.some(c => c.query.zoneId === 'wood-zone'));
  const mobile = await fixture(t, { user: { ...role, sections: ['stock-mobile'], roleLabel: 'Кладовщик дерева (телефон)' }, hash: '#stock?view=wood' });
  await mobile.page.locator('.shell.k-kiosk').waitFor();
  assert.equal(new URL(mobile.page.url()).hash, '#stock-mobile');
});

test('Администратор открывает рабочий экран и выбирает деревообработку в своём профиле', async t => {
  const { page } = await fixture(t, { user: { role: 'admin', sections: null }, hash: '#stock?view=wood' });
  await page.getByRole('heading', { name: 'Деревообработка' }).waitFor();
  assert.equal(await page.locator('.sidebar a[href="#stock?view=wood"]').count(), 1);
  await page.getByRole('button', { name: 'Профиль: Проверка' }).click();
  await page.getByText('Мой профиль', { exact: true }).click();
  const chooser = page.locator('select[aria-label="Смотреть как"]');
  await chooser.locator('option[value="r-wood"]').waitFor({ state: 'attached' });
  await chooser.selectOption('r-wood', { force: true });
  await page.locator('.view-as').getByText('Деревообработка', { exact: true }).waitFor();
  assert.equal(await page.locator('table input').count(), 0);
});
