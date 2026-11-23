import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';

const root = new URL('../', import.meta.url), origin = 'http://c243.test';
let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });

for (const theme of ['light', 'dark']) test('нет предложения сохраняет DNS и историческую цену: ' + theme, async t => {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, serviceWorkers: 'block' });
  t.after(() => page.close());
  const person = { id: 'c243', username: 'fixture', role: 'admin', sections: ['suppliercatalog'], canMoney: true };
  const row = { id: 'm:honor', materialId: 'honor', kind: 'material', name: 'HONOR MagicBook X16', materialName: 'HONOR MagicBook X16', article: '5608549', unit: 'шт', stockQty: 1, priceHint: null, supplierName: null };
  const summary = { unit: 'шт', suppliers: [{ name: 'DNS', count: 1, totalQty: 1, lastDate: '2026-11-13', lastPrice: 85299, minPrice: 85299, maxPrice: 85299 }], prices: [{ date: '2026-11-13', price: 85299, supplierName: 'DNS', source: 'purchase' }] };
  const mutations = [], errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(({ person, theme }) => { localStorage.setItem('dc-theme', theme); localStorage.setItem('dca_user', JSON.stringify(person)); localStorage.setItem('dca_access', 'fixture'); localStorage.setItem('dca_refresh', 'fixture'); }, { person, theme });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      if (route.request().method() !== 'GET') mutations.push(url.pathname);
      const data = url.pathname === '/api/auth/me' ? person
        : url.pathname === '/api/supply/catalog/counts' ? { suppliers: [], categories: [], noSupplier: 1 }
        : url.pathname === '/api/supply/catalog/items' ? { items: [row], total: 1 }
        : url.pathname.startsWith('/api/supply/catalog/items/') ? row
        : url.pathname === '/api/materials/honor/summary' ? summary
        : url.pathname === '/api/materials/honor' ? row
        : { items: [], counts: {}, metrics: {}, feed: [], week: [] };
      return route.fulfill({ json: data });
    }
    const file = url.pathname.slice('/app/'.length) || 'index.html';
    const type = { js: 'text/javascript', css: 'text/css', html: 'text/html', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' }[file.split('.').pop()];
    if (!url.pathname.startsWith('/app/') || !type) return route.fulfill({ status: 404 });
    try { return route.fulfill({ contentType: type, body: await readFile(new URL(file, root)) }); } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto(origin + '/app/#suppliercatalog?all=1&supplierId=none&view=table');
  await page.getByText('Нет предложения', { exact: true }).waitFor({ timeout: 5000 }).catch(async e => { throw new Error((await page.locator('body').innerText()) + '\n' + errors.join(';') + '\n' + e.message); });
  assert.match(await page.getByText('Нет предложения', { exact: true }).getAttribute('title'), /прошлых закупок/);
  assert.ok(await page.getByText('Без предложений', { exact: true }).count());
  await page.getByText('HONOR MagicBook X16', { exact: true }).first().click();
  await page.getByText('DNS', { exact: true }).first().waitFor();
  assert.match(await page.locator('body').innerText(), /85[\s\u00a0\u202f]?299/);
  assert.doesNotMatch(await page.locator('body').innerText(), /Поставщика нет/);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    let drawer = document.querySelector('.drawer');
    if (!drawer || drawer.classList.contains('loading')) return false;
    for (; drawer; drawer = drawer.parentElement) if (Number(getComputedStyle(drawer).opacity) < .99) return false;
    return true;
  });
  if (process.env.C243_PROOF_DIR) { await mkdir(process.env.C243_PROOF_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.C243_PROOF_DIR, 'history-' + theme + '.png'), fullPage: true }); }
  assert.deepEqual(mutations, []);
  assert.deepEqual(errors, []);
});


