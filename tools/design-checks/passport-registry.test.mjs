import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
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
const evidence = process.env.C201_EVIDENCE || tmpdir();
const rows = [
  { incomeId: 'first', lineNo: 1, title: 'Скамья', qty: 2, state: 'issued', document: { id: 'passport', number: '622', revision: 2 } },
  { incomeId: 'second', lineNo: 2, title: 'Урна', qty: 1, state: 'attached', document: { id: 'pdf', fileName: 'Паспорт урны.pdf' } },
];

test('Частичная передача оставляет остаток в работе и сохраняет отдельные даты в истории', async () => {
  await mkdir(evidence, { recursive: true });
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: 'reduce' });
    const errors = [];
    const writes = [];
    let printed = 0, secondReady = false;
    const history = [];
    page.on('pageerror', error => errors.push(error.message));
    const view = () => {
      const lines = rows.map((line, index) => {
        const receipt = history.find(record => record.rows.some(row => row.incomeId === line.incomeId));
        return index === 1 && !secondReady ? { ...line, state: 'missing', document: undefined } : { ...line, handedOn: receipt?.handedOn };
      });
      const handed = lines.filter(line => line.handedOn).length;
      return {
        ...order, ready: secondReady ? 2 : 1, handed, orderId: order.id, rows: lines, unlinked: [], fingerprint: 'a'.repeat(64),
        canHandover: handed < (secondReady ? 2 : 1), history, current: handed === rows.length ? history[0] : null,
      };
    };
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
        const current = view();
        const mode = url.searchParams.get('state');
        const hidden = (mode === 'handover' && !current.canHandover) || (mode === 'work' && current.current);
        const items = hidden ? [] : [{ ...order, ready: current.ready, handed: current.handed, handedOn: current.current?.handedOn }];
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
        history.unshift({ recipient: body.recipient, handedOn: body.handedOn, actorName: 'менеджер', rows: rows.filter(row => body.incomeIds.includes(row.incomeId)) });
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
    await inline.getByText('Не выпущен', { exact: true }).waitFor();
    assert.equal(await inline.getByRole('checkbox').count(), 1);
    assert.equal(await inline.getByRole('button', { name: 'Передано заказчику' }).isDisabled(), true);
    await page.screenshot({ path: join(evidence, 'registry-ready.png') });
    await inline.getByRole('button', { name: 'Печать реестра…' }).click();
    await page.getByRole('dialog').getByTitle('Реестр паспортов').waitFor();
    await page.getByRole('button', { name: 'Вернуться к правке' }).click();
    assert.equal(printed, 1);
    assert.deepEqual(writes, []);

    await inline.getByRole('checkbox').check();
    await inline.getByRole('button', { name: 'Передано заказчику' }).click();
    await page.getByRole('dialog').getByLabel('Получатель').fill('Петров П. П.');
    await page.getByRole('dialog').getByLabel('Дата передачи').fill('2026-11-21');
    await page.screenshot({ path: join(evidence, 'registry-dialog-soft.png') });
    await page.getByRole('button', { name: 'Подтвердить передачу' }).click();
    await inline.getByText('Передано 1 из 2.', { exact: true }).waitFor();
    assert.deepEqual(writes.map(write => write.incomeIds), [['first']]);
    assert.equal(writes[0].recipient, 'Петров П. П.');
    await page.screenshot({ path: join(evidence, 'registry-partial.png') });
    await page.getByRole('tab', { name: 'К передаче', exact: true }).click();
    await page.getByText('Готовых паспортов к передаче нет.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Открыть «В работе»' }).click();
    await page.getByRole('row', { name: /20-26.*Учебный заказчик/ }).waitFor();
    secondReady = true;
    await page.getByRole('tab', { name: 'К передаче', exact: true }).click();
    await page.getByRole('row', { name: /20-26.*Учебный заказчик/ }).click();
    await inline.getByRole('row', { name: /Урна/ }).getByRole('checkbox').check();
    assert.equal(await inline.getByRole('checkbox').count(), 1);
    await inline.getByRole('button', { name: 'Передано заказчику' }).click();
    await page.getByRole('dialog').getByLabel('Получатель').fill('Учебный получатель');
    await page.getByRole('dialog').getByLabel('Дата передачи').fill('2026-11-22');
    await page.getByRole('button', { name: 'Подтвердить передачу' }).click();
    await page.getByText('Готовых паспортов к передаче нет.', { exact: true }).waitFor();
    assert.deepEqual(writes.map(write => write.incomeIds), [['first'], ['second']]);
    await page.getByRole('tab', { name: 'История передачи' }).click();
    await page.getByRole('row', { name: /20-26.*Учебный заказчик/ }).click();
    await inline.getByText('Передано 2 из 2.', { exact: true }).waitFor();
    const allRows = inline.getByRole('table', { name: 'Позиции реестра паспортов' }).first();
    await allRows.getByRole('row', { name: /Скамья.*21.11.2026/ }).waitFor();
    await allRows.getByRole('row', { name: /Урна.*22.11.2026/ }).waitFor();
    await page.setViewportSize({ width: 2560, height: 1080 });
    await page.screenshot({ path: join(evidence, 'registry-history.png') });
    const older = inline.locator('details').filter({ hasText: '21.11.2026 · Петров П. П.' });
    await older.locator('summary').click();
    await older.getByText('Отметил: менеджер', { exact: true }).waitFor();
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await page.setViewportSize({ width: 1024, height: 900 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: join(evidence, 'registry-history-dark-1024.png'), animations: 'disabled' });
    await inline.getByRole('button', { name: 'Печать реестра…' }).click();
    await page.locator('iframe[src^="blob:"]').waitFor();
    const reprint = page.waitForResponse(response => new URL(response.url()).pathname === base + '/order/pdf');
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await reprint;
    assert.equal(printed, 3);
    assert.equal(writes.length, 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
