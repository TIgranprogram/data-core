import assert from 'node:assert/strict';
import { access, mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { fileURLToPath } from 'node:url';
import { findBrowser } from '../browser-path.mjs';

const host = 'http://trash-fixture.test';
const effects = [];
const id = '64215c887107d363e7fcff11';
const actor = '650000000000000000000001';
const title = 'Скамья парковая, левый торец';
const sale = '652000000000000000000001';
const css = ['tokens', 'base', 'list', 'form', 'screens', 'panels', 'kit/kit'];
const proof = '../../docs/crew/C220-trash-restore/proof/';
const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
const fig = file => fileURLToPath(new URL(proof + file, import.meta.url));
if (process.env.C220_EVIDENCE) await mkdir(new URL(proof, import.meta.url), { recursive: true });

async function mount(role, theme) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const manager = role === 'manager';
  const section = manager ? 'requests' : 'products';
  const endpoint = manager ? '/api/supply/requests' : '/api/showcase';
  const item = manager ? { id, title, num: 42, qty: 1, status: 'requested' } : { id, name: title };
  const events = [];
  let deleted = true, blocked = false;
  await page.addInitScript(({ actor, role, section }) => {
    sessionStorage.setItem('dca_user', JSON.stringify({ id: actor, role, sections: [section] }));
    sessionStorage.setItem('dca_access', 'fixture');
  }, { actor, role, section });
  await page.route('**/*', async (route) => {
    const target = new URL(route.request().url());
    if (target.origin !== host) return route.abort();
    const { pathname } = target, method = route.request().method();
    if (pathname === '/app/') return route.fulfill({ contentType: 'text/html', body: [
      '<!doctype html><html lang="ru" data-theme="' + theme + '"><meta charset="utf-8">',
      ...css.map((f) => '<link rel="stylesheet" href="ui/' + f + '.css">'),
      '<main class="main"><div id="trash-fixture"></div></main>',
      '<script type="module">import {mountTrash} from "./sections/trash.js"; document.querySelector("#trash-fixture").append(mountTrash().el);</script>',
    ].join('') });
    if (pathname === '/api/auth/confirm' && method === 'POST') {
      events.push({ auth: true });
      return route.fulfill({ json: { token: 'fixture-confirm' } });
    }
    if (pathname === endpoint && method === 'GET') return route.fulfill({ json: {
      items: deleted ? [{ ...item, deletedAt: '2026-11-22T10:00:00Z' }] : [],
    } });
    if (pathname === endpoint + '/' + id + '/restore' && method === 'POST') {
      events.push({ restore: true, confirmed: route.request().headers()['x-confirm-token'] === 'fixture-confirm' });
      if (deleted) deleted = false;
      await new Promise((resolve) => setTimeout(resolve, 120));
      return route.fulfill({ json: item });
    }
    if (pathname === endpoint + '/' + id && method === 'DELETE') {
      events.push({ remove: true, confirmed: route.request().headers()['x-confirm-token'] === 'fixture-confirm' });
      if (blocked) return route.fulfill({ status: 409, json: { message: 'Запись уже используется' } });
      deleted = true;
      return route.fulfill({ json: { ok: true } });
    }
    if (pathname === endpoint + '/' + id && method === 'GET') return route.fulfill({ json: item });
    if (/^\/api\//.test(pathname)) return route.fulfill({ json: { items: [] } });
    if (!/^\/app\/[a-zA-Z0-9_.\/-]+\.(?:js|css|woff2)$/.test(pathname) || pathname.includes('..')) return route.abort();
    const file = fileURLToPath(new URL('../../backend/pwa/' + pathname.slice(5), import.meta.url));
    try { await access(file); } catch { return route.abort(); }
    const contentType = pathname.endsWith('.js') ? 'application/javascript' : pathname.endsWith('.css') ? 'text/css' : 'font/woff2';
    return route.fulfill({ path: file, contentType });
  });
  await page.goto(host + '/app/');
  const restore = page.getByRole('button', { name: /Восстановить «.+торец»/ });
  if (role === 'user') await page.getByText(title, { exact: true }).waitFor();
  else await restore.waitFor();
  return { page, events, restore, blocked(value) { blocked = value; } };
}

try {
  const { page, events, restore } = await mount('admin', 'soft');
  assert.equal(await restore.getAttribute('title'), 'Восстановить');
  assert.equal(await restore.locator('span[aria-hidden=true]').textContent(), '↶');
  await page.evaluate(() => { document.querySelector('.table-wrap table').style.minWidth = '1700px'; });
  await page.waitForFunction(() => {
    const wrap = document.querySelector('.table-wrap');
    return wrap.scrollWidth > wrap.clientWidth && wrap.scrollLeft === 0
      && wrap.querySelector('.k-col-act button').getBoundingClientRect().right < wrap.getBoundingClientRect().right;
  });
  await page.evaluate(() => { document.querySelector('.table-wrap table').style.minWidth = ''; });
  if (process.env.C220_EVIDENCE) await page.getByRole('table', { name: 'Изделия' }).screenshot({ path: fig('restore-button-soft.png'), animations: 'disabled' });
  await restore.click();
  let dialog = page.getByRole('dialog');
  assert.match(await dialog.innerText(), /Скамья парковая/);
  assert.equal(await dialog.getByRole('button', { name: 'Отмена' }).evaluate((el) => document.activeElement === el), true);
  if (process.env.C220_EVIDENCE) await page.screenshot({ path: fig('confirmation-soft.png') });
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  assert.equal(events.length, 0);
  assert.equal(await restore.evaluate((el) => document.activeElement === el && !el.disabled), true);
  await restore.dblclick();
  assert.equal(events.length, 0);
  if (!(await dialog.isVisible())) await restore.click();
  await dialog.getByRole('button', { name: 'Восстановить', exact: true }).click();
  const back = page.getByRole('button', { name: 'Вернуть в корзину', exact: true });
  await back.waitFor();
  assert.deepEqual(events, [{ restore: true, confirmed: false }]);
  assert.equal(await page.getByRole('button', { name: 'Открыть запись' }).isVisible(), true);
  await back.click();
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  await back.waitFor();
  assert.deepEqual(events, [{ restore: true, confirmed: false }]);
  await back.click();
  await dialog.getByRole('button', { name: 'Вернуть в корзину' }).click();
  await restore.waitFor();
  assert.deepEqual(events, [{ restore: true, confirmed: false }, { remove: true, confirmed: false }]);

  const history = await page.evaluate(async ({ sale, id }) => {
    const { history } = await import('./sections/history.js');
    const row = (type, key) => ({
      entityType: type, entityId: key, title: 'Восстановленная запись', action: 'restored',
    });
    return ['SalesOrder', 'Income', 'CommercialOffer', 'Product', 'DesignTask', 'WorkTask'].map((type) =>
      history.card.view(row(type, type === 'SalesOrder' ? sale : id))[2][1].getAttribute('href'));
  }, { sale, id });
  assert.deepEqual(history, [
    '#' + 'salesorders?open=' + sale + '&of=salesorder',
    '#' + 'salesorders?open=' + id + '&of=orders',
    '#' + 'offers?open=' + id,
    '#' + 'products?open=' + id,
    '#' + 'design?open=' + id,
    '#' + 'work?open=' + id,
  ]);
  effects.push('админ: ширина, отмена, один restore, подтверждение возврата, 6 ссылок из истории');

  const m = await mount('manager', 'dark');
  await m.restore.click();
  dialog = m.page.getByRole('dialog');
  assert.match(await dialog.innerText(), /Скамья парковая/);
  assert.equal(await dialog.locator('input[type=password]').isVisible(), true);
  await dialog.getByRole('button', { name: 'Отмена' }).click();
  assert.equal(m.events.length, 0);
  await m.restore.click();
  await dialog.locator('input[type=password]').fill('fixture');
  await dialog.getByRole('button', { name: 'Подтвердить' }).click();
  const managerBack = m.page.getByRole('button', { name: 'Вернуть в корзину', exact: true });
  await managerBack.waitFor();
  if (process.env.C220_EVIDENCE) await m.page.screenshot({ path: fig('restored-dark.png'), animations: 'disabled' });
  assert.deepEqual(m.events, [{ auth: true }, { restore: true, confirmed: true }]);
  await managerBack.click();
  assert.match(await dialog.innerText(), /Скамья парковая/);
  await dialog.locator('input[type=password]').fill('fixture');
  await dialog.getByRole('button', { name: 'Подтвердить' }).click();
  await m.restore.waitFor();
  assert.deepEqual(m.events, [{ auth: true }, { restore: true, confirmed: true }, { auth: true }, { remove: true, confirmed: true }]);
  effects.push('менеджер: пароль для обеих операций, отмена без POST, именованное уведомление');
  const viewer = await mount('user', 'dark');
  assert.equal(await viewer.restore.count(), 0);
  effects.push('наблюдатель: запись видна без кнопки');
  console.log(JSON.stringify(effects));
} finally { await browser.close(); }
