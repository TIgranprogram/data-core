import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const origin = 'https://contract-atlas.test';
const app = new URL('../../backend/pwa/', import.meta.url);
const types = { css: 'text/css', js: 'application/javascript' };

test('Договор закрепляется из поиска и сохраняет отметки при смене глубины карты', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || route.request().method() !== 'GET') return route.abort();
      if (url.pathname === '/app/') {
        const src = await readFile(new URL('index.html', app), 'utf8');
        const css = [...src.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)]
          .map(([, href]) => '<link rel="stylesheet" href="/app/' + href + '">').join('');
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html data-theme="soft"><meta charset="utf-8">' + css + '<main class="main"><section class="page"><div id="case" class="atlas-canvas-page"></div></section></main>' });
      }
      const suffix = url.pathname.split('.').at(-1);
      if (!url.pathname.startsWith('/app/') || !types[suffix]) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: types[suffix] + '; charset=utf-8', body: await readFile(new URL(url.pathname.slice(5), app)) });
    });
    await page.goto(origin + '/app/');
    await page.evaluate(async () => {
      const model = await import('/app/sections/atlas-model.js');
      const { atlasMap } = await import('/app/ui/kit/atlas-map.js');
      const visible = model.visibleAtlas(model.buildAtlasModel(), href => !href.startsWith('#money'), false);
      const view = atlasMap({ model: visible, trace: model.traceAtlas });
      document.querySelector('#case').replaceChildren(view.el);
    });
    const search = page.getByRole('combobox', { name: 'Поиск по карте' });
    await search.fill('договор заказчика');
    await page.getByRole('option', { name: /^Договор заказчика/ }).waitFor();
    await search.press('Enter');
    const chip = page.locator('.am-search-pin');
    await chip.getByText('Договор заказчика', { exact: true }).waitFor();
    const marked = (id) => page.locator('.am-station[data-node="' + id + '"][data-pinned]').first();
    await marked('customercontract').waitFor();
    await marked('offers').waitFor();
    await marked('salesorders').waitFor();
    assert.equal(await marked('money').count(), 0);
    const contract = marked('customercontract');
    assert.equal(await contract.evaluate((el) => getComputedStyle(el).outlineWidth), '2px');
    await page.screenshot({ path: join(tmpdir(), 'c196-contract-pinned-1920.png') });

    const viewport = page.getByRole('region', { name: 'Карта областей, разделов и связей' });
    await viewport.focus();
    await viewport.press('-');
    await viewport.press('-');
    await page.locator('.atlas-map[data-level="0"]').waitFor();
    await marked('area:sale').waitFor();
    assert.equal(await chip.isVisible(), true);
    for (const width of [2560, 3440]) {
      await page.setViewportSize({ width, height: 1080 });
      await marked('area:sale').waitFor();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
      await page.screenshot({ path: join(tmpdir(), 'c196-atlas-pinned-' + width + '.png') });
    }

    const sales = marked('area:sale');
    await sales.scrollIntoViewIfNeeded();
    await sales.hover();
    await page.mouse.wheel(0, -115);
    await page.locator('.atlas-map[data-level="1"]').waitFor();
    await marked('customercontract').waitFor();
    assert.equal(await chip.isVisible(), true);
    for (const theme of ['light', 'dark', 'soft']) {
      await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
      assert.ok(await marked('customercontract').evaluate((card) => {
        const style = getComputedStyle(card);
        return style.outlineStyle === 'solid' && style.outlineWidth === '2px' && style.outlineColor !== style.backgroundColor;
      }));
    }
    await page.getByRole('button', { name: 'Снять закрепление на карте' }).click();
    assert.equal(await chip.isVisible(), false);
    assert.equal(await page.locator('.am-station[data-pinned]').count(), 0);
    assert.equal(await search.evaluate((input) => document.activeElement === input), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
