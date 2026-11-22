
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const app = new URL('../../backend/pwa/', import.meta.url);
const origin = 'https://archive.test';
const archive = '/api/salesorders/order/archive';
const claim = { reason: 'Работы приняты', expectedStateVersion: 0, evidenceDocumentUid: 'act',
  manufactureComplete: true, servicesComplete: true, installationComplete: true, documentsComplete: true };
const savedVersion = { version: 1, archivedAt: '2026-11-22T10:30:00+03:00', reason: 'Работы приняты' };
const original = new URL('../../docs/crew/C173-passport-independent-release-check/evidence/order-lines/short-r1.pdf', import.meta.url);

test('Архив договора показывает готовность, сохранённый PDF и возобновление по роли', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    let state = 0;
    let shownPdf = 0;
    const writes = [];
    const errors = [];
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    page.on('pageerror', err => errors.push(err.message));
    await page.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (url.pathname === '/app/') {
        const index = await readFile(new URL('index.html', app), 'utf8');
        const styles = [...index.matchAll(/<link rel="stylesheet" href="([^"]+)"[^>]*>/g)]
          .map(([, href]) => '<link rel="stylesheet" href="/app/' + href + '">').join('');
        return route.fulfill({ contentType: 'text/html; charset=utf-8', body:
          '<!doctype html><meta charset="utf-8">' + styles + '<main class="drawer"><header class="drawer-head"><div class="t"><h2>Договор 118</h2></div></header><div class="drawer-body" id="body"></div></main>' });
      }
      if (url.pathname.startsWith('/app/')) {
        return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'application/javascript; charset=utf-8',
          body: await readFile(new URL(url.pathname.slice(5), app)) });
      }
      if (url.pathname === archive + '/readiness') {
        const evidence = url.searchParams.get('evidenceDocumentUid') === 'act';
        return route.fulfill({ json: { ready: evidence, stateVersion: state, blockers: evidence ? [] : [{ code: 'ACCEPTANCE_REQUIRED', message: 'Выберите акт приёмки.' }] } });
      }
      if (request.method() === 'POST' && [archive, archive + '/reopen'].includes(url.pathname)) {
        const { clientUid, ...body } = request.postDataJSON();
        assert.ok(clientUid);
        writes.push({ path: url.pathname, body });
        if (url.pathname === archive && !body.evidenceDocumentUid) return route.fulfill({ status: 409, json: { message: 'Выберите акт приёмки.' } });
        state++;
        return route.fulfill({ json: { version: 1, stateVersion: state } });
      }
      if (url.pathname === archive) return route.fulfill({ json: {
        activeArchiveVersion: state === 1 ? 1 : null, stateVersion: state, items: state ? [savedVersion] : [],
      } });
      if (url.pathname === archive + '/1') return route.fulfill({ json: {
        order: { orderNo: '118', customer: 'Тестовое предприятие' }, lines: [{ title: 'Тестовая урна', qty: 2, unit: 'шт.' }],
        files: [{ id: 'passport-1', mime: 'application/pdf', name: 'Паспорт позиции.pdf' }],
      } });
      if (url.pathname === archive + '/1/files/passport-1') {
        shownPdf++;
        return route.fulfill({ contentType: 'application/pdf', body: await readFile(original) });
      }
      return route.fulfill({ status: 404 });
    });
    await page.goto(origin + '/app/');
    const mount = async (role, version, stateVersion) => page.evaluate(async ({ role, version, stateVersion }) => {
      const { h } = await import('/app/core/dom.js');
      const { session } = await import('/app/core/api.js');
      const { orderArchiveBlock, orderArchiveActions } = await import('/app/sections/order-archive.js');
      session.user = { role, canMoney: true };
      const order = { id: 'order', orderNo: '118', stage: version ? 'closed' : 'shipped', activeArchiveVersion: version, archiveStateVersion: stateVersion,
        legal: { documents: [{ kind: 'acceptance', uid: 'act', number: 'А-8', date: '2026-11-22' }] } };
      const card = document.querySelector('#body');
      card.replaceChildren(...orderArchiveActions(order, () => {}).map((item) => h('button', { type: 'button', onclick: item.run }, item.label)), orderArchiveBlock(order));
    }, { role, version, stateVersion });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'soft'; });
    await mount('manager', null, 0);
    await page.getByRole('button', { name: 'Закрыть и архивировать', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByText('Выберите акт приёмки.', { exact: true }).waitFor();
    const reasonBounds = await dialog.getByRole('textbox', { name: 'Основание закрытия' }).boundingBox();
    const evidenceBounds = await dialog.getByRole('combobox', { name: 'Акт приёмки' }).boundingBox();
    assert.ok(Math.abs(reasonBounds.x + reasonBounds.width - evidenceBounds.x - evidenceBounds.width) < 2);
    await page.screenshot({ path: join(tmpdir(), 'c188-readiness-soft.png') });
    await dialog.getByRole('textbox', { name: 'Основание закрытия' }).fill(claim.reason);
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Закрыть и архивировать' }).click();
    await dialog.locator('.form-error').getByText('Выберите акт приёмки.').waitFor();
    await dialog.getByRole('combobox', { name: 'Акт приёмки' }).selectOption('act');
    await dialog.getByText('Готовность подтверждена.', { exact: false }).waitFor();
    await dialog.getByRole('button', { name: 'Закрыть и архивировать' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(writes[1], { path: archive, body: claim });

    await page.setViewportSize({ width: 1024, height: 900 });
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await mount('manager', 1, state);
    assert.equal(await page.getByRole('button', { name: /Возобновить/ }).count(), 0);
    await page.getByText('Архив договора', { exact: true }).click();
    await page.getByText(/^Версия 1/).click();
    await page.getByText('Тестовая урна').waitFor();
    await page.screenshot({ path: join(tmpdir(), 'c188-history-dark.png') });
    await page.getByRole('button', { name: 'Открыть PDF' }).click();
    await page.locator('iframe[src^="blob:"]').waitFor();
    assert.equal(shownPdf, 1);
    await page.keyboard.press('Escape');
    await mount('admin', 1, state);
    await page.getByRole('button', { name: 'Возобновить договор…' }).click();
    await dialog.getByRole('textbox', { name: 'Причина возобновления' }).fill('Уточнение поставки');
    await dialog.getByRole('button', { name: 'Возобновить', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.deepEqual(writes[2], { path: archive + '/reopen', body: { reason: 'Уточнение поставки', expectedStateVersion: 1 } });
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

