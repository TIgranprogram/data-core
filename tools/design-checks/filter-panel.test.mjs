import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const app = new URL('../../backend/pwa/', import.meta.url);
const groups = [
  { id: 's', name: 'Мебель', count: 3 },
  { id: 'g', parentId: 's', name: 'Столы', count: 2 },
  { id: 'b', parentId: 'g', name: 'Письменные', count: 1 },
  { id: 'x', name: 'Оборудование', count: 2 },
];
test('Галерея продукции, возврат к родителю, выбор серии и память общей панели', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.setDefaultTimeout(5000);
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.route('http://filter.test/**', async route => {
      const url = new URL(route.request().url());
      if (url.pathname === '/app/') {
        const css = ['ui/tokens.css', 'ui/base.css', 'ui/list.css', 'ui/panels.css', 'ui/kit/kit.css'];
        return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head>' + css.map(f => '<link rel="stylesheet" href="/app/' + f + '">').join('') + '</head><body><div class="topbar" style="height:var(--topbar-h)"></div><main style="padding-top:var(--topbar-h)"></main></body></html>' });
      }
      if (url.pathname.startsWith('/app/')) return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(new URL(url.pathname.slice(5), app)) });
      const body = url.pathname.endsWith('/groups') ? groups : url.searchParams.has('facets')
        ? { facets: { series: [{ value: 'А', label: 'А', n: 2 }, { value: 'Б', label: 'Б', n: 1 }] } }
        : { items: [{ id: '1', name: 'Стол', type: 'Мебель', group: 'Столы', series: 'А' }], total: 1 };
      return route.fulfill({ json: body });
    });
    const mount = () => page.evaluate(async () => {
      const { products } = await import('/app/sections/products.js');
      const { mountList } = await import('/app/ui/kit/list.js');
      const { current, onChange } = await import('/app/core/router.js');
      const list = mountList(products, current().params, { onOpen() {} });
      onChange(({ params }) => list.update(params));
      document.querySelector('main').append(list.el);
    });
    await page.goto('http://filter.test/app/#products');
    await mount();
    const toggle = page.locator('.filter-tools button[aria-controls]');
    const panel = page.locator('aside.list-side');
    const group = panel.getByRole('radiogroup', { name: 'Раздел', exact: true });
    const search = page.getByRole('textbox', { name: 'Поиск', exact: true });
    await toggle.click();
    await panel.getByRole('radiogroup', { name: 'Серия' }).waitFor();
    assert.equal(await group.count(), 0);
    assert.equal(await search.isVisible(), true);
    await page.getByRole('button', { name: /Мебель/ }).first().click();
    await page.getByRole('button', { name: /Столы/ }).first().click();
    const path = page.getByRole('navigation', { name: 'Разделы продукции' });
    await path.getByText('Столы', { exact: true }).waitFor();
    await path.getByRole('button', { name: /Письменные/ }).click();
    await path.getByText('Письменные', { exact: true }).waitFor();
    await path.getByRole('button', { name: 'Столы', exact: true }).click();
    await page.waitForURL(url => url.hash.includes('grp=g') && !url.hash.includes('sub='));
    assert.equal(await toggle.textContent(), 'Фильтры');
    await panel.getByRole('radio').first().click();
    await page.waitForURL(url => decodeURIComponent(url.hash).includes('series=А'));
    await toggle.click();
    assert.equal(await panel.isVisible(), false);
    assert.equal(await search.isVisible(), true);
    await toggle.click();
    await panel.getByTitle('Убрать: Серия').waitFor();
    assert.equal(await toggle.textContent(), 'Фильтры · 1');
    await panel.getByRole('button', { name: 'Сбросить всё' }).click();
    await page.waitForURL(url => url.hash.includes('grp=g') && !url.hash.includes('series='));
    await panel.getByRole('radio').first().click();
    await page.waitForURL(url => decodeURIComponent(url.hash).includes('series=А'));
    await path.getByRole('button', { name: 'Разделы продукции' }).click();
    await page.waitForURL(url => decodeURIComponent(url.hash).includes('series=А') && !url.hash.includes('grp='));
    await path.getByRole('button', { name: /Оборудование/ }).click();
    await page.waitForURL(url => url.hash.includes('sec=x') && decodeURIComponent(url.hash).includes('series=А'));
    await page.getByRole('button', { name: 'Таблица' }).click();
    await panel.getByTitle('Убрать: Раздел').click();
    await group.waitFor();
    await page.reload();
    await mount();
    await group.waitFor();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await search.focus();
    await page.keyboard.press('Escape');
    assert.equal(await panel.isVisible(), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
