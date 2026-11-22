import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const origin = 'https://registry.test';
const app = new URL('../../backend/pwa/', import.meta.url);
const pdf = new URL('../../docs/crew/C173-passport-independent-release-check/evidence/order-lines/short-r1.pdf', import.meta.url);
const base = '/api/passports/registry';
const order = { id: 'order', productionNo: '20-26', orderNo: 'К-12', customer: 'Учебный заказчик', ready: 2, positions: 2 };
const rows = [
  { incomeId: 'first', lineNo: 1, title: 'Скамья', qty: 2, state: 'issued', document: { id: 'passport', number: '622', revision: 2 } },
  { incomeId: 'second', lineNo: 2, title: 'Урна', qty: 1, state: 'attached', document: { id: 'pdf', fileName: 'Паспорт урны.pdf' } },
];

test('Реестр раскрывается под строкой, печатается отдельно и уходит из очереди после передачи', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    const errors = [];
    const writes = [];
    let printed = 0, receipt = null;
    page.on('pageerror', error => errors.push(error.message));
    const view = () => ({
      ...order, orderId: order.id, rows, unlinked: [], fingerprint: 'a'.repeat(64),
      canHandover: !receipt, history: receipt ? [receipt] : [], current: receipt,
    });
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/app/') {
        const src = await readFile(new URL('index.html', app), 'utf8');
        const css = [...src.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)]
          .map(([, href]) => '<link rel="stylesheet" href="/app/' + href + '">').join('');
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html data-theme="soft"><meta charset="utf-8">' + css + '<main class="main"><section class="page" id="fixture"></section></main>' });
      }
      if (url.pathname === base) {
        const items = receipt && ['work', 'handover'].includes(url.searchParams.get('state')) ? [] : [{ ...order, handedOn: receipt?.handedOn }];
        return route.fulfill({ json: { items, total: items.length, page: 1, limit: 20 } });
      }
      if (url.pathname === base + '/order') return route.fulfill({ json: view() });
      if (url.pathname === base + '/order/pdf') {
        printed++;
        return route.fulfill({ contentType: 'application/pdf', body: await readFile(pdf) });
      }
      if (url.pathname === base + '/order/handover' && route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        writes.push(body);
        receipt = { recipient: body.recipient, handedOn: body.handedOn, actorName: 'менеджер', rows };
        return route.fulfill({ json: view() });
      }
      if (url.pathname.startsWith('/app/')) {
        return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'application/javascript',
          body: await readFile(new URL(url.pathname.slice(5), app)) });
      }
      return route.fulfill({ status: 404 });
    });
    await page.goto(origin + '/app/');
    await page.evaluate(async () => {
      const { session } = await import('/app/core/api.js');
      const { mountRegistryTab } = await import('/app/sections/docs-registries.js');
      session.user = { role: 'manager' };
      document.querySelector('#fixture').append(mountRegistryTab().el);
    });
    await page.getByRole('row', { name: /20-26.*Учебный заказчик/ }).click();
    const inline = page.locator('tr.k-pos-more');
    await inline.getByText('Паспорт урны.pdf', { exact: true }).waitFor();
    await page.screenshot({ path: join(tmpdir(), 'c197-registry-soft.png') });
    await inline.getByRole('button', { name: 'Печать реестра…' }).click();
    await page.getByRole('dialog').getByTitle('Реестр паспортов').waitFor();
    await page.getByRole('button', { name: 'Вернуться к правке' }).click();
    assert.equal(printed, 1);
    assert.deepEqual(writes, []);

    await inline.getByRole('button', { name: 'Передано заказчику' }).click();
    await page.getByRole('dialog').getByLabel('Получатель').fill('Петров П. П.');
    await page.getByRole('dialog').getByLabel('Дата передачи').fill('2026-11-21');
    await page.getByRole('button', { name: 'Подтвердить передачу' }).click();
    await page.getByText('Нет незавершённых комплектов', { exact: true }).waitFor();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].recipient, 'Петров П. П.');
    await page.getByRole('tab', { name: 'История передачи' }).click();
    await page.getByRole('row', { name: /20-26.*Учебный заказчик/ }).click();
    await inline.getByText('Передано 21.11.2026 · Петров П. П.', { exact: true }).waitFor();
    await page.setViewportSize({ width: 2560, height: 1080 });
    await page.screenshot({ path: join(tmpdir(), 'c197-handover-soft.png') });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
