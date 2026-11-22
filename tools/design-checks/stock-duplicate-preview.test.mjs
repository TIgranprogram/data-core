import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const origin = 'https://stock-compare.test';
const source = new URL('../../backend/pwa/', import.meta.url);
const fixture = [
  { id: 'current', name: 'Круглая шайба M10', article: 'WASHER10', unit: 'шт', movements: 2,
    placements: [{ warehouse: 'Склад', zone: 'А', quantity: 30, reserved: 4 }] },
  { id: 'old', name: 'Шайба крепёжная', article: 'OLD-10', unit: 'шт', movements: 1,
    placements: [{ warehouse: 'Склад', zone: 'Б', quantity: 7, reserved: 0 }] },
];

test('Предпросмотр дублей показывает карточки и отдельные места хранения', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const writes = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (request.method() !== 'GET') writes.push(request.method());
      if (url.pathname === '/app/') {
        const src = await readFile(new URL('index.html', source), 'utf8');
        const css = [...src.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)]
          .map(([, href]) => '<link rel="stylesheet" href="/app/' + href + '">').join('');
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html data-theme="soft"><meta charset="utf-8">' + css });
      }
      if (url.pathname === '/api/stock/duplicate-preview') {
        assert.deepEqual([...url.searchParams.values()], ['current', 'old']);
        return route.fulfill({ json: { items: fixture, blockers: ['Перенос остатков и истории пока недоступен.'], canMerge: false } });
      }
      if (url.pathname.startsWith('/app/')) {
        return route.fulfill({ body: await readFile(new URL(url.pathname.slice(5), source)),
          contentType: url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8' });
      }
      return route.fulfill({ status: 404 });
    });
    await page.goto(origin + '/app/');
    await page.evaluate(async () => {
      const { session } = await import('/app/core/api.js');
      const self = await import('/app/sections/stock-duplicate-preview.js');
      session.user = { role: 'manager' };
      const btn = document.createElement('button');
      const action = self.stockDuplicateAction();
      btn.textContent = action.label;
      btn.onclick = () => action.run(['current', 'old']);
      document.body.append(btn);
    });
    await page.getByRole('button', { name: 'Сравнить дубли' }).click();
    const dialog = page.getByRole('dialog').filter({ hasText: 'Сравнение складских дублей' });
    await dialog.getByText('Круглая шайба M10', { exact: true }).waitFor();
    const slots = dialog.getByRole('table', { name: 'Остатки по местам хранения' });
    assert.equal(await slots.getByRole('row', { name: /WASHER10.*Склад.*А.*30.*4/ }).count(), 1);
    assert.equal(await slots.getByRole('row', { name: /OLD-10.*Склад.*Б.*7.*0/ }).count(), 1);
    await dialog.getByText('Перенос остатков и истории пока недоступен.').waitFor();
    await page.screenshot({ path: join(tmpdir(), 'c192-stock-duplicate-preview.png') });
    await dialog.getByRole('button', { name: 'Закрыть' }).click();
    assert.deepEqual(writes, []);
  } finally {
    await browser.close();
  }
});
