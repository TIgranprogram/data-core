import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const origin = 'http://design-composition.test';
const app = new URL('../../backend/pwa/', import.meta.url);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const id = (n) => String(n).padStart(24, '0');
const [designId, productId, moduleId, detailId, moduleLineId, detailLineId, workId] = [1, 2, 3, 4, 5, 6, 7].map(id);
const workflow = '/api/work-tasks/design/' + designId;
const endpoint = workflow + '/modules/' + moduleLineId;
const catalogModule = { id: moduleId, name: 'Рама', article: 'M-1', workTypes: [{ workTypeId: { id: workId, name: 'Сварка' } }] };
const catalogDetail = { id: detailId, name: 'Уголок', article: 'D-1', materialKind: 'part' };
const rootModule = { id: moduleLineId, lineType: 'module', refId: moduleId, quantity: 2, sortOrder: 0 };
const detail = { id: detailLineId, lineType: 'material', refId: detailId, quantity: 3, sortOrder: 1 };

test('Состав в карточке задачи, перенос вложенной детали и готовность модуля', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const user = { id: 'fixture', username: 'Учебная учётная запись', role: 'manager' };
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const row = { id: designId, code: 'D-12', status: 'work', productId, incomeId: id(11), orderId: id(12), productionNo: '25-26',
    qty: 3, productName: 'Навес', production: { state: 'ready-for-review', productId } };
  let root = [rootModule, detail], nested = [], ready = false, job = null;
  const writes = [];
  await page.addInitScript((user) => {
    sessionStorage.setItem('dca_access', 'fixture');
    sessionStorage.setItem('dca_refresh', 'fixture');
    sessionStorage.setItem('dca_user', JSON.stringify(user));
  }, user);
  await page.route('**/*', async (route) => {
    const request = route.request();
    const parsed = new URL(request.url());
    if (parsed.origin !== origin) return route.abort();
    const path = parsed.pathname;
    if (path.startsWith('/app/')) {
      const name = path.slice(5) || 'index.html';
      try { return route.fulfill({ contentType: mime[extname(name)] || 'application/octet-stream', body: await readFile(new URL(name, app)) }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; return route.fulfill({ status: 404 }); }
    }
    if (path === '/api/auth/me') return route.fulfill({ json: user });
    if (path === '/api/design-board') return route.fulfill({ json: { tasks: [row], orders: [], stickers: [] } });
    if (path === '/api/design-tasks/' + designId) return route.fulfill({ json: row });
    if (path === '/api/products/' + productId + '/composition') return route.fulfill({ json: root });
    if (path === '/api/modules') return route.fulfill({ json: [catalogModule] });
    if (path === '/api/modules/' + moduleId) return route.fulfill({ json: catalogModule });
    if (path === '/api/modules/' + moduleId + '/composition') return route.fulfill({ json: nested });
    if (path === '/api/materials') return route.fulfill({ json: { items: parsed.searchParams.get('materialKind') === 'part' ? [catalogDetail] : [] } });
    if (path === '/api/work-types') return route.fulfill({ json: [{ id: workId, name: 'Сварка' }] });
    if (path === '/api/dicts/attachmentTypes') return route.fulfill({ json: { items: [{ id: id(17), name: 'Чертежи' }] } });
    if (path === '/api/incomes/' + row.incomeId + '/attachments') return route.fulfill({ json: { items: [
      { id: id(18), typeId: id(17), scope: 'line', originalName: 'Чертёж рамы.pdf', mime: 'application/pdf', size: 102400 },
    ] } });
    if (path === workflow + '/modules') return route.fulfill({ json: { editable: true, items: [{ lineId: moduleLineId, hasRoute: true, ready, task: job }] } });
    if (request.method() !== 'GET') {
      const body = request.postDataJSON();
      writes.push({ path, body });
      if (path === workflow + '/composition') {
        root = [rootModule];
        nested = [detail];
      } else if (path === endpoint) ready = body.ready;
      else if (path === endpoint + '/launch') {
        assert.equal(ready, true);
        job = { id: id(32), code: 'W-32', status: 'work' };
        return route.fulfill({ json: job });
      } else return route.fulfill({ status: 400, json: { message: 'Незнакомая запись' } });
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  try {
    await page.goto(origin + '/app/#design?open=' + designId);
    const card = page.locator('.drawer').last();
    await card.getByText('Состав изделия', { exact: true }).waitFor();
    await card.getByText('Уголок', { exact: true }).click();
    await card.getByText('Переместить деталь', { exact: true }).click();
    await card.getByRole('combobox', { name: 'Куда перенести деталь' }).selectOption(moduleId);
    await card.getByRole('button', { name: 'Перенести', exact: true }).click();
    await page.locator('form.modal').getByRole('button', { name: 'Перенести', exact: true }).click();
    await card.getByText('Уголок', { exact: true }).waitFor({ state: 'detached' });
    await card.getByText('Рама', { exact: true }).click();
    await card.getByText('Сварка', { exact: true }).waitFor();
    await card.getByText('Уголок', { exact: true }).waitFor();

    const send = card.getByRole('button', { name: 'Передать модуль в работу' });
    assert.equal(await send.isDisabled(), true);
    await card.getByRole('checkbox', { name: 'Готово к работе' }).click();
    await send.click();
    const link = card.getByRole('link', { name: 'Передано в работу · W-32' });
    assert.equal(await link.getAttribute('href'), '#work?open=' + id(32));
    await card.getByText('Чертежи', { exact: true }).click();
    await card.getByText('Чертёж рамы.pdf', { exact: true }).waitFor();
    if (process.env.C195_EVIDENCE) {
      await mkdir(process.env.C195_EVIDENCE, { recursive: true });
      await card.screenshot({ path: join(process.env.C195_EVIDENCE, 'composition-1920.png'), animations: 'disabled' });
    }
    assert.deepEqual(writes, [
      { path: workflow + '/composition', body: { action: 'move', lineId: detailLineId, toModuleId: moduleId } },
      { path: endpoint, body: { ready: true } },
      { path: endpoint + '/launch', body: {} },
    ]);
  } finally { await browser.close(); }
});
