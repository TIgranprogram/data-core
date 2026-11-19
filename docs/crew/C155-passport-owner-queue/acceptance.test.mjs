// Запуск обычным менеджером только через api.sh stand BROWSER. Сессия приходит через stdin.
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const origin = 'http://localhost:3102';
const app = origin + '/app/';
const script = fileURLToPath(import.meta.url);
const dir = path.dirname(script);
const root = path.resolve(dir, path.basename(dir) === 'logs' ? '../..' : '../../..');
let evidence = path.join(root, 'docs/crew/C155-passport-owner-queue/evidence');
const timeout = 20_000;
const oid = /^[\da-f]{24}$/i;
const uuid = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const objectId = (value) => typeof value === 'string' && oid.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = (value) => createHash('sha256').update(value).digest('hex');
const tplPath = (id) => '/api/showcase/' + id + '/passport-template';
const cardPath = (id) => '/api/passports/' + id;
const nextPath = '/api/passports/next-numbers';
let phase = process.env.C155_ACCEPTANCE_PHASE || 'all';
const legacyId = process.env.C155_LEGACY_PASSPORT_ID;
const ambiguousId = process.env.C155_AMBIGUOUS_PRODUCT_ID;
const issuedId = process.env.C155_ISSUED_ID;
const report = { startedAt: new Date().toISOString(), origin, phase, viewport: '1920×1080',
  checks: {}, refusedOutside: 0, appOutside: 0, blockedWrites: {}, pageErrors: 0 };
const traffic = [];
let step = 'stand';

class Finding extends Error {}
class MissingFixture extends Error {}
function expect(ok, reason) { if (!ok) throw new Finding(reason); }
function need(ok, reason) { if (!ok) throw new MissingFixture(reason); }
const reasonFor = (error) => error instanceof Finding || error instanceof MissingFixture ? error.message
  : error.name === 'TimeoutError' ? 'Ожидаемый элемент или сетевой ответ не появился.' : `Ошибка сценария (${error.name || 'Error'}).`;

async function credentials() {
  expect(!process.stdin.isTTY, 'Нужен запуск через api.sh stand BROWSER.');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    expect(input.length <= 65536, 'Превышен лимит ввода сессии.');
  }
  let login;
  try { login = JSON.parse(input); } catch { throw new Finding('Не получена JSON-сессия api.sh.'); }
  expect(typeof login?.access === 'string' && login.access && typeof login.refresh === 'string' && login.refresh
    && login.user?.role === 'manager' && !login.user.isOwner, 'Нужна сессия обычного менеджера.');
  return { access: login.access, refresh: login.refresh, user: login.user };
}

async function chromiumOptions() {
  const require = createRequire(path.join(root, 'backend/package.json'));
  const packages = [process.env.STAND_QA_PLAYWRIGHT, 'playwright', 'playwright-core'];
  if (process.env.APPDATA) packages.push(path.join(process.env.APPDATA, 'npm/node_modules/openclaw/node_modules/playwright-core'));
  let chromium;
  for (const item of packages.filter(Boolean)) {
    try { ({ chromium } = require(item)); } catch { continue; }
    if (chromium) break;
  }
  expect(chromium, 'Установленный Playwright не найден.');
  const executables = [process.env.EDGE, chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  for (const executablePath of executables.filter(Boolean)) {
    try { await access(executablePath); return { chromium, executablePath }; } catch { /* следующий путь */ }
  }
  throw new Finding('Исполняемый файл Chrome, Edge или Chromium не найден.');
}

// Все HTTP-запросы браузера, включая переходы и редиректы, проходят через прокси.
// Записи разрешаются по заранее выбранной операции, точному маршруту и ожидаемому телу.
const grants = [];
const pdfBodies = new Map();
function grant(method, target, accept, count = 1, onReply) { grants.push({ method, target, accept, count, onReply }); }
function pushLocal(req, res, url, body, onReply) {
  const options = { method: req.method, family: 4, timeout: 75_000, headers: { ...req.headers, host: 'localhost:3102' } };
  delete options.headers['proxy-authorization'];
  delete options.headers['proxy-connection'];
  const target = url.pathname;
  const pdf = (req.method === 'POST' && target === '/api/passports/preview')
    || (req.method === 'GET' && target.endsWith('/pdf'));
  if (onReply || pdf) options.headers['accept-encoding'] = 'identity';
  const trackedPicker = ['c159', 'c159-match', 'c159-zoom'].includes(phase) && (/^\/api\/incomes\/[\da-f]{24}$/i.test(target)
    || ['/api/showcase', '/api/showcase/groups', '/api/showcase/similar', '/api/matching/suggest', '/api/matching/confirm'].includes(target));
  const track = target.startsWith('/api/passports') || target.endsWith('/passport-template') || target === '/app/development.json' || trackedPicker;
  const entry = { step, method: req.method, target };
  for (const key of ['variant', 'mode', 'readOnly']) {
    const value = url.searchParams.get(key);
    if (['short', 'full', 'pages', 'print', '1'].includes(value)) entry[key] = value;
  }
  if (track) traffic.push(entry);
  const upstream = http.request(url, options, (reply) => {
    entry.status = reply.statusCode;
    if (pdf && reply.statusCode < 300) {
      const chunks = [];
      const done = new Promise((resolve) => {
        reply.on('data', (chunk) => chunks.push(chunk));
        reply.on('end', () => resolve(Buffer.concat(chunks)));
        reply.on('error', () => resolve(null));
      });
      const seen = pdfBodies.get(target) || [];
      seen.push(done);
      pdfBodies.set(target, seen);
    }
    if (!onReply || reply.statusCode >= 300) {
      res.writeHead(reply.statusCode, reply.headers);
      reply.pipe(res);
      return;
    }
    const chunks = [];
    reply.on('data', (chunk) => chunks.push(chunk));
    reply.on('end', () => {
      const bytes = Buffer.concat(chunks);
      try { onReply(JSON.parse(bytes.toString('utf8'))); }
      catch { res.writeHead(502).end(); return; }
      res.writeHead(reply.statusCode, reply.headers).end(bytes);
    });
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
  upstream.on('timeout', () => upstream.destroy());
  if (body) upstream.end(body);
  else req.pipe(upstream);
}

function refuseWrite(method, pathname, res) {
  const kind = pathname === '/api/auth/me/prefs' ? 'prefs'
    : pathname === '/api/client-errors' ? 'client-errors' : 'unexpected';
  const key = method + ' ' + kind;
  report.blockedWrites[key] = (report.blockedWrites[key] || 0) + 1;
  res.writeHead(403, { 'Content-Type': 'application/json' }).end('{}');
}

function makeGuard() {
  const guard = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url); } catch { res.writeHead(400).end(); return; }
    if (url.origin !== origin || url.username || url.password) {
      report.refusedOutside++;
      res.writeHead(403).end();
      return;
    }
    const pathname = url.pathname;
    const pdf = /^\/api\/passports\/(?:.*\/)?(?:pdf|zip)$/.test(pathname);
    const read = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (read && !pdf) { pushLocal(req, res, url); return; }
    if (!['fill', 'first-time-width', 'c159', 'c159-match', 'c159-zoom', 'c161', 'c161-visual', 'c161-visual-manual'].includes(phase) && req.method === 'POST' && url.href === origin + '/api/auth/refresh') {
      pushLocal(req, res, url);
      return;
    }
    const allowed = grants.find((item) => item.count && req.method === item.method && item.target === pathname);
    if (!allowed) { refuseWrite(req.method, pathname, res); return; }
    if (pdf) {
      if (!allowed.accept(url)) { refuseWrite(req.method, pathname, res); return; }
      allowed.count--;
      if (phase === 'print' && pathname === cardPath(issuedId) + '/pdf') url.searchParams.set('readOnly', '1');
      pushLocal(req, res, url);
      return;
    }
    let body;
    let parsed;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 65536) { refuseWrite(req.method, pathname, res); return; }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
      parsed = JSON.parse(body.toString('utf8'));
    } catch { refuseWrite(req.method, pathname, res); return; }
    if (!allowed.count || !allowed.accept(parsed, url)) { refuseWrite(req.method, pathname, res); return; }
    allowed.count--;
    pushLocal(req, res, url, body, allowed.onReply);
  });
  guard.on('connect', (req, socket) => {
    report.refusedOutside++;
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
  });
  guard.on('upgrade', (req, socket) => { report.refusedOutside++; socket.destroy(); });
  return guard;
}

async function check(key, action) {
  step = key;
  const result = report.checks[key] = { status: 'PASS' };
  try { await action(result); }
  catch (error) {
    result.status = error instanceof MissingFixture ? 'SKIP' : 'FAIL';
    result.reason = reasonFor(error);
  }
  return result.status === 'PASS';
}

async function at(result, action, run) {
  result.action = action;
  return await run();
}

function apiPath(resp) { return new URL(resp.url()).pathname; }
const statusOf = (item) => item.status || (numberOf(item) ? 'issued' : 'draft');
function numberOf(item) { return /^\d+$/.test(String(item.passportNumber)) ? String(item.passportNumber) : null; }
const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim();

// PDF остаётся в памяти. В доказательство пишутся только контрольная сумма, размеры и результаты проверок.
const pdfCheck = String.raw`
import base64, json, re, sys
import pymupdf
inp = json.load(sys.stdin)
doc = pymupdf.open(stream=base64.b64decode(inp['pdf']), filetype='pdf')
norm = lambda text: ' '.join(text.split())
text = norm('\n'.join(page.get_text() for page in doc))
needle = norm(inp.get('description'))
num = inp.get('number')
matched = None if not num else re.search(r'ПАСПОРТ\s*№\s*' + re.escape(num) + r'(?!\d)', text, re.I) is not None
print(json.dumps({'pages': len(doc), 'sizes': sorted({(round(p.rect.width), round(p.rect.height)) for p in doc}),
  'imageCount': sum(len(p.get_images()) for p in doc), 'hasDescription': bool(needle and needle in text),
  'hasNumber': matched, 'hasAnyPassportNumber': bool(re.search(r'ПАСПОРТ\s*№\s*\d', text, re.I)),
  'hasDraftMark': 'ЧЕРНОВИК' in text, 'hasTechnicalComposition': bool(re.search(r'Состав изделия|Описание конструкции и материалов', text, re.I))}))
`;
async function inspectPdf(response, description = '', number = null) {
  expect(response.ok(), `PDF вернул HTTP ${response.status()}.`);
  const bytes = await pdfBodies.get(apiPath(response))?.shift();
  expect(bytes?.subarray(0, 5).toString() === '%PDF-', 'Ответ стенда не начинается с сигнатуры PDF.');
  const inspected = spawnSync(process.env.C155_PYTHON || 'python', ['-c', pdfCheck], {
    input: JSON.stringify({ pdf: bytes.toString('base64'), description, number }), encoding: 'utf8', timeout: 30_000,
  });
  expect(inspected.status === 0, 'Для проверки текста PDF нужен локальный Python с PyMuPDF.');
  let stats;
  try { stats = JSON.parse(inspected.stdout); } catch { throw new Finding('Не получена статистика PDF.'); }
  return { status: response.status(), sha256: hash(bytes), bytes: bytes.length, ...stats };
}

async function openContext(browser, login) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block', acceptDownloads: true });
  await context.addInitScript(({ allowedOrigin, session }) => {
    if (window.top !== window || location.origin !== allowedOrigin || location.pathname !== '/app/') return;
    const url = new URL(location.href);
    if (url.searchParams.get('qa-entry') !== '1') return;
    sessionStorage.setItem('dca_access', session.access);
    sessionStorage.setItem('dca_refresh', session.refresh);
    sessionStorage.setItem('dca_user', JSON.stringify(session.user));
    localStorage.setItem('dc-theme', 'light');
    url.searchParams.delete('qa-entry');
    history.replaceState(history.state, '', url);
  }, { allowedOrigin: origin, session: login });
  const observe = (address) => {
    const url = new URL(address);
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.origin !== origin) report.appOutside++;
  };
  context.on('request', (request) => observe(request.url()));
  context.on('page', (page) => {
    page.on('pageerror', () => { report.pageErrors++; });
    page.on('websocket', (socket) => observe(socket.url()));
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  return { context, page };
}

async function run(browser, login, focusedCase) {
  const { context, page } = await openContext(browser, login);
  const book = page.locator('.bk');
  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  const wait = (method, target, query = {}, ms = timeout) => page.waitForResponse((resp) => {
    if (apiPath(resp) !== target || resp.request().method() !== method) return false;
    const params = new URL(resp.url()).searchParams;
    return Object.entries(query).every(([key, value]) => params.get(key) === value);
  }, { timeout: ms });
  const listen = (method, target, query, ms) => wait(method, target, query, ms).catch(() => null);
  const json = async (p, operation) => {
    const response = await p;
    expect(response, `${operation}: браузер не получил ожидаемый ответ.`);
    expect(response.ok(), `${operation}: HTTP ${response.status()}.`);
    return response.json();
  };
  const authFetch = (target, body) => page.evaluate(async ({ target, body }) => {
    const token = sessionStorage.getItem('dca_access') || localStorage.getItem('dca_access');
    const headers = { Authorization: 'Bearer ' + token };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(target, { method: body === undefined ? 'GET' : 'POST', headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error' });
    return { status: response.status, data: response.ok ? await response.json() : null };
  }, { target, body });
  const read = async (target) => {
    const result = await authFetch(target);
    expect(result.status === 200, `GET ${target.split('?')[0]}: HTTP ${result.status}.`);
    return result.data;
  };
  const rowsOf = async (productId) => {
    const { items, total } = await read('/api/passports?productId=' + productId + '&limit=200');
    expect(items.length === total, 'Выборка паспортов изделия требует дополнительной страницы.');
    return items.map((item) => ({ id: item.id, number: numberOf(item), status: statusOf(item) }))
      .sort((a, b) => a.id.localeCompare(b.id));
  };
  const lastNumbers = async () => {
    const response = await authFetch(nextPath);
    if (response.status === 200) return { route: 'next-numbers', ...response.data };
    expect(response.status === 403, `GET next-numbers: HTTP ${response.status}.`);
    const last = await read('/api/passports/last-numbers');
    return { route: 'last-numbers', last: last.last };
  };
  const screenshot = (name, locator = book, privacyStyle = '') => locator.screenshot({
    path: path.join(evidence, 'acceptance-' + name + '.png'), animations: 'disabled',
    style: '.bk-contacts,.bk-firm,.bk-tm,.bk-warranty,.bk-signature { visibility: hidden !important; }' + privacyStyle,
  });
  const closeBook = async () => {
    await button(book, 'Закрыть книжку').click();
    await book.waitFor({ state: 'detached' });
  };
  const openTemplate = async (id, entry = 'templateFor') => {
    const response = listen('GET', tplPath(id), { variant: 'short' });
    await page.goto(app + '#products?' + entry + '=' + id, { waitUntil: 'domcontentloaded' });
    const template = await json(response, 'Открытие шаблона');
    await book.waitFor();
    return template;
  };
  const painted = async (selector, text) => {
    await page.waitForFunction(({ selector, text }) => [...document.querySelectorAll(selector)]
      .some((node) => node.textContent.replace(/\s+/g, ' ').includes(text)), { selector, text: normalize(text) });
  };
  const loadedCover = () => page.waitForFunction(() => [...document.querySelectorAll('.bk-cover img')]
    .some((img) => img.complete && img.naturalWidth > 0));

  try {
    await page.goto(app + '?qa-entry=1#products', { waitUntil: 'domcontentloaded' });
    const ready = ['all', 'core', 'preview'].includes(phase);
    if (ready) await core();
    if (phase === 'print') await printIssued();
    if (phase === 'all' || phase === 'choice') await choice();
    if (phase === 'all' || phase === 'legacy') await legacy();
    if (focusedCase) await focusedCase({
      app, page, book, button, read, authFetch, listen, json, closeBook, screenshot,
      check, at, expect, need, objectId, exactBody,
      grant: phase.startsWith('c161-visual') ? () => { throw new Finding('В визуальной фазе C161 операции записи запрещены.'); } : grant,
      cardPath, numberOf, statusOf,
      openTemplate, painted, inspectPdf, download, lastNumbers,
    });
    await check('network', async (result) => {
      result.browserErrors = report.pageErrors;
      result.outside = report.appOutside;
      result.unexpectedWrites = Object.entries(report.blockedWrites).filter(([key]) => key.endsWith(' unexpected'));
      expect(!result.outside && !result.unexpectedWrites.length && !result.browserErrors,
        'Наблюдались внешние обращения страницы, неожиданная запись или ошибка JavaScript.');
    });
  } finally { await context.close(); }

  async function core() {
    let product, description, before, nextBefore, issued;
    const opened = await check('template-and-known-description', async (result) => {
      const products = await read('/api/showcase?search=1066&limit=30');
      product = products.items.find((item) => String(item.sku).trim() === '1066');
      need(objectId(product?.id), 'Изделие 1066 отсутствует на копии или менеджеру недоступно.');
      before = await rowsOf(product.id);
      nextBefore = await lastNumbers();
      result.productId = product.id;
      result.initial = { passports: before.length, numbers: nextBefore };
      const from = traffic.length;
      await at(result, 'Открыть карточку 1066', async () => {
        await page.goto(app + '#products?open=' + product.id);
        await button(page, 'Ещё действия').last().click();
      });
      const response = listen('GET', tplPath(product.id), { variant: 'short' });
      const template = await at(result, 'Нажать «Шаблон паспорта» в карточке изделия', async () => {
        await page.getByRole('menuitem', { name: 'Шаблон паспорта', exact: true }).click();
        return json(response, 'GET шаблона');
      });
      await book.waitFor();
      expect(template.mode === 'template' && template.productId === product.id
        && template.presentationVersion === 1 && template.variant === 'short'
        && template.document && ['id', '_id', 'passportNumber', 'supplierOrgId', 'salesOrderId', 'incomeId']
          .every((key) => !template.document[key]), 'Проекция шаблона содержит идентификатор экземпляра, номер или контекст выдачи.');
      description = template.textSnapshot?.description;
      result.source = template.simpleDescriptionSource?.kind || null;
      result.missing = (template.readiness?.missing || []).map((item) => item.key);
      expect(result.source === 'dictionary' && !template.defaults?.simpleDescription?.text && normalize(description),
        'У 1066 без своей фразы не получено автоматически выбранное описание из справочника.');
      expect(template.readiness?.ready && !result.missing.length, 'У 1066 есть препятствия для короткого выпуска.');
      await at(result, 'Проверить описание, настоящий рисунок обложки и отсутствие повторного вопроса', async () => {
        await painted('.bk-page .bk-p', description);
        await loadedCover();
        await button(book, 'Выпустить паспорт').waitFor();
        expect(await button(book, 'Выпустить паспорт').isEnabled(), 'Готовый короткий шаблон не позволяет выпустить паспорт.');
        expect(await book.getByText('Вариант краткого описания', { exact: true }).count() === 0
          && await button(book, 'Выбрать вид изделия').count() === 0, 'Для готового описания книжка снова предлагает выбрать вид или фразу.');
      });
      const observed = traffic.slice(from);
      result.templateGets = observed.filter((item) => item.method === 'GET' && item.target === tplPath(product.id)).length;
      result.funnelGets = observed.filter((item) => item.method === 'GET' && item.target === '/api/passports/funnel').length;
      expect(result.templateGets === 1 && !result.funnelGets, 'При открытии известного short ожидался один GET шаблона без опроса воронки.');
      expect(same(before, await rowsOf(product.id)) && same(nextBefore, await lastNumbers()),
        'Открытие шаблона изменило список экземпляров или номера.');
    });
    const sample = await check('sample-twice', async (result) => {
      need(opened, 'Шаблон 1066 не прошёл предыдущую проверку.');
      const target = '/api/passports/preview';
      const expected = { productId: product.id, presentationVersion: 1, variant: 'short', mode: 'pages', pack: 'passport' };
      grant('POST', target, (body) => exactBody(body, expected), 2);
      const dialog = page.getByRole('dialog').filter({ has: page.locator('iframe[title="Образец паспорта без номера"]') });
      result.pdf = [];
      for (const n of [1, 2]) {
        const pending = listen('POST', target, {}, 75_000);
        try {
          const response = await at(result, 'Открыть «Образец», попытка ' + n, async () => {
            await button(book, 'Образец').click();
            return pending;
          });
          expect(response, 'POST предпросмотра не получил ответа.');
          const checked = await inspectPdf(response, description);
          result.pdf.push(checked);
          expect(checked.pages > 1 && checked.hasDescription && checked.hasDraftMark && !checked.hasAnyPassportNumber
            && !checked.hasTechnicalComposition && checked.imageCount > 0,
          'Образец должен содержать обычные страницы, реальный рисунок, словарное описание и пометку черновика без номера и технического состава.');
          await dialog.locator('iframe[src^="blob:"]').waitFor();
        } finally {
          if (await dialog.isVisible()) await button(dialog, 'Вернуться к правке').click();
          await dialog.waitFor({ state: 'detached' });
        }
      }
      result.numbers = await lastNumbers();
      expect(same(before, await rowsOf(product.id)) && same(nextBefore, result.numbers),
        'Два образца изменили список экземпляров или доступную статистику номеров.');
    });
    const issuedPass = phase !== 'preview' && await check('standalone-and-repeat', async (result) => {
      need(sample, 'Образец 1066 не прошёл предыдущую проверку.');
      const target = '/api/passports';
      const issueButton = button(book, 'Выпустить паспорт');
      const dialog = page.getByRole('dialog').filter({ hasText: 'Выпустить паспорт без заказа?' });
      await at(result, 'Отменить выбор фирмы и проверить, что выпуск не начался', async () => {
        await issueButton.click();
        await dialog.waitFor();
        await button(dialog, 'Отмена').click();
        await dialog.waitFor({ state: 'detached' });
        expect(same(before, await rowsOf(product.id)) && same(nextBefore, await lastNumbers()),
          'Отказ от выбора фирмы изменил паспорта или номера.');
      });
      await issueButton.click();
      const pick = dialog.locator('select');
      await pick.waitFor();
      const firm = await pick.evaluate((select) => select.value || [...select.options].find((option) => option.value)?.value);
      need(objectId(firm), 'У менеджера нет доступной действующей фирмы для самостоятельного выпуска.');
      await pick.selectOption(firm);
      const createFields = { productId: product.id, supplierOrgId: firm, presentationVersion: 1, variant: 'short' };
      const issueFields = { presentationVersion: 1, variant: 'short' };
      let createBody, createdId;
      grant('POST', target, (body) => {
        if (!uuid.test(body?.creationKey) || !exactBody(body, { ...createFields, creationKey: body.creationKey })) return false;
        createBody = body;
        return true;
      }, 1, (item) => {
        if (!objectId(item.id) || item.productId !== product.id || item.supplierOrgId !== firm
          || item.salesOrderId || item.incomeId || numberOf(item) || item.variant !== 'short'
          || item.presentationVersion !== 1 || statusOf(item) !== 'draft') return;
        createdId = item.id;
        grant('POST', cardPath(createdId) + '/issue', (body) => exactBody(body, issueFields), 2);
      });
      const creation = listen('POST', target);
      const issuing = page.waitForResponse((resp) => /^\/api\/passports\/[\da-f]{24}\/issue$/i.test(apiPath(resp))
        && resp.request().method() === 'POST').catch(() => null);
      await at(result, 'Подтвердить выбранную фирму и выпустить без заказа', () => button(dialog, 'Выпустить паспорт').click());
      const created = await json(creation, 'Создание самостоятельного экземпляра');
      expect(createdId === created.id, 'Получен чужой, связанный с заказом или уже номерной черновик.');
      issued = await json(issuing, 'Выпуск экземпляра');
      expect(issued.id === createdId && objectId(issued.id) && numberOf(issued) && statusOf(issued) === 'issued',
        'Выпуск не вернул тот же экземпляр с официальным номером.');
      await painted('.bk-head h2', '№ ' + numberOf(issued));
      const first = await read(cardPath(createdId) + '?readOnly=1');
      expect(first.supplierOrgId === firm && !first.salesOrderId && !first.incomeId
        && normalize(first.textSnapshot?.description) === normalize(description), 'Карточка после выпуска потеряла фирму, краткий вариант или словарный текст.');
      result.issued = { id: createdId, number: numberOf(issued), firmSelected: true, order: false };
      await at(result, 'Повторить исходные POST создания и выпуска без смены ключа', async () => {
        grant('POST', target, (body) => exactBody(body, createBody));
        const again = await authFetch(target, createBody);
        const repeat = await authFetch(cardPath(createdId) + '/issue', issueFields);
        result.repeat = { createStatus: again.status, issueStatus: repeat.status, id: repeat.data?.id, number: numberOf(repeat.data || {}) };
        expect(again.status < 300 && repeat.status < 300 && again.data?.id === createdId && repeat.data?.id === createdId
          && numberOf(again.data) === numberOf(issued) && numberOf(repeat.data) === numberOf(issued),
        'Повтор команды не вернул тот же id и номер.');
      });
      const now = await rowsOf(product.id);
      const nowNumbers = await lastNumbers();
      result.numbers = nowNumbers;
      result.passports = now.length;
      expect(now.length === before.length + 1 && same(before, now.filter((item) => item.id !== createdId)),
        'Выпуск и повтор изменили существующие экземпляры или создали дубликат.');
      if (nextBefore.route === 'next-numbers') expect(nowNumbers.nextPassportNo === nextBefore.nextPassportNo + 1,
        'Один выпуск и его повтор изменили счётчик больше одного раза.');
    });
    if (phase !== 'preview') await check('issued-pdf', async (result) => {
      need(issuedPass, 'Самостоятельный выпуск 1066 не прошёл предыдущую проверку.');
      await verifyIssuedPdf(issued, description, result);
    });
    await check('filled-themes', async (result) => {
      need(opened, 'Шаблон 1066 не открылся.');
      result.themes = {};
      if (await book.isVisible()) await closeBook();
      await openTemplate(product.id, 'bookFor');
      for (const theme of ['light', 'dark']) {
        await at(result, 'Открыть заполненный шаблон в теме ' + theme, async () => {
          await page.evaluate((theme) => {
            localStorage.setItem('dc-theme', theme);
            document.documentElement.setAttribute('data-theme', theme);
          }, theme);
          await loadedCover();
          const layout = await book.evaluate((el) => {
            const main = el.querySelector('.bk-main');
            const header = el.querySelector('.bk-head');
            const sheet = el.querySelector('.bk-page');
            return { theme: document.documentElement.dataset.theme, mainWidth: main.clientWidth, headerWidth: header.clientWidth,
              headerScroll: header.scrollWidth, sheetWidth: sheet.getBoundingClientRect().width };
          });
          result.themes[theme] = layout;
          expect(layout.theme === theme && layout.sheetWidth > 0 && layout.headerScroll <= layout.headerWidth + 2,
            'Тема, полезная область или ширина шапки книжки некорректны.');
          await screenshot(theme);
          result.themes[theme].image = 'acceptance-' + theme + '.png';
        });
      }
      await closeBook();
    });
  }

  async function printIssued() {
    await check('issued-pdf', async (result) => {
      need(objectId(issuedId), 'Не передан id экземпляра, выпущенного фазой core.');
      const products = await read('/api/showcase?search=1066&limit=30');
      const product = products.items.find((item) => String(item.sku).trim() === '1066');
      const target = cardPath(issuedId);
      const issued = await read(target + '?readOnly=1');
      expect(objectId(product?.id) && issued.id === issuedId && issued.productId === product.id
        && issued.status === 'issued' && numberOf(issued) && issued.presentationVersion === 1
        && issued.variant === 'short' && !issued.salesOrderId && !issued.incomeId && normalize(issued.textSnapshot?.description),
      'Указанный экземпляр не является выданным отдельным short-паспортом 1066 с описанием.');
      await at(result, 'Открыть выпущенный экземпляр из архива', async () => {
        await page.goto(app + '#docs?tab=archive&of=passarchive&open=' + issuedId, { waitUntil: 'domcontentloaded' });
        await button(page, 'Открыть паспорт').last().click();
        await painted('.bk-head h2', '№ ' + numberOf(issued));
      });
      await verifyIssuedPdf(issued, issued.textSnapshot.description, result);
      await loadedCover();
      await screenshot('issued');
      result.image = 'acceptance-issued.png';
      await closeBook();
    });
  }

  async function verifyIssuedPdf(issued, description, result) {
    const target = cardPath(issued.id) + '/pdf';
    grant('GET', target, (url) => !url.searchParams.has('mode'), 2);
    result.pdf = [];
    for (const n of [1, 2]) {
      const response = await at(result, 'Скачать PDF обычными страницами, попытка ' + n,
        () => download(target, { onStep: (value) => { result.pdfAction = value; } }));
      const checked = await inspectPdf(response, description, numberOf(issued));
      result.pdf.push(checked);
      expect(checked.pages > 1 && checked.hasDescription && checked.hasNumber && !checked.hasDraftMark
        && !checked.hasTechnicalComposition && checked.imageCount > 0,
      'В выданном PDF ожидались тот же номер, описание и рисунки короткого варианта.');
    }
    const after = await read(cardPath(issued.id) + '?readOnly=1');
    result.id = issued.id;
    result.number = numberOf(after);
    expect(result.number === numberOf(issued), 'Повторное скачивание изменило номер.');
  }

  async function download(target, opts = {}) {
    const response = listen('GET', target, opts.readOnly ? { readOnly: '1' } : {}, 75_000);
    const file = page.waitForEvent('download', { timeout: 75_000 }).catch(() => null);
    opts.onStep?.('Открыть настройки PDF');
    await button(book, 'Скачать PDF').click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('.pf') });
    try {
      opts.onStep?.('Выбрать формат A5');
      await dialog.locator('[role="radio"][data-mode="pages"]').click();
      opts.onStep?.('Снять печать и подпись');
      const checks = dialog.locator('.pf-checks').first().locator('label.check');
      for (const label of await checks.all()) if (await label.locator('input').isChecked()) await label.click();
      opts.onStep?.('Подтвердить скачивание PDF');
      await button(dialog, 'Скачать PDF').click();
      const got = await response;
      expect(got, 'Браузер не получил PDF от сервера.');
      expect(got.ok(), `PDF вернул HTTP ${got.status()}.`);
      const download = await file;
      expect(download, 'Интерфейс не начал скачивание PDF.');
      await download.delete();
      await dialog.waitFor({ state: 'detached' });
      return got;
    } finally {
      if (await dialog.isVisible()) await button(dialog, 'Отмена').click();
    }
  }

  async function choice() {
    await check('one-choice-save-and-reopen', async (result) => {
      need(objectId(ambiguousId), 'Не передан id подготовленного изделия с одной неоднозначной веткой.');
      if (await book.isVisible()) await closeBook();
      const initial = await openTemplate(ambiguousId);
      const choices = (initial.readiness?.missing || []).filter((item) => item.key.startsWith('choice:'));
      const rootId = choices[0]?.key.slice(7);
      const options = (initial.simpleDescriptionSuggestions || []).filter((item) => item.rootId === rootId);
      need(choices.length === 1 && objectId(rootId) && options.length >= 2,
        'Переданное изделие не даёт ровно одной неоднозначной ветки с двумя фразами.');
      expect(!initial.simpleDescriptionSource && !initial.defaults?.textChoices?.[rootId],
        'Краткое описание уже определено до ответа на вопрос.');
      result.initial = { ready: initial.readiness.ready, choiceBranches: choices.length, candidates: options.length };
      const caption = 'Вариант краткого описания';
      const panel = book.locator('.bk-toc-meta');
      const field = panel.locator('label.field').filter({ has: page.getByText(caption, { exact: true }) });
      const control = field.locator('select[name="simpleChoice"]:visible, input[role="combobox"]:visible');
      result.action = 'Дождаться видимого вопроса о кратком описании';
      const visible = await control.first().waitFor({ state: 'visible', timeout: 12_000 }).then(() => true, () => false);
      result.ui = { visible, labels: await field.count(), visibleControls: await control.count(),
        hiddenSelects: await panel.locator('select[name="simpleChoice"][hidden]').count(),
        exactLabelMatches: await panel.getByLabel(caption, { exact: true }).count() };
      if (!visible || result.ui.labels !== 1 || result.ui.visibleControls !== 1) {
        if (await book.locator('.bk-toc').isVisible()) {
          await screenshot('choice-failure', book.locator('.bk-toc'))
            .then(() => { result.image = 'acceptance-choice-failure.png'; }, () => {});
        }
        throw new Finding('В книжке не появился один видимый вопрос о кратком описании за 12 секунд.');
      }
      const picked = options[0];
      const expected = { changes: { textChoices: { [rootId]: picked.id } }, expected: { textChoices: { [rootId]: null } } };
      const target = tplPath(ambiguousId);
      grant('PATCH', target, (body, url) => url.searchParams.get('variant') === 'short' && exactBody(body, expected));
      const saved = listen('PATCH', target, { variant: 'short' });
      await at(result, 'Выбрать фразу и дождаться PATCH с одним ключом', async () => {
        if (await control.evaluate((el) => el.tagName === 'SELECT')) {
          await control.selectOption(picked.id);
          return;
        }
        const label = picked.name === picked.text ? picked.text : `${picked.name} · ${picked.text}`;
        await control.click();
        await field.getByRole('option', { name: label, exact: true }).click();
      });
      const response = await json(saved, 'Сохранение выбора');
      expect(response.defaults?.textChoices?.[rootId] === picked.id && response.simpleDescriptionSource?.id === picked.id,
        'Ответ PATCH не подтвердил выбранную фразу.');
      await control.waitFor({ state: 'detached' });
      await closeBook();
      const reopened = await at(result, 'Закрыть и открыть по совместимой ссылке bookFor', () => openTemplate(ambiguousId, 'bookFor'));
      expect(reopened.defaults?.textChoices?.[rootId] === picked.id && reopened.simpleDescriptionSource?.id === picked.id,
        'Повторное открытие потеряло сохранённый словарный выбор.');
      await painted('.bk-page .bk-p', reopened.textSnapshot?.description);
      expect(!!normalize(reopened.textSnapshot?.description) && await control.count() === 0, 'После возврата выбранная фраза не показана или вопрос повторяется.');
      result.rootId = rootId;
      result.selected = picked.id;
      await closeBook();
    });
  }

  async function legacy() {
    await check('legacy-readonly', async (result) => {
      need(objectId(legacyId), 'Не передан id исторического черновика с доступным PDF.');
      if (await book.isVisible()) await closeBook();
      const target = cardPath(legacyId);
      const direct = target + '?readOnly=1';
      const before = await read(direct);
      need(!before.presentationVersion && statusOf(before) === 'draft' && before.passportCategory,
        'Переданный экземпляр не является историческим черновиком с категорией.');
      const opening = listen('GET', target, { readOnly: '1' });
      await at(result, 'Открыть исторический черновик из архива', () =>
        page.goto(app + '#docs?tab=archive&of=passarchive&open=' + legacyId, { waitUntil: 'domcontentloaded' }));
      const card = await json(opening, 'Чтение исторического черновика');
      expect(!card.presentationVersion && statusOf(card) === 'draft', 'Историческая карточка изменила режим или статус.');
      if (!await book.isVisible()) await button(page, 'Открыть паспорт').last().click();
      await book.waitFor();
      await book.getByText('Старый образец', { exact: true }).waitFor();
      expect(!await book.locator('.bk-edit').count() && !await button(book, 'Выпустить').count(),
        'В книжке исторического черновика доступны изменения или выпуск.');
      const print = target + '/pdf';
      grant('GET', print, (url) => url.searchParams.get('readOnly') === '1' && !url.searchParams.has('mode'));
      const downloaded = await at(result, 'Скачать исторический PDF с readOnly=1', () => download(print, { readOnly: true }));
      result.pdf = await inspectPdf(downloaded);
      expect(result.pdf.pages > 0 && result.pdf.hasDraftMark, 'Исторический PDF не содержит прежний признак черновика.');
      const after = await read(direct);
      result.unchanged = same(before, after);
      result.cardReadOnly = true;
      expect(result.unchanged, 'Два GET карточки различаются после просмотра и печати readOnly.');
      await closeBook();
    });
  }
}

function exactBody(body, expected) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  return Object.keys(body).length === Object.keys(expected).length && Object.entries(expected).every(([key, value]) =>
    typeof value === 'object' && value !== null ? exactBody(body[key], value) : body[key] === value);
}

export async function runOrderAcceptance(orderCase, source) {
  await runFocusedAcceptance('order', orderCase, source);
}

export async function runFocusedAcceptance(name, focusedCase, source) {
  expect(['order', 'first-time', 'first-time-width', 'fill', 'c159', 'c159-match', 'c159-zoom', 'c161', 'c161-visual', 'c161-visual-manual'].includes(name) && typeof focusedCase === 'function', 'Неизвестный сценарий приёмки.');
  phase = report.phase = name;
  if (['c159', 'c159-match', 'c159-zoom'].includes(name)) evidence = path.join(root, 'docs/crew/C159-order-product-photo-picker/evidence');
  if (['c161', 'c161-visual', 'c161-visual-manual'].includes(name)) evidence = path.join(root, 'docs/crew/C161-short-description-from-parts/evidence');
  await start(source, focusedCase);
}

async function start(source, focusedCase) {
  let guard, browser;
  try {
  expect(focusedCase || ['all', 'core', 'preview', 'choice', 'legacy', 'print'].includes(phase), 'Неизвестная фаза приёмки.');
  const login = await credentials();
  const { chromium, executablePath } = await chromiumOptions();
  guard = makeGuard();
  await new Promise((resolve, reject) => guard.once('error', reject).listen(0, '127.0.0.1', resolve));
  await mkdir(evidence, { recursive: true });
  report.scenarioSha256 = hash(await readFile(source));
  if (focusedCase) report.guardSha256 = hash(await readFile(script));
  browser = await chromium.launch({ executablePath, headless: true,
    args: ['--disable-crash-reporter', '--disable-background-networking', '--disable-quic'],
    proxy: { server: `http://127.0.0.1:${guard.address().port}`, bypass: '<-loopback>' } });
  report.browser = browser.version();
  const probe = await browser.newPage();
  const metaPath = '/app/development.json';
  const response = await probe.goto(origin + metaPath, { timeout });
  expect(response?.ok() && traffic.some((item) => item.target === metaPath && item.status === 200),
    'Браузер не подтвердил доступ к localhost:3102 через ограничивающий прокси.');
  const meta = await response.json();
  expect(/^datacore-2026-11-18_\d{6}\.tgz$/.test(meta.data?.backup || '') && /^[\da-f]{40}$/i.test(meta.code?.head || ''),
    'Метаданные не подтвердили копию 18 ноября и SHA кода.');
  report.stand = { backup: meta.data.backup, head: meta.code.head, dirty: meta.code.dirty === true,
    builtAt: /^\d{4}-[\d:T.+-]+Z?$/.test(meta.code.builtAt || '') ? meta.code.builtAt : undefined };
  await probe.close();
  await run(browser, login, focusedCase);
  if (Object.values(report.checks).some((value) => value.status === 'FAIL')) process.exitCode = 1;
} catch (error) {
  report.fatal = reasonFor(error);
  process.exitCode = 2;
} finally {
  await browser?.close();
  guard?.close();
  report.traffic = traffic;
  if (browser) await writeFile(path.join(evidence, `acceptance-${phase}-results.json`), JSON.stringify(report, null, 2) + '\n');
  if (report.fatal) console.error(report.fatal);
  else console.log(Object.entries(report.checks).map(([key, value]) => key + ' ' + value.status).join('\n'));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === script) await start(script);
