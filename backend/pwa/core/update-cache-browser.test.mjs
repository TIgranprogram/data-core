import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname } from 'node:path';
import test from 'node:test';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';

const assets = new URL('../', import.meta.url);
const info = { v: 'release', n: 1091 };
const user = { role: 'manager', requestCartCreate: true, sections: ['requests'] };
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

test('«Заявки» восстанавливаются при несовместимом api.js в кэше текущего выпуска', { timeout: 25_000 }, async t => {
  let mainAvailable = true;
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/app/setup.html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Подготовка кэша</title>');
    } else if (pathname === '/app/version.json' || pathname.startsWith('/api/')) {
      res.setHeader('Content-Type', 'application/json');
      const items = pathname === '/api/stock/lookup'
        ? [{ id: 'sample', name: 'Винт М6', categoryName: 'Крепёж', unit: 'шт' }]
        : [];
      const body = pathname === '/app/version.json' ? info : pathname === '/api/auth/me' ? user : { items, counts: {}, facets: {} };
      res.end(JSON.stringify(body));
    } else if (pathname.startsWith('/app/')) {
      const file = pathname.slice(5) || 'index.html';
      if (file === 'main.js' && !mainAvailable) { res.writeHead(503).end(); return; }
      const asset = new URL('./' + file, assets);
      if (!asset.href.startsWith(assets.href)) { res.writeHead(404).end(); return; }
      try {
        const body = await readFile(asset);
        res.setHeader('Content-Type', mime[extname(file)] || 'application/octet-stream');
        res.end(body);
      } catch { res.writeHead(404).end(); }
    } else {
      res.writeHead(404).end();
    }
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  page.setDefaultTimeout(7000);
  const url = `http://127.0.0.1:${server.address().port}/app/`;
  await page.addInitScript(account => {
    localStorage.setItem('dca_user', JSON.stringify(account));
    localStorage.setItem('dca_access', 'synthetic');
    localStorage.setItem('dca_refresh', 'synthetic');
  }, user);
  await page.goto(url + 'setup.html');
  await page.evaluate(async () => { await navigator.serviceWorker.register('sw.js'); });
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
  const oldName = await page.evaluate(async version => {
    const meta = await caches.open('dc-app-meta');
    const name = 'dc-shell-' + version.v;
    const shell = await caches.open(name);
    const source = await (await fetch('core/api.js')).text();
    const oldSource = source.replace(/^export const canUseRequestCart[^\r\n]*/m, '');
    if (source === oldSource) throw new Error('Тест не воспроизвёл старое содержимое api.js');
    await shell.put('core/api.js', new Response(oldSource, { headers: { 'Content-Type': 'text/javascript' } }));
    await meta.put('./__cur', new Response(JSON.stringify({ name, v: version.v, info: version })));
    return name;
  }, info);
  const oldApi = await page.evaluate(async () => (await fetch('core/api.js')).text());
  assert.doesNotMatch(oldApi, /export const canUseRequestCart/);

  await page.goto(url + '#requests');
  const catalog = page.getByRole('button', { name: 'Из каталога', exact: true });
  const failure = page.getByText('Раздел не открылся', { exact: true });
  await catalog.or(failure).first().waitFor({ timeout: 15_000 });
  assert.equal(await failure.count(), 0, 'Экран снова упал после автоматической перезагрузки');
  assert.equal(await catalog.count(), 1);
  const current = await page.evaluate(async () => (await (await caches.open('dc-app-meta')).match('./__cur')).json());
  assert.equal(current.v, info.v);
  assert.notEqual(current.name, oldName);
  await catalog.click();
  await page.getByRole('heading', { name: 'Категории номенклатуры' }).waitFor();

  mainAvailable = false;
  const afterFailedRefresh = await page.evaluate(async () => {
    const channel = new MessageChannel();
    const done = new Promise(resolve => { channel.port1.onmessage = resolve; });
    navigator.serviceWorker.controller.postMessage({ type: 'apply' }, [channel.port2]);
    await done;
    channel.port1.close();
    const meta = await caches.open('dc-app-meta');
    return { current: await (await meta.match('./__cur')).json(), names: await caches.keys() };
  });
  assert.deepEqual(afterFailedRefresh.current, current, 'При неполной загрузке прежняя оболочка должна сохраниться');
  assert.ok(!afterFailedRefresh.names.includes(oldName), 'Недособранный кэш не должен участвовать в запасной загрузке');
});
