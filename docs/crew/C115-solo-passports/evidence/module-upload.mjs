import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.C115_PLAYWRIGHT || 'playwright-core');
const browser = await chromium.launch({ channel: 'msedge' });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  const root = path.resolve('backend/pwa');
  const photoId = 'aa'.repeat(12);
  const photo = { id: photoId, storageUrl: '/drawing.png', originalFilename: 'drawing.png' };
  const requests = [];
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname === '/app/') return route.fulfill({ contentType: 'text/html', body: '<html lang="ru"><meta name="viewport" content="width=device-width,initial-scale=1"><body><main></main></body></html>' });
    if (url.pathname.startsWith('/app/') && url.pathname.endsWith('.js')) {
      let body = readFileSync(path.join(root, url.pathname.slice(5)), 'utf8');
      if (process.env.C115_BASELINE && url.pathname.endsWith('/passports/modules.js')) body = body.replace(/await loadPhotos\(\);\r?\n              \}/, '$&\n              return true;');
      return route.fulfill({ contentType: 'text/javascript', body });
    }
    if (url.pathname === '/api/photos/upload') {
      requests.push([method, url.search]);
      return route.fulfill({ json: photo });
    }
    if (url.pathname === '/api/products/c115/photos') {
      if (method === 'POST') requests.push([method, route.request().postDataJSON()]);
      return route.fulfill({ json: method === 'POST' ? {} : { items: requests.length === 2 ? [{ kind: 'module', photoId: photo }] : [] } });
    }
    return route.fulfill({ status: 404, body: '' });
  });
  await page.goto('http://c115.invalid/app/');
  await page.evaluate(async () => {
    const { modulesEditor } = await import('/app/sections/passports/modules.js');
    window.savedModules = [];
    const editor = modulesEditor({
      value: [{ name: 'Прямой модуль', qty: 2 }],
      productId: () => 'c115',
      save: async modules => window.savedModules.push(modules),
    });
    document.querySelector('main').append(editor.el);
    await editor.loadPhotos();
  });
  await page.locator('input[type=file]').setInputFiles({
    name: 'drawing.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYVQAAAAASUVORK5CYII=', 'base64'),
  });
  await page.waitForFunction(id => document.querySelector('select')?.value === id &&
    window.savedModules.some(rows => rows[0]?.photoId === id), photoId);
  await page.locator('.photo-drop:not(.busy)').waitFor();
  assert.deepEqual(requests, [
    ['POST', '?purpose=passport'],
    ['POST', { photoId, purpose: 'passport', kind: 'module' }],
  ]);
  if (!process.env.C115_BASELINE) await page.screenshot({ path: 'docs/crew/C115-solo-passports/evidence/module-upload.png' });
  assert.deepEqual(errors, []);
  console.log('PASS: рисунок загружен, привязан, выбран и передан на сохранение; исключений нет');
} finally {
  await browser.close();
}

