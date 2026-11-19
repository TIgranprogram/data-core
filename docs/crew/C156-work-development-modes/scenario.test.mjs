// Сессия менеджера только через stdin команды api.sh stand BROWSER.
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = 'http://localhost:3102';
const app = origin + '/app/';
const script = fileURLToPath(import.meta.url);
const dir = path.dirname(script);
// Агент доступа передаёт сценарий api.sh под этим именем для проверки только диалогов.
const dialogsOnly = path.basename(script) === 'c156-dialogs.mjs';
const root = path.resolve(dir, path.basename(dir) === 'logs' ? '../..' : '../../..');
const evidence = path.join(root, 'docs/crew/C156-work-development-modes/evidence');
const timeout = 20_000;
const objectId = /^[\da-f]{24}$/i;
const metaPath = '/app/development.json';
const report = { origin, startedAt: new Date().toISOString(), checks: {}, refusedOrigins: 0, proxyOutside: {},
  pageOutside: {}, workerOutside: {}, blockedWrites: {}, allowedRefreshes: 0, pageErrors: 0 };
const traffic = [];
let authorizedPdf;
let apiUnavailable = false;

class Finding extends Error {}
class MissingFixture extends Error {}
class OutsideOrigin extends Finding {}
function expect(value, reason) { if (!value) throw new Finding(reason); }
const reasonFor = (error) => error instanceof Finding || error instanceof MissingFixture ? error.message
  : error.name === 'TimeoutError' ? 'Ожидаемый элемент или сетевой ответ не появились за отведённое время.'
    : `Ошибка сценария (${error.name || 'Error'}).`;

async function credentials() {
  expect(!process.stdin.isTTY, 'Сессия отсутствует. Нужен запуск через api.sh stand BROWSER.');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    expect(input.length <= 65536, 'Превышен лимит ввода.');
  }
  let session;
  try { session = JSON.parse(input); } catch { throw new Finding('Ожидался JSON от api.sh stand BROWSER.'); }
  expect(typeof session?.access === 'string' && session.access && typeof session.refresh === 'string' && session.refresh
    && session.user?.role === 'manager' && !session.user.isOwner, 'Нужна полная сессия обычного менеджера.');
  return { access: session.access, refresh: session.refresh, user: session.user };
}

async function chromiumOptions() {
  const require = createRequire(path.join(root, 'backend/package.json'));
  const packages = [process.env.STAND_QA_PLAYWRIGHT, 'playwright', 'playwright-core'];
  if (process.env.APPDATA) packages.push(path.join(process.env.APPDATA, 'npm/node_modules/openclaw/node_modules/playwright-core'));
  let chromium;
  for (const candidate of packages.filter(Boolean)) {
    try { ({ chromium } = require(candidate)); } catch { continue; }
    if (chromium) break;
  }
  expect(chromium, 'Установленный Playwright не найден.');
  const executables = [process.env.EDGE, chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  for (const executablePath of executables.filter(Boolean)) {
    try { await access(executablePath); return { chromium, executablePath }; } catch { /* следующий путь */ }
  }
  throw new Finding('Установленный Chromium, Chrome или Edge не найден.');
}

// Прокси видит сетевые обращения SW и редиректы. Проверка origin выполняется до передачи заголовков.
function countOutside(bucket, kind, url) {
  const hostname = /^[a-z0-9.:[\]-]{1,253}$/i.test(url?.hostname || '') ? url.hostname : 'без-имени';
  const port = url?.port || ({ 'http:': '80', 'https:': '443', 'ws:': '80', 'wss:': '443' }[url?.protocol] || '—');
  const label = `${kind} ${hostname}:${port}`;
  bucket[label] = (bucket[label] || 0) + 1;
}

function observeAppRequest(bucket, address, kind) {
  const url = new URL(address);
  if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== origin) countOutside(bucket, kind, url);
}

function assertNoAppOutside() {
  const observed = [...Object.keys(report.pageOutside), ...Object.keys(report.workerOutside)];
  if (observed.length) throw new OutsideOrigin(`Страница или Service Worker обратились за пределы localhost:3102 (${observed.join(', ')}).`);
}

function createGuard() {
  const server = http.createServer((req, res) => {
    let url, route;
    try {
      url = new URL(req.url);
      route = decodeURIComponent(url.pathname);
    } catch { res.writeHead(400).end(); return; }
    if (url.origin !== origin || url.username || url.password) {
      report.refusedOrigins++;
      countOutside(report.proxyOutside, 'HTTP', url);
      res.writeHead(403).end();
      return;
    }
    const target = url.pathname;
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const refresh = req.method === 'POST' && url.href === origin + '/api/auth/refresh';
    const passportPrint = /^\/api\/passports\/(?:.*\/)?(?:pdf|zip)\/?$/i.test(route);
    if ((!read && !refresh) || (passportPrint && (req.method !== 'GET' || url.href !== authorizedPdf))) {
      const key = `${req.method} ${target === '/api/auth/me/prefs' ? 'prefs' : target === '/api/client-errors' ? 'client-errors' : 'другой маршрут'}`;
      report.blockedWrites[key] = (report.blockedWrites[key] || 0) + 1;
      res.writeHead(403, { 'Content-Type': 'application/json' }).end('{}');
      return;
    }
    // Только один запрос для выбранного существующего выпущенного номера.
    if (passportPrint) authorizedPdf = undefined;
    if (refresh) report.allowedRefreshes++;
    const entry = { target, method: req.method, auth: Boolean(req.headers.authorization), cookie: Boolean(req.headers.cookie) };
    traffic.push(entry);
    if (apiUnavailable && target.startsWith('/api/')) {
      entry.status = 503;
      res.writeHead(503, { 'Content-Type': 'application/json' }).end('{}');
      return;
    }
    const headers = { ...req.headers, host: 'localhost:3102' };
    delete headers['proxy-connection'];
    delete headers['proxy-authorization'];
    const upstream = http.request(url, { method: req.method, headers, timeout: 60_000,
      // Адрес задан константой. IPv4 соответствует local bind Docker.
      family: 4 }, (reply) => {
      entry.status = reply.statusCode;
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    upstream.on('timeout', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('connect', (req, socket) => {
    report.refusedOrigins++;
    let url;
    try { url = new URL('https://' + req.url); } catch { /* только агрегат отказа */ }
    countOutside(report.proxyOutside, 'CONNECT', url);
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  server.on('upgrade', (req, socket) => {
    report.refusedOrigins++;
    let url;
    try { url = new URL(req.url); } catch { /* только агрегат отказа */ }
    countOutside(report.proxyOutside, 'Upgrade', url);
    socket.destroy();
  });
  return server;
}

async function check(key, action) {
  const result = report.checks[key] = { status: 'PASS' };
  try {
    assertNoAppOutside();
    await action(result);
    assertNoAppOutside();
  }
  catch (error) {
    result.status = error instanceof MissingFixture ? 'SKIP' : 'FAIL';
    result.reason = reasonFor(error);
    if (error instanceof OutsideOrigin) throw error;
  }
}

async function openContext(browser, session, storage) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: 'light', serviceWorkers: 'allow' });
  context.on('request', (request) => {
    if (request.serviceWorker?.()) observeAppRequest(report.workerOutside, request.url(), request.resourceType());
  });
  await context.addInitScript(({ allowedOrigin, auth, storageType }) => {
    if (window.top !== window || location.origin !== allowedOrigin || location.pathname !== '/app/'
      || new URL(location.href).searchParams.get('qa-entry') !== '1') return;
    const state = storageType === 'session' ? sessionStorage : localStorage;
    state.setItem('dca_access', auth.access);
    state.setItem('dca_refresh', auth.refresh);
    state.setItem('dca_user', JSON.stringify(auth.user));
    const url = new URL(location.href);
    url.searchParams.delete('qa-entry');
    history.replaceState(history.state, '', url);
  }, { allowedOrigin: origin, auth: session, storageType: storage });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  page.on('pageerror', () => { report.pageErrors++; });
  page.on('request', (request) => observeAppRequest(report.pageOutside, request.url(), request.resourceType()));
  page.on('websocket', (socket) => observeAppRequest(report.pageOutside, socket.url(), 'websocket'));
  return { context, page };
}

const banner = (page) => page.getByRole('status').filter({ hasText: /Разработка · копия данных/ });

function validateMetadata(meta, session) {
  const allowedKeys = (obj, keys) => obj && Object.keys(obj).sort().join(',') === keys.split(',').sort().join(',');
  expect(allowedKeys(meta, 'mode,origin,data,code') && allowedKeys(meta.data, 'backup,snapshotAt,restoredAt')
    && allowedKeys(meta.code, 'branch,head,dirty,builtAt'), 'В метаданных отсутствуют ожидаемые поля или присутствуют лишние.');
  expect(meta.mode === 'development' && meta.origin === origin, 'Режим или origin в метаданных не совпадает.');
  const serialized = JSON.stringify(meta);
  expect(!serialized.includes(session.access) && !serialized.includes(session.refresh)
    && !/(eyJ[\w-]+\.[\w-]+\.[\w-]+|mongodb(?:\+srv)?:|kppd_)/i.test(serialized), 'Обнаружено значение, похожее на секрет или URI базы.');
  const archive = /^datacore-(\d{4}-\d\d-\d\d)_(\d\d)(\d\d)(\d\d)\.tgz$/.exec(meta.data.backup);
  expect(archive, 'В метаданных нет имени архива восстановленной копии.');
  const [, day, hour, min, sec] = archive;
  expect(meta.data.snapshotAt === `${day}T${hour}:${min}:${sec}`, 'Дата снимка не соответствует имени архива.');
  expect((meta.data.restoredAt === null || Number.isFinite(Date.parse(meta.data.restoredAt)))
    && Number.isFinite(Date.parse(meta.code.builtAt)), 'Обнаружена некорректная дата восстановления или успешной сборки.');
  expect((meta.code.branch === null || /^[\p{L}\p{N}._/-]+$/u.test(meta.code.branch))
    && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(meta.code.head)
    && typeof meta.code.dirty === 'boolean', 'Поля кода не соответствуют публичной схеме.');
  return day.split('-').reverse().join('.') + ` ${hour}:${min}`;
}

async function assertBanner(page, meta, date) {
  const mark = banner(page);
  await mark.waitFor();
  expect(await mark.locator('.ntf-title').textContent() === `Разработка · копия данных от ${date}`, 'Дата на экране отличается от даты снимка.');
  const tips = await mark.locator('.ntf-sub').textContent();
  expect(tips.includes(`Архив ${meta.data.backup}`) && tips.includes('Восстановление ') && tips.includes('Сборка '), 'В пояснении нет архива, восстановления или сборки.');
}

async function applyTheme(page, theme) {
  return page.evaluate((name) => {
    for (let i = 0; i < 4 && document.documentElement.dataset.theme !== name; i++) window.dcTheme.cycle();
    return document.documentElement.dataset.theme;
  }, theme);
}

async function matrix(page, screen, meta, date, result) {
  const combinations = [[1920, 'light'], [1920, 'dark'], [1024, 'light'], [1024, 'dark']];
  result.layouts = [];
  for (const [width, theme] of combinations) {
    await page.setViewportSize({ width, height: width === 1920 ? 1080 : 768 });
    const applied = await applyTheme(page, theme);
    await assertBanner(page, meta, date);
    await page.evaluate(() => document.fonts.ready);
    const layout = await banner(page).evaluate((mark) => {
      const box = mark.getBoundingClientRect();
      const tip = mark.querySelector('.ntf-sub');
      const body = mark.querySelector('.ntf-body');
      const css = getComputedStyle(mark);
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      return { inViewport: box.top >= 0 && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth + 1,
        readable: parseFloat(css.opacity) > 0 && mark.contains(document.elementFromPoint(x, y)),
        tipFits: tip.scrollWidth <= tip.clientWidth + 1 && body.scrollWidth <= body.clientWidth + 1,
        pageFits: document.documentElement.scrollWidth <= innerWidth + 1, bannerWidth: Math.round(box.width) };
    });
    const item = { width, theme, applied, ...layout };
    result.layouts.push(item);
    expect(applied === theme && layout.inViewport && layout.readable && layout.tipFits && layout.pageFits,
      `Плашка обрезана, перекрыта или выходит за экран (${width}, ${theme}).`);
    const screenshot = screen === 'login' ? (width === 1920) === (theme === 'light') : (width === 1920) === (theme === 'dark');
    if (screenshot) {
      item.screenshot = `qa-${screen}-${width}-${theme}.png`;
      const options = screen === 'today' ? {
        clip: { x: 0, y: 0, width, height: 265 },
        style: '.td-head .sub, .today > :not(.td-head), .sidebar .cnt, .topbar .bell-badge, .topbar [aria-label^="Профиль"], .topbar img { visibility: hidden !important; }',
      } : { mask: [page.locator('input[name="username"]'), page.locator('input[name="password"]')], maskColor: '#7790a5' };
      await page.screenshot({ ...options, path: path.join(evidence, item.screenshot), animations: 'disabled' });
    }
  }
}

async function apiRead(page, endpoint) {
  const result = await page.evaluate(async ({ base, endpoint }) => {
    const token = sessionStorage.getItem('dca_access') || localStorage.getItem('dca_access');
    const response = await fetch(base + endpoint, { redirect: 'error', headers: { Authorization: 'Bearer ' + token } });
    return { status: response.status, body: response.ok ? await response.json() : null };
  }, { base: origin, endpoint });
  expect(result.body, `Чтение API вернуло ${result.status}.`);
  return result.body;
}

async function productBySku(page, sku) {
  const data = await apiRead(page, '/api/showcase?limit=30&search=' + encodeURIComponent(sku));
  return data.items?.find((item) => objectId.test(item.id) && String(item.sku).trim() === sku);
}

async function enter(page) {
  const today = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/today' && response.ok());
  const me = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/auth/me' && response.ok());
  await Promise.all([today, me, page.goto(app + '?qa-entry=1#home')]);
  await page.getByRole('heading', { name: 'Сегодня', exact: true }).waitFor();
  await page.locator('.today .is-loading').first().waitFor({ state: 'hidden' });
  expect(!await page.locator('.today .is-failed').count(), 'Содержимое экрана «Сегодня» не загрузилось.');
}

async function assertLoggedOut(page, previousHeading) {
  await page.getByRole('heading', { name: 'Вход', exact: true }).waitFor();
  const cleared = await page.evaluate((heading) => ({
    local: Object.keys(localStorage).every((key) => !key.startsWith('dca_')),
    session: Object.keys(sessionStorage).every((key) => !key.startsWith('dca_')),
    dom: !document.querySelector('.shell, .drawer-head, #page') && (!heading || !document.body.textContent.includes(heading)),
    loginEmpty: !document.querySelector('input[name="username"]').value && !document.querySelector('input[name="password"]').value,
  }), previousHeading);
  expect(Object.values(cleared).every(Boolean), 'После выхода остались данные в DOM, форме входа или хранилище.');
  return cleared;
}

async function logout(page) {
  await page.getByRole('button', { name: /^Профиль:/ }).click();
  await page.getByRole('menuitem', { name: 'Выйти', exact: true }).click();
}

async function run(browser, session) {
  const { context, page } = await openContext(browser, session, 'local');
  let meta, date, cardHeading;
  await check('login', async (result) => {
    const pending = page.waitForResponse((response) => response.url() === origin + metaPath);
    const [response] = await Promise.all([pending, page.goto(app)]);
    expect(response.ok(), `Метаданные вернули ${response.status()}.`);
    meta = await response.json();
    date = validateMetadata(meta, session);
    result.source = { ...meta.data, head: meta.code.head, dirty: meta.code.dirty, builtAt: meta.code.builtAt };
    await page.getByRole('heading', { name: 'Вход', exact: true }).waitFor();
    await matrix(page, 'login', meta, date, result);
  });

  await check('today', async (result) => {
    await enter(page);
    expect(date, 'Дата публичной копии не подтверждена.');
    await matrix(page, 'today', meta, date, result);
  });

  await check('service-worker', async (result) => {
    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL === location.origin + '/app/sw.js');
    const start = traffic.length;
    const response = page.waitForResponse((reply) => reply.url() === origin + metaPath);
    const [metadata] = await Promise.all([response, page.reload()]);
    await assertBanner(page, meta, date);
    const cache = await page.evaluate(async () => {
      const keys = await caches.keys();
      const stores = await Promise.all(keys.map(async (key) => (await caches.open(key)).keys()));
      const paths = stores.flat().map((request) => new URL(request.url).pathname);
      return { count: keys.length, metadata: paths.includes('/app/development.json'), api: paths.some((p) => p.startsWith('/api/')) };
    });
    const calls = traffic.slice(start).filter((entry) => entry.target === metaPath);
    expect(cache.count > 0 && !cache.metadata && !cache.api && calls.length === 1 && !metadata.fromServiceWorker(),
      'При активном SW метаданные не получены непосредственно из сети или вместе с API попали в CacheStorage.');
    result.cache = cache;
  });

  await check('navigation-and-files', async (result) => {
    let product;
    for (const sku of ['1066', '3209']) {
      const candidate = await productBySku(page, sku);
      if (String(candidate?.photo?.url).startsWith('/uploads/')) { product = candidate; result.fixtureSku = sku; break; }
    }
    if (!product) throw new MissingFixture('Контрольные изделия 1066 и 3209 недоступны с локальным файлом фото.');
    const link = page.locator('a.side-link[href="#products"]');
    if (!await link.isVisible()) await page.locator('button.burger').click();
    await link.click();
    const search = page.getByPlaceholder('Поиск: наименование, артикул, серия…');
    await search.fill(String(product.sku));
    const tile = page.locator(`button.gcard[data-id="${product.id}"]`);
    const row = page.locator('tr[data-i]').filter({ hasText: String(product.sku) }).filter({ hasText: product.name });
    const item = tile.or(row).first();
    await item.scrollIntoViewIfNeeded();
    const image = item.locator('img').first();
    result.imageRendered = await image.evaluate(async (img, base) => {
      try { await img.decode(); } catch { return false; }
      return img.naturalWidth > 0 && new URL(img.currentSrc).origin === base;
    }, origin, { timeout: 5_000 }).catch(() => false);
    await item.click();
    const heading = page.locator('.drawer-head h2').filter({ hasText: product.name });
    await heading.waitFor();
    cardHeading = (await heading.innerText()).trim();
    result.card = Boolean(cardHeading);
    await assertBanner(page, meta, date);
    const before = traffic.length;
    result.file = await page.evaluate(async (file) => {
      const url = new URL(file, location.origin);
      if (url.origin !== location.origin || !url.pathname.startsWith('/uploads/')) return null;
      const response = await fetch(url, { redirect: 'error', cache: 'no-store', credentials: 'omit' });
      return { status: response.status, image: response.headers.get('Content-Type')?.startsWith('image/'),
        hasBytes: (await response.arrayBuffer()).byteLength > 0 };
    }, product.photo.url);
    const filePath = new URL(product.photo.url, origin).pathname;
    result.fileFromNetwork = traffic.slice(before).some((entry) => entry.target === filePath && entry.status === 200);
    // Первый запрос мог наполнить SW-кэш, если thumbnail и оригинал совпадают.
    result.fileObserved = traffic.some((entry) => entry.target === filePath && entry.status === 200);
    expect(result.card && result.imageRendered && result.file?.status === 200 && result.file.image && result.file.hasBytes
      && result.fileObserved, 'Карточка, картинка или локальный файл не подтверждены.');
  });

  await check('issued-pdf', async (result) => {
    const product = await productBySku(page, '3209');
    if (!product) throw new MissingFixture('Контрольное изделие для печати 3209 недоступно.');
    const data = await apiRead(page, `/api/passports?status=issued&productId=${product.id}&limit=30`);
    const existing = data.items?.find((item) => item.status === 'issued' && objectId.test(item.id)
      && String(item.passportNumber) === '613' && item.passportCategory);
    if (!existing) throw new MissingFixture('В копии отсутствует контрольный выпущенный экземпляр 3209 из C155.');
    const endpoint = `/api/passports/${existing.id}`;
    const before = await apiRead(page, endpoint);
    expect(before.status === 'issued' && before.passportNumber === existing.passportNumber && before.textSnapshot?.sections?.length,
      'У контрольного выпущенного экземпляра перед PDF нет номера или сохранённого текста.');
    assertNoAppOutside();
    authorizedPdf = origin + endpoint + '/pdf';
    try {
      result.file = await page.evaluate(async (url) => {
        const token = sessionStorage.getItem('dca_access') || localStorage.getItem('dca_access');
        const response = await fetch(url, { redirect: 'error', headers: { Authorization: 'Bearer ' + token } });
        const bytes = new Uint8Array(await response.arrayBuffer());
        return { status: response.status, type: response.headers.get('Content-Type')?.split(';')[0],
          signature: new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-', bytes: bytes.length };
      }, authorizedPdf);
    } finally { authorizedPdf = undefined; }
    const after = await apiRead(page, endpoint);
    result.sameNumberAndStatus = before.passportNumber === after.passportNumber && before.status === after.status;
    result.qaPdfIssuedAtChanged = Boolean(after.pdfIssuedAt) && after.pdfIssuedAt !== before.pdfIssuedAt;
    expect(result.file.status === 200 && result.file.type === 'application/pdf' && result.file.signature
      && result.sameNumberAndStatus && result.qaPdfIssuedAtChanged, 'PDF, прежний номер и служебная отметка скачивания не подтверждены.');
  });

  await check('logout-local', async (result) => {
    const before = traffic.length;
    result.progress = 'close-drawer';
    if (await page.locator('.drawer-head').count()) {
      await page.keyboard.press('Escape');
      await page.locator('.drawer-head').waitFor({ state: 'detached' });
    }
    result.progress = 'profile-menu';
    await logout(page);
    result.progress = 'verify-storage-and-dom';
    result.cleared = await assertLoggedOut(page, cardHeading);
    await assertBanner(page, meta, date);
    expect(!traffic.slice(before).some((entry) => entry.target === metaPath), 'Выход повторно запросил метаданные в том же документе.');
    await page.reload();
    await assertLoggedOut(page, cardHeading);
    await assertBanner(page, meta, date);
    result.progress = 'reloaded-login';
  });
  await context.close();

  const next = await openContext(browser, session, 'session');
  await check('reentry-and-logout-session', async (result) => {
    await enter(next.page);
    result.temporarySession = await next.page.evaluate(() => Boolean(sessionStorage.getItem('dca_refresh')) && !localStorage.getItem('dca_refresh'));
    expect(result.temporarySession, 'Повторный вход менеджера не использует новое временное хранилище.');
    await assertBanner(next.page, meta, date);
    await logout(next.page);
    result.cleared = await assertLoggedOut(next.page);
    await assertBanner(next.page, meta, date);
  });
  await check('local-outage', async (result) => {
    apiUnavailable = true;
    try {
      const bad = next.page.waitForResponse((response) => response.url().startsWith(origin + '/api/today') && response.status() === 503);
      await Promise.all([bad, next.page.goto(app + '?qa-entry=1&qa-outage=1#home')]);
      await next.page.getByText(/Сервер перезапускается или недоступен/).first().waitFor();
      await assertBanner(next.page, meta, date);
      result.stayedLocal = new URL(next.page.url()).origin === origin;
      expect(result.stayedLocal, 'При недоступности локального API приложение сменило origin.');
    } finally { apiUnavailable = false; }
  });
  await next.context.close();

  await check('network-isolation', async (result) => {
    const metadata = traffic.filter((entry) => entry.target === metaPath);
    const successfulApi = traffic.filter((entry) => entry.target.startsWith('/api/') && entry.status >= 200 && entry.status < 300);
    result.metadataRequests = metadata.length;
    result.successfulLocalApiRequests = successfulApi.length;
    result.allMetadataWithoutCredentials = metadata.length > 0 && metadata.every((entry) => !entry.auth && !entry.cookie);
    result.unexpectedWrites = Object.entries(report.blockedWrites)
      .filter(([key]) => !key.endsWith(' prefs') && !key.endsWith(' client-errors')).reduce((count, [, value]) => count + value, 0);
    result.proxyBlockedOutside = report.refusedOrigins;
    expect(result.allMetadataWithoutCredentials && successfulApi.length > 0
      && !result.unexpectedWrites, 'Обнаружены лишние записи или авторизация на публичных метаданных.');
  });
}

async function dialogLayout(dialog, { header, body, page: pageSelector, date, archive }) {
  const mark = dialog.locator(`:scope > ${header} + [data-development-mode]`);
  await mark.waitFor();
  expect(await mark.getAttribute('role') === 'status'
    && await mark.locator('.ntf-title').textContent() === `Разработка · копия данных от ${date}`
    && (await mark.getAttribute('title'))?.includes(archive), 'У верхнего диалога нет плашки с датой и подсказкой архива.');
  const layout = await mark.evaluate((element, selectors) => {
    const rect = element.getBoundingClientRect();
    const container = element.parentElement;
    const scroller = container.querySelector(selectors.body);
    const content = selectors.page ? scroller?.querySelector(selectors.page) : scroller;
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      markForeground: element.contains(hit) && rect.left >= 0 && rect.top >= 0
        && rect.bottom <= innerHeight && rect.right <= innerWidth + 1,
      bodyHeight: scroller?.clientHeight || 0,
      pageHeight: Math.round(content?.getBoundingClientRect().height || 0),
      fitsWidth: scroller && scroller.scrollWidth <= scroller.clientWidth + 1
        && container.scrollWidth <= container.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1,
    };
  }, { body, page: pageSelector });
  return layout;
}

async function verifyDialogButton(button) {
  await button.waitFor();
  const reachable = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth + 1 && rect.bottom <= innerHeight
      && element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
  });
  expect(reachable && await button.isEnabled(), 'Кнопка диалога перекрыта, отключена или вне окна.');
}

async function runDialogs(browser, session) {
  const { page, context } = await openContext(browser, session, 'session');
  try {
    let product, candidate, meta, date;
    await check('existing-issued', async (result) => {
      const reply = page.waitForResponse((response) => response.url() === origin + metaPath && response.ok());
      await enter(page);
      meta = await (await reply).json();
      date = validateMetadata(meta, session);
      result.archive = meta.data.backup;
      product = await productBySku(page, '3209');
      if (!product) throw new MissingFixture('Контрольное изделие 3209 отсутствует.');
      const list = await apiRead(page, `/api/passports?status=issued&productId=${product.id}&limit=30`);
      candidate = list.items?.find((item) => objectId.test(item.id) && item.status === 'issued' && item.passportCategory
        && item.printSource !== 'file' && !item.printFile?.hasFile && String(item.passportNumber) === '613');
      if (!candidate) throw new MissingFixture('Нет существующего выпущенного паспорта 3209 из C155 для обычного диалога печати.');
      result.fixtureSku = '3209';
    });
    if (!candidate) return;

    await check('shell-with-product', async (result) => {
      await page.goto(`${app}#products?open=${product.id}`);
      await page.locator('.drawer-head h2').filter({ hasText: product.name }).waitFor();
      await assertBanner(page, meta, date);
      result.screenshot = 'qa-shell-product-1920-light.png';
      await page.screenshot({ path: path.join(evidence, result.screenshot), animations: 'disabled',
        style: '.sidebar .cnt, .topbar .bell-badge, .topbar [aria-label^="Профиль"], .topbar img, .drawer .kv-qty { visibility: hidden !important; }' });
    });

    for (const [width, height, theme] of [[1920, 1080, 'light'], [1024, 768, 'dark']]) {
      await check(`book-and-print-${width}-${theme}`, async (result) => {
        await page.setViewportSize({ width, height });
        expect(await applyTheme(page, theme) === theme, 'Тема оформления не применилась.');
        await page.goto(`${app}?qa-modal=${width}#docs?tab=archive&of=passarchive&open=${candidate.id}`);
        await page.locator('.drawer').getByRole('button', { name: 'Изменить в книжке', exact: true }).click();
        const book = page.locator('.modal.bk');
        await book.locator('.bk-page').first().waitFor();
        const bookPdf = book.getByRole('button', { name: 'Скачать PDF', exact: true });
        const bookClose = book.getByRole('button', { name: 'Закрыть книжку', exact: true });
        result.book = await dialogLayout(book, { header: '.bk-head', body: '.bk-scroll', page: '.bk-page', date, archive: meta.data.backup });
        for (const button of [bookPdf, bookClose, book.getByRole('button', { name: 'По ширине', exact: true }),
          book.getByRole('button', { name: '100 %', exact: true })]) await verifyDialogButton(button);
        result.book.actionsAvailable = true;
        if (width === 1920) {
          const bookShot = `qa-book-${width}-${theme}.png`;
          await book.screenshot({ path: path.join(evidence, bookShot), animations: 'disabled',
            style: '.bk-contacts { visibility: hidden !important; }' });
          result.book.screenshot = bookShot;
        }

        await bookPdf.click(); // Открывает настройки. Кнопку отправки формы сценарий не нажимает.
        const print = page.locator('.modal-back:not(.bk-back) > .modal').filter({ has: page.locator('.pf') });
        await print.getByRole('radiogroup', { name: 'Вид PDF' }).waitFor();
        result.print = await dialogLayout(print, { header: '.modal-head', body: '.modal-body', date, archive: meta.data.backup });
        const cancel = print.getByRole('button', { name: 'Отмена', exact: true });
        await verifyDialogButton(print.getByRole('button', { name: 'Скачать PDF', exact: true }));
        await verifyDialogButton(cancel);
        result.print.actionsAvailable = true;
        if (width === 1024) {
          const printShot = `qa-print-${width}-${theme}.png`;
          await print.screenshot({ path: path.join(evidence, printShot), animations: 'disabled',
            style: '.modal-head h2, .pf-checks .hint { visibility: hidden !important; }' });
          result.print.screenshot = printShot;
        }
        await cancel.click();
        await print.waitFor({ state: 'detached' });
        await bookClose.click();
        await book.waitFor({ state: 'detached' });
        expect([result.book, result.print].every((layout) => layout.markForeground && layout.bodyHeight >= 120
          && layout.pageHeight > 0 && layout.fitsWidth), 'Плашка перекрыта, полезная область слишком мала или есть горизонтальное переполнение.');
      });
    }
    await check('dialogs-network', async (result) => {
      result.pdfRequests = traffic.filter((entry) => /^\/api\/passports\/[^/]+\/pdf$/.test(entry.target)).length;
      result.unexpectedWrites = Object.keys(report.blockedWrites).filter((key) => !key.endsWith(' prefs') && !key.endsWith(' client-errors'));
      expect(!result.pdfRequests && !result.unexpectedWrites.length, 'При открытии диалога произошла попытка записи или скачивания PDF.');
    });
  } finally { await context.close(); }
}

let guard, browser;
try {
  const session = await credentials();
  const { chromium, executablePath } = await chromiumOptions();
  guard = createGuard();
  await new Promise((resolve, reject) => guard.once('error', reject).listen(0, '127.0.0.1', resolve));
  await mkdir(evidence, { recursive: true });
  report.scenarioSha256 = createHash('sha256').update(await readFile(script)).digest('hex');
  browser = await chromium.launch({ executablePath, headless: true,
    args: ['--disable-crash-reporter', '--disable-background-networking', '--disable-quic'],
    proxy: { server: `http://127.0.0.1:${guard.address().port}`, bypass: '<-loopback>' } });
  const probe = await browser.newPage();
  const response = await probe.goto(origin + metaPath, { timeout });
  expect(response?.ok() && traffic.some((entry) => entry.target === metaPath && entry.status === 200),
    'Браузер не подтвердил доступ к localhost:3102 через ограничивающий прокси.');
  await probe.close();
  await (dialogsOnly ? runDialogs(browser, session) : run(browser, session));
  if (Object.values(report.checks).some((result) => result.status !== 'PASS')) process.exitCode = 1;
} catch (error) {
  report.fatal = reasonFor(error);
  process.exitCode = 2;
} finally {
  await browser?.close();
  guard?.close();
  if (browser) await writeFile(path.join(evidence, dialogsOnly ? 'qa-dialog-results.json' : 'qa-results.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.fatal) console.error(report.fatal);
  else console.log(Object.entries(report.checks).map(([key, result]) => `${key} ${result.status}`).join('\n'));
}
