import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const app = new URL('../../backend/pwa/', import.meta.url);
const origin = 'http://127.0.0.1:41739';
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const id = n => String(n).padStart(24, '0');
const article = (n, name, values, children = [], type = 'expense') => ({
  id: id(n), name, values, total: values.reduce((sum, value) => sum + value, 0), children, type,
});
const steel = article(13, 'Стальной профиль', [45000, 138500]);
const stock = article(12, 'Металлопрокат', [45000, 138500], [steel]);
const supplies = article(11, 'Материалы и комплектация', [45000, 138500], [stock]);
const labor = article(14, 'Услуги исполнителей', [0, 32600]);
const income = article(21, 'Оплаты заказов', [165000, 275000], [], 'income');
const order = { id: id(72), productionNo: '18-25', orderNo: '18/25', customer: 'Городской парк' };
const position = { id: id(73), label: 'Поз. 4 · Ограждение парковое' };
const employee = { id: id(74), label: 'Анна Орлова' };
const facets = { people: [employee], orderLines: [position] };
const factual = [
  { id: id(101), operationId: 'invoice:demo:1', date: '2025-11-14', type: 'expense', amount: 138500, title: 'Труба 40 × 40, поставка № 48',
    companyName: 'Прометей', counterpartyName: 'Металл Сервис', source: 'invoice', invoiceId: id(87), doc: 'счёт 48', articlePath: [supplies.name, stock.name, steel.name] },
  { id: id(102), operationId: 'request:demo:2', date: '2025-10-09', type: 'expense', amount: 45000, title: 'Стальной профиль для ограждения',
    companyName: 'Прометей', counterpartyName: 'Металл Сервис', source: 'request', doc: 'счёт 35', articlePath: [supplies.name, stock.name, steel.name] },
  { id: id(103), operationId: 'expense:demo:3', date: '2025-11-18', type: 'expense', amount: 32600, title: 'Монтаж ограждения',
    companyName: 'Прометей', counterpartyName: 'Бригада монтажа', source: 'expense', doc: 'акт 11', articlePath: [labor.name] },
  { id: id(104), operationId: 'income:demo:4', date: '2025-11-14', type: 'income', amount: 275000, title: 'Оплата за ограждение',
    companyName: 'Прометей', counterpartyName: 'Городской парк', source: 'income', doc: 'заказ 18/25', articlePath: [income.name] },
];
const monthView = '#money?from=2025-10-01&to=2025-11-30';
async function mount(browser, theme, width) {
  const user = { id: id(1), username: 'Учебная учётная запись', role: 'accountant' };
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  await context.addInitScript(({ user, theme }) => {
    localStorage.setItem('dc-theme', theme);
    for (const key of ['dca_access', 'dca_refresh']) sessionStorage.setItem(key, 'fixture');
    sessionStorage.setItem('dca_user', JSON.stringify(user));
  }, { user, theme });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const queries = [], errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url()), q = url.searchParams;
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/app/')) {
      const file = url.pathname.slice(5) || 'index.html';
      try { return route.fulfill({ contentType: mime[extname(file)] || 'application/octet-stream', body: await readFile(new URL(file, app)) }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; return route.fulfill({ status: 404 }); }
    }
    if (request.method() !== 'GET') return route.fulfill({ status: 409 });
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: user });
    if (url.pathname === '/api/finance/settings') return route.fulfill({ json: { startDate: '2025-09-01', companies: ['Прометей'], openingBalance: { Прометей: 140000 } } });
    if (url.pathname === '/api/financial-articles') return route.fulfill({ json: { items: [supplies, labor, income] } });
    if (url.pathname === '/api/incomes/lookups') return route.fulfill({ json: { companies: [{ id: id(89), name: 'Прометей' }] } });
    if (url.pathname === '/api/salesorders/lookup') return route.fulfill({ json: { items: [order] } });
    if (url.pathname === '/api/finance/by-articles') {
      queries.push(Object.fromEntries(q));
      return route.fulfill({ json: {
        months: ['2025-10', '2025-11'], facets,
        articleRows: [supplies, labor, income],
        head: { income: [165000, 275000], expense: [45000, 171100], profit: [120000, 103900], totals: { income: 440000, expense: 216100, profit: 223900 } },
        incomeRows: [{ id: 'cp:Городской парк', name: 'Городской парк', values: [165000, 275000], total: 440000,
          children: [{ id: 'ord:заказ 18/25', name: 'заказ 18/25', values: [165000, 275000], total: 440000 }] }],
      } });
    }
    if (url.pathname === '/api/finance/operations') {
      queries.push(Object.fromEntries(q));
      const items = factual.filter(row => (q.get('articleId') !== steel.id || row.articlePath.includes(steel.name)) && (!q.get('type') || row.type === q.get('type')) && (!q.get('from') || row.date >= q.get('from'))
        && (!q.get('to') || row.date <= q.get('to')) && (!q.get('doc') || row.doc === q.get('doc')));
      return route.fulfill({ json: { items, facets, total: items.length, page: 1, limit: 20, totals: { income: 440000, expense: 216100, net: 223900 } } });
    }
    if (url.pathname === '/api/finance/cashflow') {
      return route.fulfill({ json: {
        startDate: '2025-09-01', companies: ['Прометей'], totals: { opening: 260000, income: 275000, expense: 171100, closing: 363900 },
        days: [
          { date: '2025-11-13', income: 0, expense: 0, closing: 260000, ops: [] },
          { date: '2025-11-14', income: 275000, expense: 138500, closing: 396500, ops: [factual[0], factual[3]] },
          { date: '2025-11-18', income: 0, expense: 32600, closing: 363900, ops: [factual[2]] },
        ],
      } });
    }
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto(origin + '/app/' + monthView);
  try { await page.getByRole('table', { name: 'Доходы и расходы по статьям' }).waitFor(); } catch (error) { throw new Error(await page.locator('body').innerText() + '\n' + errors.join('\n'), { cause: error }); }
  return { page, close: () => context.close(), queries, errors };
}

async function proof(page, name) {
  const output = process.env.C219_EVIDENCE;
  if (!output) return;
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: join(output, name), fullPage: true });
}

test('C219 раскрывает каскад и факты под выбранной ячейкой, не меняя адрес', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const { page, queries, errors, close } = await mount(browser, 'light', 1920);
    const before = page.url();
    await page.getByRole('button', { name: supplies.name, exact: true }).click();
    await page.getByRole('button', { name: stock.name, exact: true }).click();
    const selected = page.locator('[data-id="' + steel.id + '"]');
    await selected.getByRole('button', { name: /Ноябрь 2025/ }).press('Enter');
    const operations = selected.locator('+ .k-tree-ins');
    await operations.getByText('Труба 40 × 40, поставка № 48').waitFor();
    assert.equal(await operations.getByText('Стальной профиль для ограждения').count(), 0);
    assert.equal(await operations.getByText('Монтаж ограждения').count(), 0);
    assert.equal(page.url(), before);
    assert.deepEqual(queries.at(-1), { from: '2025-11-01', to: '2025-11-30', type: 'expense', articleId: steel.id, includeDescendants: '1', page: '1', limit: '20' });
    const staticCell = page.locator('[data-id="result"] td.day').first();
    assert.equal(await staticCell.getAttribute('tabindex'), null);
    const staticColor = () => staticCell.evaluate(el => getComputedStyle(el).backgroundColor);
    const color = await staticColor();
    await staticCell.hover();
    assert.equal(await staticColor(), color);
    await proof(page, 'articles-light-1920.png');
    await page.keyboard.press('Escape');
    await operations.waitFor({ state: 'detached' });
    await selected.getByRole('button', { name: steel.name, exact: true }).click();
    await operations.getByText('Стальной профиль для ограждения').waitFor();
    assert.equal(page.url(), before);
    await page.getByRole('button', { name: 'Свернуть всё', exact: true }).click();
    await operations.waitFor({ state: 'detached' });

    await page.getByRole('button', { name: 'Заказчики и заказы', exact: true }).click();
    const customer = page.getByRole('button', { name: 'Городской парк', exact: true });
    await page.locator('[data-id="cp:Городской парк"]').waitFor({ state: 'attached' });
    if (!await customer.isVisible()) await page.getByRole('button', { name: 'Доходы', exact: true }).click();
    await customer.click();
    await page.getByRole('button', { name: 'заказ 18/25', exact: true }).click();
    await page.getByText('Оплата за ограждение', { exact: true }).waitFor();
    assert.equal(queries.at(-1).doc, 'заказ 18/25');
    assert.equal(queries.at(-1).counterparty, 'Городской парк');
    assert.equal(queries.at(-1).salesOrderId, undefined);
    assert.ok(!page.url().includes('view=operations'));
    assert.deepEqual(errors, []);
    await close();
  } finally { await browser.close(); }
});

test('C219 фильтрует заказ, позицию и сотрудника и раскрывает платежи внутри даты', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const { page, queries, errors, close } = await mount(browser, 'dark', 1440);
    const tools = page.locator('.filter-tools').first();
    const width = await tools.getByRole('group', { name: 'Вид финансовой таблицы' }).evaluate(el => el.getBoundingClientRect().width);
    assert.ok(width < 350);
    await page.getByRole('button', { name: /^Фильтры/ }).click();
    const orders = page.getByRole('combobox', { name: 'Заказ', exact: true });
    await orders.selectOption('order:18-25');
    await page.waitForFunction(() => location.hash.includes('productionNo=18-25'));
    await page.getByRole('combobox', { name: 'Позиция заказа', exact: true }).selectOption(position.id);
    await page.getByRole('combobox', { name: 'Сотрудник', exact: true }).selectOption(employee.id);
    await page.getByRole('button', { name: 'Операции', exact: true }).click();
    await page.getByRole('table', { name: 'Фактические денежные операции' }).waitFor();
    assert.equal(queries.at(-1).productionNo, '18-25');
    assert.equal(queries.at(-1).salesOrderLineId, position.id);
    assert.equal(queries.at(-1).personId, employee.id);
    const from = await page.getByLabel('С даты', { exact: true }).boundingBox();
    const to = await page.getByLabel('По дату', { exact: true }).boundingBox();
    await proof(page, 'filters-dark-1440.png');
    assert(from && to && Math.abs(from.y - to.y) < 5, JSON.stringify({ from, to }));
    await page.goto(origin + '/app/#money?tab=calendar&month=2025-11');
    const table = page.getByRole('table', { name: 'Платежи по дням', exact: true });
    await table.waitFor();
    assert.equal(await table.getByText('13.11.2025', { exact: true }).count(), 0);
    const toggle = table.getByRole('button', { name: '14.11.2025 · 2', exact: true });
    await toggle.press('Enter');
    await table.getByText('Оплата за ограждение', { exact: true }).waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await table.locator('tr:has(> td) + tr#fin-day-2025-11-14').count(), 1);
    await proof(page, 'daily-dark-1440.png');
    await table.getByRole('button', { name: '18.11.2025 · 1', exact: true }).click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await table.getByText('Монтаж ограждения', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await close();
  } finally { await browser.close(); }
});
