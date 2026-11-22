import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const origin = 'https://admin-keys.test';
const root = new URL('../../backend/', import.meta.url);
const fixtureSecret = 'kppd_synthetic_browser_fixture';
const mime = { html: 'text/html', js: 'application/javascript', css: 'text/css' };

test('Админка предлагает отдельное приложение и скачивает инструкцию без ключа', async () => {
  const requests = [];
  const active = { label: 'Проверка', scope: { access: 'app', apps: ['sample'] }, ttl: '7d' };
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    page.on('pageerror', (err) => errors.push(err.message));
    await page.addInitScript(() => {
      sessionStorage.setItem('dc_token', 'synthetic-session');
      sessionStorage.setItem('dc_user', JSON.stringify({ role: 'admin', username: 'Тест' }));
    });
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/api/desktop/pairing-keys') {
        if (request.method() === 'POST') {
          requests.push(request.postDataJSON());
          return route.fulfill({ status: 201, json: { apiKey: fixtureSecret } });
        }
        return route.fulfill({ json: [active, { ...active, label: 'Некорректный', scope: null }] });
      }
      if (url.pathname === '/api/meta/schema') return route.fulfill({ json: { collections: [] } });
      if (url.pathname.startsWith('/api/')) return route.fulfill({ json: [] });
      const file = url.pathname === '/admin/' ? '/admin/index.html' : url.pathname.replace(/^\/app\//, '/pwa/');
      if (!/^\/(?:admin|pwa)\/[\w./-]+$/.test(file) || file.includes('..')) return route.abort();
      const ext = file.split('.').at(-1);
      if (!mime[ext]) return route.fulfill({ status: 404 });
      try {
        const body = await readFile(new URL('.' + file, root));
        return route.fulfill({ body, contentType: mime[ext] + '; charset=utf-8' });
      } catch {
        return route.fulfill({ status: 404 });
      }
    });
    await page.goto(origin + '/admin/');
    await page.getByRole('button', { name: 'API-ключи' }).click();
    const blocked = page.getByRole('row', { name: /Некорректный/ });
    await blocked.getByText('Доступ заблокирован').waitFor();
    assert.equal(await blocked.getByRole('button', { name: 'Скачать инструкцию' }).count(), 0);
    await page.getByRole('button', { name: /Выдать ключ/ }).click();
    const form = page.getByRole('dialog');
    assert.equal(await form.getByLabel('Права').inputValue(), 'app');
    assert.equal(await form.getByLabel('TTL').inputValue(), '7d');
    await page.screenshot({ path: join(tmpdir(), 'c189-api-key-form.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.screenshot({ path: join(tmpdir(), 'c189-api-key-form-dark.png') });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
    await form.getByLabel('Метка').fill(active.label);
    const app = form.getByRole('textbox', { name: 'Имя приложения' });
    await app.fill('bad,name');
    await form.getByRole('button', { name: 'Выдать', exact: true }).click();
    await form.getByText('Укажите одно имя', { exact: false }).waitFor();
    assert.equal(requests.length, 0);
    await app.fill(active.scope.apps[0]);
    await form.getByRole('button', { name: 'Выдать', exact: true }).click();
    assert.deepEqual(requests, [{ label: active.label, ttl: '7d', apiBaseUrl: origin, scope: active.scope }]);
    await page.locator('#key-shown-dialog').waitFor();
    assert.equal(await page.locator('#key-shown-value').textContent(), fixtureSecret);
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Скачать файл для ИИ' }).click(),
    ]);
    const text = await readFile(await download.path(), 'utf8');
    assert.ok(text.includes(origin + '/api/apps/sample/'));
    assert.ok(text.includes('DATACORE_API_KEY'));
    assert.ok(!text.includes(fixtureSecret));
    assert.ok(!text.includes('/meta/schema'));
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#key-shown-value').textContent === '');
    await page.getByRole('button', { name: 'Подключение', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('#cx-prompt').value.includes('DATACORE_API_KEY'));
    const preview = await page.locator('#cx-prompt').inputValue();
    assert.ok(!preview.includes(fixtureSecret));
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
