import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const root = new URL('../../', import.meta.url);
const app = new URL('backend/pwa/', root);
const origin = 'http://127.0.0.1:41732';
const evidence = process.env.C198_EVIDENCE;
const fixturePdf = await readFile(new URL('docs/crew/C173-passport-independent-release-check/evidence/order-lines/short-r1.pdf', root));
const order1 = '000000000000000000000011';
const order2 = '000000000000000000000012';
const photo = '000000000000000000000021';
const file = '000000000000000000000022';
const workshop = { id: 'fixture', username: 'учебная', displayName: 'Учебная учётная запись', role: 'manager', canMoney: true };
const act = { id: 'act-1', name: 'Акт / УПД', number: 'А-17', date: '2026-11-20', orderId: order1, orderNo: 'Д-31',
  productionNo: '31-26', customer: 'Учебная мастерская «Север»', fileId: photo };
const frozenAct = { id: 'act-2', name: 'Акт / УПД', number: 'А-18', date: '2026-11-21', orderId: order2, orderNo: 'Д-32',
  productionNo: '32-26', customer: 'Учебный заказчик «Юг»', fileId: file, archiveVersion: 2 };
const registry = {
  orderId: order1, orderNo: 'Д-31', productionNo: '31-26', customer: act.customer, ready: 1, canHandover: false,
  rows: [
    { lineNo: 1, title: 'Учебная секция', qty: 2, state: 'issued', document: { number: 'П-25', revision: 1 } },
    { lineNo: 2, title: 'Рама учебная', qty: 1, state: 'missing' },
  ],
  current: null, unlinked: [], history: [],
};
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};
const pdfPaths = ['/uploads/doc-act.pdf', '/api/salesorders/' + order2 + '/archive/2/files/' + file, '/api/passports/registry/' + order1 + '/pdf'];

function fixtureApi(url, user) {
  if (url.pathname === '/api/auth/me') return user;
  if (url.pathname === '/api/showcase') return { items: [{ id: 'sample', sku: 'УЧ.И.01', name: 'Учебная секция', hasPassportDefaults: true }], total: 1 };
  if (url.pathname === '/api/photos/' + photo) return { id: photo, originalFilename: 'Акт А-17.pdf', storageUrl: '/uploads/doc-act.pdf' };
  if (url.pathname === '/api/documents/acts') {
    const state = url.searchParams.get('state');
    const order = url.searchParams.get('order');
    const search = url.searchParams.get('search');
    let items = [act, frozenAct];
    if (state) items = items.filter(item => state === 'archived' ? item.archiveVersion : !item.archiveVersion);
    if (order) items = items.filter(item => [item.orderNo, item.productionNo].includes(order));
    if (search) items = items.filter(item => [item.number, item.customer, item.orderNo].some(v => v.includes(search)));
    if (!user.canMoney) items = items.map(item => ({ ...item, fileId: null }));
    return { items, total: items.length, page: 1, limit: 25 };
  }
  if (url.pathname === '/api/passports/registry') return { items: [{ ...registry, id: order1, positions: registry.rows.length }], total: 1, page: 1, limit: 20 };
  if (url.pathname === '/api/passports/registry/' + order1) return registry;
  return { items: [], total: 0, page: 1, limit: 20 };
}

async function mount(browser, user, width = 1920) {
  const context = await browser.newContext({ viewport: { width, height: 1080 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  const requests = [];
  const denied = [];
  const errors = [];
  page.setDefaultTimeout(7000);
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(user => {
    localStorage.setItem('dc-theme', 'soft');
    sessionStorage.setItem('dca_access', 'synthetic');
    sessionStorage.setItem('dca_refresh', 'synthetic');
    sessionStorage.setItem('dca_user', JSON.stringify(user));
  }, user);
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin || !['GET', 'HEAD'].includes(request.method())) {
      denied.push(request.method() + ' ' + url.pathname);
      return route.fulfill({ status: 403, json: {} });
    }
    requests.push(url.pathname);
    if (pdfPaths.includes(url.pathname)) return route.fulfill({ body: fixturePdf, contentType: 'application/pdf' });
    if (url.pathname.startsWith('/app/')) {
      const relative = url.pathname.slice(5) || 'index.html';
      try {
        return await route.fulfill({ contentType: mime[extname(relative)] || 'application/octet-stream', body: await readFile(new URL(relative, app)) });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return route.fulfill({ status: 404 });
      }
    }
    return route.fulfill({ json: fixtureApi(url, user) });
  });
  return { context, page, requests, denied, errors };
}

test('Документация сохраняет вкладки паспортов и раскрывает акты и реестры под строкой', { timeout: 45000 }, async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const snap = async (page, file) => {
    if (evidence) await page.screenshot({ path: join(evidence, file), animations: 'disabled' });
  };
  if (evidence) await mkdir(evidence, { recursive: true });
  try {
    const { context, page, requests, denied, errors } = await mount(browser, workshop);
    try {
      await page.goto(origin + '/app/#docs?tab=numbers');
      const docsTabs = page.getByRole('tablist', { name: 'Документация', exact: true });
      await docsTabs.getByRole('tab', { name: 'Паспорта', exact: true }).waitFor();
      const passports = page.getByRole('tablist', { name: 'Паспорта', exact: true });
      assert.equal(await passports.getByRole('tab', { name: 'Выпущенные', exact: true }).getAttribute('aria-selected'), 'true');
      await page.getByRole('button', { name: 'Новый паспорт', exact: true }).waitFor();
      await docsTabs.getByRole('tab', { name: 'Акты', exact: true }).click();
      await page.waitForURL(url => url.hash === '#docs?tab=acts');
      assert.equal(await passports.isVisible(), false);

      const table = page.getByRole('table', { name: 'Акты', exact: true });
      const first = table.getByRole('row').filter({ hasText: act.number });
      const last = table.getByRole('row').filter({ hasText: frozenAct.number });
      await first.focus();
      await page.keyboard.press('Enter');
      const detail = table.locator('.k-pos-more');
      await detail.getByRole('button', { name: 'Открыть PDF' }).waitFor();
      assert.equal(await detail.getByRole('link', { name: 'Открыть договор № ' + act.orderNo }).getAttribute('href'), '#salesorders?of=salesorder&open=' + order1);
      assert.equal(await page.locator('.drawer').count(), 0);
      await snap(page, '1920-acts.png');

      await detail.getByRole('button', { name: 'Открыть PDF' }).click();
      await page.getByRole('button', { name: 'Печать', exact: true }).waitFor();
      await page.locator('iframe[src^="blob:"]').waitFor();
      assert.ok(requests.includes('/uploads/doc-act.pdf'));
      await page.keyboard.press('Escape');
      await last.click();
      assert.equal(await detail.count(), 1);
      assert.ok(await first.evaluate(el => !el.classList.contains('selected')));
      await detail.getByRole('button', { name: 'Открыть PDF' }).click();
      await page.locator('iframe[src^="blob:"]').waitFor();
      assert.ok(requests.includes(pdfPaths[1]));
      await page.keyboard.press('Escape');

      await page.getByRole('textbox', { name: 'Номер заказа или договора' }).fill('32-26');
      await page.waitForURL(url => url.hash.includes('order=32-26'));
      await first.waitFor({ state: 'detached' });
      await page.getByRole('tab', { name: 'Архив договоров', exact: true }).click();
      await page.waitForURL(url => url.hash.includes('state=archived'));
      await page.reload();
      await page.getByText(frozenAct.customer, { exact: true }).waitFor();
      assert.equal(await page.getByRole('textbox', { name: 'Номер заказа или договора' }).inputValue(), '32-26');

      await page.setViewportSize({ width: 2560, height: 1080 });
      await docsTabs.getByRole('tab', { name: 'Реестры', exact: true }).click();
      const registries = page.getByRole('table', { name: 'Реестры паспортов по заказам' });
      await registries.getByText(act.customer, { exact: true }).click();
      await page.getByText('Не выпущен', { exact: true }).waitFor();
      await snap(page, '2560-registries.png');
      await page.getByRole('button', { name: 'Печать реестра…', exact: true }).click();
      await page.locator('iframe[src^="blob:"]').waitFor();
      assert.ok(requests.includes(pdfPaths[2]));
      await page.keyboard.press('Escape');
      await docsTabs.getByRole('tab', { name: 'Паспорта', exact: true }).click();
      await passports.getByRole('tab', { name: 'Настройки изделий', exact: true }).click();
      await page.waitForURL(url => url.hash === '#docs?tab=templates');
      await page.locator('.list-panel table.list').getByText('Учебная секция', { exact: true }).waitFor();
      await snap(page, '2560-passports.png');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(denied, []);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }

    const limited = await mount(browser, { ...workshop, canMoney: false, sections: ['docs'] });
    try {
      await limited.page.goto(origin + '/app/#docs?tab=acts');
      await limited.page.getByRole('table', { name: 'Акты', exact: true }).getByRole('row').filter({ hasText: act.number }).click();
      const detail = limited.page.locator('.k-pos-more');
      await detail.getByText('PDF недоступен', { exact: true }).waitFor();
      assert.equal(await detail.getByRole('link').count(), 0);
      assert.equal(await detail.getByRole('button').count(), 0);
      assert.ok(!limited.requests.some(path => pdfPaths.includes(path)));
      assert.deepEqual(limited.errors, []);
      assert.deepEqual(limited.denied, []);
      await snap(limited.page, '1920-limited.png');
    } finally { await limited.context.close(); }
  } finally { await browser.close(); }
});

