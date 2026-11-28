import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import test, { after, before } from 'node:test';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';

const origin = 'http://localhost:4280';
const assets = new URL('../', import.meta.url);
const list = '/api/supply/requests';
const material = (id, name, unit, article, categoryName) => ({
  id: '00000000000000000000000' + id, materialId: '00000000000000000000000' + id,
  name, unit, article, categoryName, category: categoryName,
});
const stock = [
  { ...material(1, 'Балка 10', 'м', '00010', 'Металл'), materialGrade: 'Ст3', quantity: 7 },
  { ...material(2, 'Швеллер 12', 'м', '00012', 'Металл'), materialGrade: '09Г2С', quantity: 0 },
  material(3, 'Винт М6', 'шт', '00006', 'Крепёж'),
];
const profile = 'Ø21,3×3 (ВГП 15)';
function stockPipe(id, washed, quantity, lengthM) {
  const name = 'Труба круглая ' + profile + (washed ? ', мытая' : ', не мытая') + ', ' + lengthM + ' м';
  return {
    ...material(id, name, 'м', 'СКЛ-' + id, 'Круглая труба'),
    metal: 'pipe', typeName: 'Круглая труба', assortment: 'Труба ' + profile, materialGrade: 'Ст3',
    sectionProfile: { shape: 'round', label: 'Ø21,3×3', state: 'complete' },
    washed, quantity, free: quantity, dims: { diameter: 21.3, thickness: 3, length: lengthM * 1000 },
  };
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const items = (rows) => ({ items: rows, total: rows.length, page: 1, limit: 100, counts: {}, facets: {} });
let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, { role = 'manager', requestCartCreate = true, theme = 'light', loseFirstResponse = false, catalog = stock } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  t.after(() => page.close());
  page.setDefaultTimeout(7000);
  const requests = new Map(), posts = [], patches = [], errors = [];
  const user = { id: 'c280-user', role, requestCartCreate, displayName: 'Проверка корзины', sections: ['requests'], canMoney: false };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ user, theme }) => {
    localStorage.setItem('dc-theme', theme);
    localStorage.setItem('dca_user', JSON.stringify(user));
    localStorage.setItem('dca_access', 'synthetic');
    localStorage.setItem('dca_refresh', 'synthetic');
  }, { user, theme });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    const path = url.pathname;
    if (url.origin !== origin) return route.abort();
    if (path.startsWith('/app/')) {
      const file = path.slice(5) || 'index.html';
      try { return await route.fulfill({ contentType: mime[extname(file)] || 'application/octet-stream', body: await readFile(new URL(file, assets)) }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; return route.fulfill({ status: 404 }); }
    }
    if (path === '/api/auth/me') return route.fulfill({ json: user });
    if (path.startsWith('/api/stock/items/') && req.method() === 'PATCH') {
      const id = path.slice('/api/stock/items/'.length), body = req.postDataJSON();
      patches.push({ id, body });
      const material = catalog.find(row => row.materialId === id);
      if (!material) return route.fulfill({ status: 404 });
      material.dims = { ...material.dims, ...body.dims };
      return route.fulfill({ json: material });
    }
    if (path === '/api/stock/lookup') {
      const q = (url.searchParams.get('search') || url.searchParams.get('q') || '').toLowerCase();
      return route.fulfill({ json: items(catalog.filter(row => (row.name + ' ' + row.article).toLowerCase().includes(q))) });
    }
    if (path === '/api/supply/lookups') return route.fulfill({ json: { suppliers: [], categories: [], requestedBy: [], companies: [] } });
    if (path === list + '/bulk' && req.method() === 'POST') {
      const body = req.postDataJSON();
      posts.push(body);
      const first = loseFirstResponse && posts.length === 1;
      const rows = (first ? body.items.slice(0, 1) : body.items).map(line => {
        const key = body.clientUid + ':' + line.materialId;
        if (!requests.has(key)) {
          const product = catalog.find(item => item.materialId === line.materialId);
          requests.set(key, { id: 'request-' + (requests.size + 1), status: 'requested', title: product.name, qty: line.qty, unit: product.unit });
        }
        return requests.get(key);
      });
      if (first) return route.fulfill({ status: 500, json: { message: 'Ответ потерян после записи первой строки' } });
      return route.fulfill({ status: 201, json: items(rows) });
    }
    if (path === list) {
      const status = url.searchParams.get('status');
      const rows = [...requests.values()].filter(row => !status || status.split(',').includes(row.status));
      return route.fulfill({ json: items(rows) });
    }
    return route.fulfill({ json: items([]) });
  });
  await page.goto(origin + '/app/#requests');
  return { page, requests, posts, patches, errors };
}

async function enter(page) {
  await page.getByRole('button', { name: 'Из каталога', exact: true }).click();
  return page.getByRole('dialog');
}

const add = (panel, item) => panel.getByRole('button', { name: 'В корзину: ' + item.name, exact: true }).click();
const quantity = (panel, item) => panel.getByLabel('Количество: ' + item.name, { exact: true });
const btn = (panel, name) => panel.getByRole('button', { name, exact: true });
async function shot(page, file) {
  const dir = process.env.C280_EVIDENCE;
  if (!dir) return;
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: join(dir, file + '.png'), animations: 'disabled' });
}

async function sheetFrom(download) {
  assert.match(download.suggestedFilename(), /\.xlsx$/);
  const bytes = await readFile(await download.path());
  for (let i = 0; bytes.readUInt32LE(i) === 0x04034b50;) {
    const size = bytes.readUInt32LE(i + 18), nameLength = bytes.readUInt16LE(i + 26);
    const start = i + 30 + nameLength + bytes.readUInt16LE(i + 28);
    if (bytes.toString('utf8', i + 30, i + 30 + nameLength) === 'xl/worksheets/sheet1.xml') {
      return bytes.toString('utf8', start, start + size);
    }
    i = start + size;
  }
  assert.fail('Лист XLSX отсутствует');
}

for (const role of ['manager', 'director', 'user']) test('C280: каталог, корзина, Excel и создание заявок — ' + role, async t => {
  const { page, requests, posts, errors } = await fixture(t, { role });
  const panel = await enter(page);
  assert.equal(await panel.getByRole('table').count(), 0);
  await panel.getByRole('button', { name: /^Металл/ }).click();
  assert.equal(await panel.getByRole('table').count(), 0);
  await panel.getByRole('button', { name: /^Балка/ }).click();
  const search = panel.getByLabel('Поиск по каталогу', { exact: true });
  await search.fill('00010');
  await btn(panel, 'В корзину: ' + stock[0].name).waitFor();
  await search.fill('не найдено');
  await btn(panel, 'В корзину: ' + stock[0].name).waitFor({ state: 'hidden' });
  await search.fill('');
  await btn(panel, 'Подкатегории: Металл').click();
  await btn(panel, 'Все позиции категории').click();
  await panel.getByLabel('Сортировка').selectOption('-name');
  assert.match(await panel.getByRole('table').locator('tbody tr').first().innerText(), /Швеллер/);
  await panel.getByLabel('Марка').selectOption('Ст3');
  assert.equal(await panel.getByRole('table').locator('tbody tr').count(), 1);
  await panel.getByLabel('Наличие').selectOption('out');
  await panel.getByText('Ничего не найдено', { exact: true }).waitFor();
  await btn(panel, 'Сбросить фильтры').click();
  await quantity(panel, stock[0]).fill('2');
  await add(panel, stock[0]);
  await quantity(panel, stock[0]).fill('3');
  await add(panel, stock[0]);
  await add(panel, stock[1]);
  await btn(panel, 'Все категории').click();
  await panel.getByRole('button', { name: /^Крепёж/ }).click();
  await btn(panel, 'Все позиции категории').click();
  await add(panel, stock[2]);
  await shot(page, 'catalog-light');
  await btn(panel, 'Корзина (3)').click();
  assert.equal(await quantity(panel, stock[0]).inputValue(), '5');
  await quantity(panel, stock[0]).fill('4.5');
  await quantity(panel, stock[0]).blur();
  await btn(panel, 'Убрать: ' + stock[1].name).click();
  await btn(panel, 'К каталогу').click();
  await btn(panel, 'Корзина (2)').click();
  assert.equal(await quantity(panel, stock[0]).inputValue(), '4.5');
  assert.equal(await quantity(panel, stock[1]).count(), 0);
  await shot(page, 'basket-light');
  const download = page.waitForEvent('download');
  await btn(panel, 'Скачать Excel').click();
  const xml = await sheetFrom(await download);
  assert.ok(xml.indexOf(stock[0].name) < xml.indexOf(stock[2].name));
  assert.match(xml, /<c r="\w+2" t="inlineStr"><is><t[^>]*>00010<\/t>/);
  assert.match(xml, /<c r="\w+2"><v>4\.5<\/v><\/c>/);
  assert.doesNotMatch(xml, /Швеллер 12|Цена|Сумма/);
  assert.equal(posts.length, 0);
  await btn(panel, 'Создать заявки').click();
  await panel.waitFor({ state: 'hidden' });
  assert.ok(posts[0].clientUid);
  assert.deepEqual(posts[0].items, [{ materialId: stock[0].materialId, qty: 4.5 }, { materialId: stock[2].materialId, qty: 1 }]);
  assert.deepEqual([...requests.values()].map(row => row.status), ['requested', 'requested']);
  await page.getByText(stock[0].name, { exact: true }).first().waitFor();
  assert.deepEqual(errors, []);
});

for (const role of ['user', 'director']) test('C280: выключенное право скрывает корзину — ' + role, async t => {
  const { page, posts } = await fixture(t, { role, requestCartCreate: false });
  await page.getByRole('heading', { name: 'Заявки', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Из каталога', exact: true }).count(), 0);
  await page.evaluate(() => { location.hash = 'requests?of=requestcart&new=1'; });
  await page.waitForFunction(() => !new URLSearchParams(location.hash.split('?')[1]).has('new'));
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(posts, []);
});

test('C280: один сортамент, остатки по мойке и закупка целыми трубами через корзину', async t => {
  const raw = stockPipe(5, false, 24, 4);
  const catalog = [stockPipe(4, true, 12, 4), raw, stockPipe(6, true, 8, 2), stockPipe(7, false, 10, 2)];
  for (const item of catalog) item.reservedQty = 0;
  catalog[0].reservedQty = 4;
  raw.reservedQty = 8;
  catalog[0].openPurchases = [{ status: 'ordered', qty: 8, unit: 'м' }, { status: 'requested', qty: 1, unit: 'м' }];
  raw.openPurchases = [{ status: 'ordered', qty: 4, unit: 'м' }, { status: 'requested', qty: 2, unit: 'м' }];
  raw.openPurchases.push({ status: 'ordered', qty: 9, unit: 'м', paid: true });
  catalog[0].lastPurchase = { date: '2026-11-23', num: 432 };
  raw.lastPurchase = { date: '2026-11-25', num: 456 };
  catalog[2].openPurchases = [{ status: 'requested', qty: 3, unit: 'м' }, { status: 'received', qty: 100, unit: 'м' },
    { status: 'ordered', qty: 0, unit: 'шт' }];
  const { page, posts, errors } = await fixture(t, { catalog });
  const panel = await enter(page);
  await panel.getByRole('button', { name: /^Трубы/ }).click();
  await panel.getByRole('button', { name: /^Круглые трубы/ }).click();
  const table = panel.getByRole('table');
  const rows = table.locator('tbody tr');
  const toggle = btn(panel, profile);
  await toggle.waitFor();
  assert.equal(await rows.count(), 1);
  assert.deepEqual(await table.getByRole('columnheader').allTextContents(),
    ['Сортамент и материал', '', 'Штуки', 'Метры', 'Действие']);
  await rows.getByText('Сталь', { exact: true }).waitFor();
  assert.doesNotMatch(await rows.innerText(), /СКЛ-|Труба круглая|Немытые/);
  const length = panel.getByLabel('Длина хлыста: ' + profile, { exact: true });
  assert.equal(await length.isVisible(), false);
  await rows.getByText('Уже в заявках: 6 м', { exact: true }).waitFor();
  await rows.getByText('Ожидаем поставку: 12 м', { exact: true }).waitFor();
  await rows.getByText('Оплачено, ждём поставку: 9 м', { exact: true }).waitFor();
  const detail = table.locator('tr[data-pipe-stock]');
  const stockTotals = async (pieces, metres) => {
    const totalPieces = detail.locator('[data-stock-total=pieces]');
    const totalMetres = detail.locator('[data-stock-total=metres]');
    assert.equal(await totalPieces.evaluate(el => el.cellIndex + el.parentElement.cells[0].colSpan - 1), 2);
    assert.equal(await totalMetres.evaluate(el => el.cellIndex + el.parentElement.cells[0].colSpan - 1), 3);
    assert.equal(await totalPieces.locator('strong').innerText(), pieces + ' шт');
    assert.equal(await totalMetres.locator('strong').innerText(), metres + ' м');
  };
  const stockBalance = async (label, expected) => {
    const term = panel.getByText(label, { exact: true }).and(panel.locator('dt'));
    const actual = await term.evaluate(el => el.nextElementSibling?.textContent);
    assert.equal(actual, expected + ' м');
  };
  await rows.getByRole('button', { name: /В корзину/ }).click();
  await btn(panel, 'Корзина (1)').click();
  await panel.getByRole('button', { name: /^Убрать:/ }).click();
  await btn(panel, 'К каталогу').click();
  await toggle.click();
  const pieces = panel.getByLabel('Штуки: ' + profile, { exact: true });
  const metres = panel.getByLabel('Метры: ' + profile, { exact: true });
  await length.selectOption(catalog[3].materialId);
  await stockBalance('Мытые', 8);
  await stockBalance('Немытые', 10);
  await stockTotals(9, 18);
  await metres.fill('7');
  assert.equal(await pieces.inputValue(), '4');
  await length.selectOption(raw.materialId);
  await stockBalance('Мытые', 12);
  await stockBalance('Немытые', 24);
  await stockTotals(9, 36);
  for (const [key, pieces, metres] of [['reserved', '3 шт', '12 м'], ['ordered', '5,25 шт', '21 м']]) {
    const cells = table.locator('tr[data-pipe-commitment="' + key + '"] td');
    assert.equal(await cells.nth(1).innerText(), pieces);
    assert.equal(await cells.nth(2).innerText(), metres);
  }
  const lastPurchase = await detail.getByText(/^Последний заказ:/).innerText();
  assert.match(lastPurchase, /25\.11\.2026/);
  assert.match(lastPurchase, /456/);
  await shot(page, 'pipe-paid-stock');
  await metres.fill('4');
  assert.equal(await pieces.inputValue(), '1');
  await metres.fill('7');
  assert.equal(await pieces.inputValue(), '2');
  await metres.blur();
  assert.equal(await metres.inputValue(), '8');
  await pieces.fill('3');
  assert.equal(await metres.inputValue(), '12');
  await rows.getByRole('button', { name: /В корзину/ }).click();
  await btn(panel, 'Корзина (1)').click();
  assert.equal(await pieces.inputValue(), '3');
  await metres.fill('19');
  await metres.blur();
  assert.equal(await pieces.inputValue(), '5');
  assert.equal(await metres.inputValue(), '20');
  const download = page.waitForEvent('download');
  await btn(panel, 'Скачать Excel').click();
  const xml = await sheetFrom(await download);
  assert.ok(xml.includes(profile));
  assert.match(xml, /<v>5<\/v>/);
  assert.match(xml, /<v>20<\/v>/);
  await btn(panel, 'Создать заявки').click();
  await panel.waitFor({ state: 'hidden' });
  assert.equal(posts.length, 1);
  assert.deepEqual(posts[0].items, [{ materialId: raw.materialId, qty: 20 }]);
  assert.deepEqual(errors, []);
});

test('C280: длина для заказа и раскрытие строки трубы с неизвестной складской длиной', async t => {
  const item = stockPipe(8, false, 0, null);
  delete item.dims.length;
  item.name = 'Труба круглая ' + profile;
  const { page, posts, patches, errors } = await fixture(t, { catalog: [item] });
  const panel = await enter(page);
  await panel.getByRole('button', { name: /^Трубы/ }).click();
  await panel.getByRole('button', { name: /^Круглые трубы/ }).click();
  const table = panel.getByRole('table');
  const toggle = btn(panel, profile);
  const row = table.locator('tbody tr').first();
  const expanded = () => toggle.getAttribute('aria-expanded');
  assert.equal(await expanded(), 'false');
  await row.getByRole('cell').nth(1).click();
  assert.equal(await expanded(), 'true');
  await row.getByText('Сталь', { exact: true }).click();
  assert.equal(await expanded(), 'false');

  const pieces = panel.getByLabel('Штуки: ' + profile, { exact: true });
  const metres = panel.getByLabel('Метры: ' + profile, { exact: true });
  const length = panel.getByLabel('Длина хлыста для заказа, м: ' + profile, { exact: true });
  assert.equal(await length.isVisible(), false);
  assert.equal(await btn(panel, 'Сохранить длину в позиции').isVisible(), false);
  await shot(page, 'unknown-length-closed');
  assert.equal(await pieces.isEnabled(), true);
  await pieces.fill('2');
  assert.equal(await metres.inputValue(), '');
  await row.getByRole('button', { name: /В корзину/ }).click();
  assert.equal(await expanded(), 'true');
  assert.ok(await length.evaluate(el => el === document.activeElement));
  assert.equal(await pieces.inputValue(), '2');
  assert.equal(await row.locator('input').count(), 2);
  if (process.env.C280_EVIDENCE) await page.getByText('Укажите длину для пересчёта между штуками и метрами').waitFor({ state: 'hidden' });
  await shot(page, 'unknown-length-open');
  await length.fill('3');
  assert.equal(await metres.inputValue(), '6');
  await metres.fill('7');
  await metres.blur();
  assert.equal(await pieces.inputValue(), '3');
  assert.equal(await metres.inputValue(), '9');
  await toggle.click();
  assert.equal(await length.isVisible(), false);
  await row.getByRole('button', { name: 'Длина для заказа: 3 м' }).waitFor();
  await row.getByRole('button', { name: /В корзину/ }).click();
  assert.equal(await expanded(), 'false');
  await btn(panel, 'Корзина (1)').click();
  assert.equal(await pieces.inputValue(), '3');
  assert.equal(await metres.inputValue(), '9');
  await btn(panel, 'К каталогу').click();
  await row.getByRole('button', { name: 'Длина для заказа: 3 м' }).click();
  await length.fill('4');
  await pieces.fill('2');
  await row.getByRole('button', { name: /В корзину/ }).click();
  await btn(panel, 'Корзина (2)').click();
  assert.deepEqual(await pieces.evaluateAll(nodes => nodes.map(el => el.value).sort()), ['2', '3']);
  assert.deepEqual(await metres.evaluateAll(nodes => nodes.map(el => el.value).sort()), ['8', '9']);
  assert.deepEqual(patches, []);
  await btn(panel, 'Создать заявки').click();
  await panel.waitFor({ state: 'hidden' });
  assert.deepEqual(patches, []);
  assert.equal(posts[0].items.length, 1);
  assert.equal(posts[0].items[0].qty, 17);
  assert.match(posts[0].items[0].note, /3 шт × 3 м/);
  assert.match(posts[0].items[0].note, /2 шт × 4 м/);
  await enter(page);
  const openPipes = async () => {
    await panel.getByRole('button', { name: /^Трубы/ }).click();
    await panel.getByRole('button', { name: /^Круглые трубы/ }).click();
  };
  await openPipes();
  await btn(panel, 'Указать длину').click();
  assert.ok(await length.evaluate(el => el === document.activeElement));
  await length.fill('3');
  await btn(panel, 'Сохранить длину в позиции').click();
  await length.waitFor({ state: 'hidden' });
  assert.deepEqual(patches, [{ id: item.id, body: { dims: { length: 3000 } } }]);
  await page.reload();
  await openPipes();
  assert.equal(await length.isVisible(), false);
  await pieces.fill('3');
  assert.equal(await metres.inputValue(), '9');
  assert.deepEqual(errors, []);
});

test('C280: частичная запись после сбоя, блокировка изменений и повтор исходного пакета', async t => {
  const { page, requests, posts, errors } = await fixture(t, { theme: 'dark', loseFirstResponse: true });
  const panel = await enter(page);
  await panel.getByRole('button', { name: /^Металл/ }).click();
  await btn(panel, 'Все позиции категории').click();
  await add(panel, stock[0]);
  await btn(panel, 'Все категории').click();
  await panel.getByRole('button', { name: /^Крепёж/ }).click();
  await btn(panel, 'Все позиции категории').click();
  await add(panel, stock[2]);
  await btn(panel, 'Корзина (2)').click();
  const go = btn(panel, 'Создать заявки');
  await go.dblclick().catch(error => { if (!posts.length) throw error; });
  const retry = btn(panel, 'Повторить отправку');
  await retry.waitFor();
  assert.equal(posts.length, 1);
  assert.equal(requests.size, 1);
  assert.ok((await quantity(panel, stock[0]).count()) === 0 || await quantity(panel, stock[0]).isDisabled());
  await shot(page, 'retry-dark');
  await page.reload();
  await retry.waitFor();
  assert.ok(await quantity(panel, stock[0]).isDisabled());
  await retry.click();
  await panel.waitFor({ state: 'hidden' });
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1], posts[0]);
  assert.equal(requests.size, 2);
  assert.deepEqual(errors, []);
});


test('Поздний отказ импорта корзины сохраняет открытую вкладку счетов', async t => {
  const { page } = await fixture(t);
  let requested;
  const intercepted = new Promise(resolve => { requested = resolve; });
  await page.route('**/sections/request-cart.js', route => requested(route));
  await page.getByRole('button', { name: 'Из каталога', exact: true }).click();
  const pending = await intercepted;
  await page.evaluate(() => { location.hash = 'requests?tab=invoices'; });
  const invoices = page.getByText('Счетов пока нет', { exact: true });
  await invoices.waitFor();
  const original = await invoices.elementHandle();
  await pending.fulfill({ contentType: 'text/javascript', body: "throw new Error('Тест позднего отказа');" });
  await page.evaluate(async () => {
    await import('./sections/request-cart.js').catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  assert.equal(await original.evaluate(el => el.isConnected), true);
  assert.equal(await page.getByText('Раздел не открылся', { exact: true }).count(), 0);
});
