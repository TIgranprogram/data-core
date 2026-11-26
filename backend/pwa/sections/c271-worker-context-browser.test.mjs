import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';

const origin = 'http://c271.test';
const stockContext = /^\/api\/stock\/items\/([^/]+)\/(requests|reservations|request)$/;
let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, { kind = 'pipe', readOnly = false, failPage = false, more = false, outcomes = [], waitForPost, versions, theme = 'light', width = 1440 } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1050 }, serviceWorkers: 'block' });
  t.after(() => page.close());
  const user = { id: 'worker', baseRole: readOnly ? 'user' : 'manager', role: 'r-' + kind, roleLabel: kind === 'pipe' ? 'Труборез' : 'Лазер лист', sections: ['stock'], canMoney: false };
  const item = { id: 'main', materialId: 'main', metal: kind, name: kind === 'pipe' ? 'Труба 40×20×2' : 'Лист 3 мм', unit: kind === 'pipe' ? 'м' : 'лист',
    materialGrade: 'Ст3', countMode: 'single', quantity: 12, washed: true, categoryId: kind + '-cat',
    dims: kind === 'pipe' ? { length: 6000 } : { width: 1250, length: 2500, thickness: 3 },
    sectionProfile: { shape: 'rect', state: 'complete', label: '40×20×2', widthMm: 40, heightMm: 20, wallMm: 2 } };
  const items = kind === 'pipe' ? [item, { ...item, id: 'variant', materialId: 'variant', washed: false }] : [item];
  const requests = [
    { id: 'paid', num: '11-26', materialId: item.id, status: 'paid', statusLabel: 'Оплачено', qty: 7, receivedQty: 3, unit: 'м',
      invoiceDeliveryDate: '2026-11-28T12:00:00.000Z', invoiceNo: '541', supplierName: 'Поставщик' },
    { id: 'asked', num: '12-26', materialId: item.id, status: 'requested', qty: 2, unit: 'шт', invoiceDate: '2026-11-20T12:00:00.000Z' },
  ];
  if (more) for (let i = 0; i < 19; i++) requests.push({ id: 'extra-' + i, num: 'Открытая ' + i, status: 'ordered', qty: 1, unit: 'м' });
  const reservations = [{ id: 'br1', qty: 7, issuedQty: 3, unit: item.unit, groupName: 'На раму', orderId: 'строка 1',
    salesOrder: 'Заказ 222-26', hanging: 'Заказ отменён' }, { id: 'br2', qty: 2, unit: item.unit, groupName: 'На ремонт' }];
  const calls = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ user, theme }) => {
    localStorage.setItem('dca_access', 'fixture');
    localStorage.setItem('dca_refresh', 'fixture');
    localStorage.setItem('dca_user', JSON.stringify(user));
    localStorage.setItem('dc-theme', theme);
  }, { user, theme });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), method = route.request().method();
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      const body = route.request().postDataJSON(), query = Object.fromEntries(url.searchParams);
      calls.push({ path: url.pathname, method, body, query });
      if (url.pathname === '/api/auth/me') return route.fulfill({ json: user });
      if (url.pathname === '/api/me/versions' && versions) return route.fulfill({ json: { live: true, epoch: 'fixture', v: versions } });
      if (url.pathname === '/api/stock/zones') return route.fulfill({ json: { items: [{ id: 'zone', name: kind === 'pipe' ? 'Трубы' : 'Листовой материал' }] } });
      if (url.pathname === '/api/stock/items') return route.fulfill({ json: { items, total: items.length, page: 1, limit: 100 } });
      if (url.pathname.endsWith('/history')) return route.fulfill({ json: { items: [{ id: 'op1', type: 'in', qty: 2, date: '2026-11-22T10:30:00Z' }], total: 1 } });
      const match = stockContext.exec(url.pathname);
      if (match) {
        const [, id, list] = match;
        if (method === 'POST') {
          if (waitForPost) await waitForPost;
          const outcome = outcomes.shift();
          if (outcome === 'queued') return route.fulfill({ json: { queued: true } });
          if (outcome === 'network') return route.abort();
          if (outcome) return route.fulfill({ status: outcome, json: { message: outcome === 409 ? 'Создание заявок выключено.' : 'Нет прав на создание заявки.' } });
          const row = { id: 'created', num: '13-26', materialId: id, qty: body.qty, unit: item.unit, status: 'requested' };
          requests.unshift(row);
          return route.fulfill({ status: 201, json: row });
        }
        const page = Number(query.page), limit = Number(query.limit);
        if (id === 'main' && list === 'requests' && page === 2 && failPage) {
          failPage = false;
          return route.fulfill({ status: 400, json: { message: 'Страница недоступна.' } });
        }
        const rows = id !== 'main' ? [] : list === 'requests' ? requests : reservations;
        return route.fulfill({ json: { items: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit } });
      }
      return route.fulfill({ json: { items: [], counts: {}, metrics: {}, feed: [], week: [] } });
    }
    if (url.pathname === '/app/version.json') return route.fulfill({ json: { v: 'fixture' } });
    const file = url.pathname.slice('/app/'.length) || 'index.html';
    const type = { js: 'text/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' }[file.split('.').at(-1)];
    if (!url.pathname.startsWith('/app/') || !type || file.includes('..')) return route.fulfill({ status: 404 });
    try { return route.fulfill({ contentType: type, body: await readFile(new URL('../' + file, import.meta.url)) }); }
    catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto(origin + '/app/#stock?view=' + kind);
  await page.locator('[data-material-id="main"]').waitFor();
  return { page, calls, errors, reservations, requests };
}

const count = (calls, path) => calls.filter(call => call.path === '/api/stock/' + path).length;
const writes = calls => calls.filter(call => call.method === 'POST' && stockContext.test(call.path));
async function reveal(page) {
  await page.locator('[data-worker-row]').first().click();
  return page.locator('[data-detail-material-id="main"]');
}

test('Труборез: ленивый контекст, оплаченная заявка и частичный остаток, бронь отменённого заказа, отмена и адресное обновление', async t => {
  const { page, calls, errors } = await fixture(t);
  assert.equal(calls.filter(call => stockContext.test(call.path)).length, 0);
  assert.equal(count(calls, 'reservations'), 0);
  const detail = await reveal(page);
  await detail.getByText('Оплачено', { exact: true }).waitFor();
  await detail.getByText('Дата поставки не указана', { exact: true }).waitFor();
  await detail.getByText('28.11.2026', { exact: true }).waitFor();
  await detail.getByText('2 шт', { exact: true }).waitFor();
  assert.equal(await detail.getByText('7 м', { exact: true }).count(), 2);
  await detail.getByText('На раму', { exact: true }).waitFor();
  await detail.getByText('Заказ отменён', { exact: true }).waitFor();
  await detail.getByText(/Заказ 222-26/).waitFor();
  const order = detail.getByRole('button', { name: 'Заказать', exact: true });
  await order.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Дополнительная заявка' }).waitFor();
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  assert.equal(writes(calls).length, 0);
  await order.click();
  await dialog.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  await dialog.getByText('Введите положительное количество.', { exact: true }).waitFor();
  const quantity = dialog.getByLabel('Количество труб, шт');
  await quantity.fill('2,5');
  await dialog.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  await dialog.getByText('Введите целое неотрицательное количество труб.', { exact: true }).waitFor();
  await quantity.fill('2');
  await dialog.getByText('2 шт × 6 м = 12 м', { exact: true }).waitFor();
  await dialog.getByRole('button', { name: 'Создать заявку', exact: true }).evaluate(node => { node.click(); node.click(); });
  await detail.getByText('Создана заявка № 13-26', { exact: true }).waitFor();
  const gridReads = count(calls, 'items');
  await page.waitForTimeout(400); // debounced dc:changed не должен перечитывать сетку
  assert.equal(writes(calls).length, 1); assert.equal(writes(calls)[0].body.qty, 12);
  assert.equal(count(calls, 'items'), gridReads);
  assert.equal(count(calls, 'items/main/requests'), 2);
  assert.equal(count(calls, 'items/main/reservations'), 1);
  assert.equal(count(calls, 'items/variant/requests'), 1);
  assert.deepEqual(errors, []);
});

test('Лазер лист: ошибка страницы блокирует заказ, явный повтор и ответ queued используют тот же UUID', async t => {
  const { page, calls, errors } = await fixture(t, { kind: 'sheet', more: true, failPage: true, outcomes: ['queued', 'network'] });
  const detail = await reveal(page), order = detail.getByRole('button', { name: 'Заказать', exact: true });
  const more = detail.getByRole('button', { name: 'Ещё заявки', exact: true });
  await more.waitFor();
  assert.equal(await order.isDisabled(), true);
  await more.click();
  await detail.getByText('Заявки не загрузились', { exact: true }).waitFor();
  assert.equal(await order.isDisabled(), true);
  await detail.locator('[data-worker-requests]').getByRole('button', { name: 'Повторить', exact: true }).click();
  await detail.getByText('Заявка № Открытая 18', { exact: true }).waitFor();
  await order.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Количество, лист').fill('3');
  await dialog.getByRole('button', { name: 'Создать заявку', exact: true }).click();
  const retry = detail.getByRole('button', { name: 'Повторить отправку заявки', exact: true });
  await retry.waitFor();
  assert.equal(await detail.getByText('Создана заявка', { exact: false }).count(), 0);
  for (let i = 0; i < 2; i++) {
    await retry.click();
    assert.equal(await dialog.getByLabel('Количество, лист').inputValue(), '3');
    await dialog.getByRole('button', { name: 'Повторить отправку', exact: true }).click();
  }
  await detail.getByText('Создана заявка № 13-26', { exact: true }).waitFor();
  assert.equal(writes(calls).length, 3);
  assert.equal(new Set(writes(calls).map(call => call.body.clientUid)).size, 1);
  assert.match(writes(calls)[0].body.clientUid, /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i);
  assert.deepEqual(errors, []);
});

test('native наблюдатель: ожидания и брони читает, кнопки заказа нет', async t => {
  const { page, calls, errors } = await fixture(t, { readOnly: true });
  const detail = await reveal(page);
  await detail.getByText('Оплачено', { exact: true }).waitFor();
  await detail.getByText('На раму', { exact: true }).waitFor();
  assert.equal(await detail.getByRole('button', { name: 'Заказать', exact: true }).count(), 0);
  assert.equal(writes(calls).length, 0); assert.deepEqual(errors, []);
});

test('внешнее обновление подтягивает новую бронь, поздний POST обновляет только адресные ожидания', async t => {
  let release;
  const waitForPost = new Promise(resolve => { release = resolve; });
  t.after(release);
  const { page, calls, reservations } = await fixture(t, { waitForPost });
  const detail = await reveal(page);
  await detail.getByText('На раму', { exact: true }).waitFor();
  await page.locator('[data-worker-row]').first().click();
  await reveal(page);
  await detail.getByText('На раму', { exact: true }).waitFor();
  assert.equal(count(calls, 'items/main/reservations'), 1);
  await detail.getByRole('button', { name: 'Заказать', exact: true }).click();
  await page.getByLabel('Количество труб, шт').fill('5');
  await page.getByRole('dialog').getByRole('button', { name: 'Создать заявку' }).click();
  await detail.getByRole('button', { name: 'Отправляю…' }).waitFor();
  reservations.push({ id: 'later', qty: 3, unit: 'м', groupName: 'Новая бронь' });
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('dc:changed', { detail: { method: 'POST', path: '/stock/reserve-list' } }));
  });
  await detail.getByText('Новая бронь', { exact: true }).waitFor();
  await detail.getByText('Оплачено', { exact: true }).waitFor();
  assert.equal(count(calls, 'items/main/reservations'), 2);
  release();
  await detail.getByText('Создана заявка № 13-26', { exact: true }).waitFor();
  await detail.getByText('Заявка № 13-26', { exact: true }).waitFor();
  assert.equal(await detail.getByRole('button', { name: 'Отправляю…' }).count(), 0);
  assert.equal(count(calls, 'items/main/reservations'), 2);
  assert.equal(writes(calls)[0].body.qty, 30);
});

test('внешняя версия заявок обновляет срок поставки после окончания ввода', async t => {
  const versions = { stock: 1, requests: 1 };
  const { page, calls, requests, errors } = await fixture(t, { versions });
  const detail = await reveal(page);
  await detail.getByText('28.11.2026', { exact: true }).waitFor();
  const search = page.getByRole('textbox', { name: 'Найти материал' });
  await search.focus();
  requests[0].invoiceDeliveryDate = '2026-12-03T12:00:00.000Z';
  versions.requests++;
  const poll = () => page.waitForResponse(response => response.url().endsWith('/api/me/versions'));
  const whileTyping = poll();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await whileTyping;
  assert.equal(await detail.getByText('28.11.2026', { exact: true }).count(), 1);
  assert.equal(count(calls, 'items/main/requests'), 1);
  const afterTyping = poll();
  await page.evaluate(() => { document.activeElement.blur(); window.dispatchEvent(new Event('focus')); });
  await afterTyping;
  await detail.getByText('03.12.2026', { exact: true }).waitFor();
  assert.equal(count(calls, 'items/main/requests'), 2);
  assert.equal(writes(calls).length, 0);
  assert.deepEqual(errors, []);
});

test('отказ 409 и 403 понятен, без ложного номера созданной заявки', async t => {
  const { page, calls, errors } = await fixture(t, { kind: 'sheet', outcomes: [409, 403] });
  const detail = await reveal(page), order = detail.getByRole('button', { name: 'Заказать', exact: true });
  const dialog = page.getByRole('dialog');
  for (const message of ['Создание заявок выключено.', 'Нет прав на создание заявки.']) {
    await order.click();
    await dialog.getByLabel('Количество, лист').fill('1');
    await dialog.getByRole('button', { name: 'Создать заявку', exact: true }).click();
    await detail.getByText(message, { exact: true }).waitFor();
  }
  assert.equal(await detail.getByText('Создана заявка', { exact: false }).count(), 0);
  assert.equal(writes(calls).length, 2); assert.deepEqual(errors, []);
});

const proof = process.env.C271_PROOF_DIR;
if (proof) for (const kind of ['pipe', 'sheet']) for (const [theme, width] of [['light', 1440], ['dark', 1024], ['light', 2560]]) {
  test(`снимки C271: ${kind}, ${theme}, ${width}`, async t => {
    const readOnly = width === 2560;
    const { page, calls } = await fixture(t, { kind, theme, width, readOnly });
    const detail = await reveal(page);
    await detail.getByText('На раму', { exact: true }).waitFor();
    await detail.getByText('Оплачено', { exact: true }).waitFor();
    await mkdir(proof, { recursive: true });
    const name = `${kind}-${theme}-${width}`;
    await page.screenshot({ path: join(proof, name + '-context.png') });
    await detail.locator('[data-worker-reservations]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(proof, name + '-reservations.png') });
    if (!readOnly) {
      await detail.getByRole('button', { name: 'Заказать', exact: true }).click();
      await page.getByRole('dialog').waitFor();
      await page.screenshot({ path: join(proof, name + '-order.png') });
    }
    assert.equal(writes(calls).length, 0);
  });
}
