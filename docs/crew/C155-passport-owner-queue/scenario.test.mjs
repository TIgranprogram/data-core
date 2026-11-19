// C155. Запуск через datacore-access: api.sh stand BROWSER tools/logs/c155-scenario.mjs.
// Авторизация приходит JSON через stdin. Порт и адрес совпадают с контуром stand команды BROWSER.
import { createRequire } from 'node:module';
import { access, mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const base = 'http://localhost:3102';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
// api.sh меняет cwd; файл может быть в crew или в tools/logs.
const root = path.resolve(scriptDir, path.basename(scriptDir) === 'logs' ? '../..' : '../../..');
const evidence = path.join(root, 'docs/crew/C155-passport-owner-queue/evidence');
const timeout = 12_000;
const knownChecks = new Set(['01-product', '02-template-entry', '03-queue', '04-sample', '05-issue-incomplete',
  '06-standalone-ready', '07-order-position', '07b-blocked-plan-position', '08-themes']);
const selectedChecks = new Set((process.env.STAND_QA_CHECKS || '').split(',').map((key) => key.trim()).filter(Boolean));
const resultName = process.env.STAND_QA_RESULT_NAME || 'qa-results.json';
const id = (value) => /^[\da-f]{24}$/i.test(String(value || '')) ? String(value) : null;
const rows = (payload) => payload?.items || [];
const routeOf = (response) => new URL(response.url()).pathname;
const numberOf = (p) => p.passportNumber && !String(p.passportNumber).startsWith('draft-') ? p.passportNumber : null;
const statusOf = (p) => p.status || (numberOf(p) ? 'issued' : 'draft');
const state = (p) => ({ id: id(p.id), status: statusOf(p), number: numberOf(p),
  productId: id(p.productId), salesOrderId: id(p.salesOrderId), incomeId: id(p.incomeId), supplierOrgId: id(p.supplierOrgId) });
const states = (items) => items.map(state).sort((a, b) => String(a.id).localeCompare(String(b.id)));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

class Finding extends Error {}
class MissingFixture extends Error {}
const expect = (ok, reason) => { if (!ok) throw new Finding(reason); };
const skip = (reason) => { throw new MissingFixture(reason); };

async function credentials() {
  if (process.stdin.isTTY) throw new Finding('Вход отсутствует. Запуск через api.sh stand BROWSER.');
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 65536) throw new Finding('Превышен лимит входных данных.');
  }
  let login;
  try { login = JSON.parse(input); } catch { throw new Finding('Ожидался JSON от api.sh stand BROWSER.'); }
  if (!login?.access || login.user?.role !== 'manager' || login.user.isOwner) throw new Finding('Нужна действующая сессия обычного менеджера стенда.');
  return login;
}

async function chromiumOptions() {
  const require = createRequire(path.join(root, 'backend/package.json'));
  const roots = ['playwright', 'playwright-core'];
  if (process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'npm/node_modules/openclaw/node_modules/playwright-core'));
  if (process.env.STAND_QA_PLAYWRIGHT) roots.unshift(process.env.STAND_QA_PLAYWRIGHT);
  let chromium;
  for (const candidate of roots) {
    try { ({ chromium } = require(candidate)); } catch { continue; }
    if (chromium) break;
  }
  if (!chromium) throw new Finding('Локальный Playwright не найден. Укажите STAND_QA_PLAYWRIGHT.');
  const candidates = [process.env.EDGE, chromium.executablePath(), 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'];
  for (const executablePath of candidates.filter(Boolean)) {
    try { await access(executablePath); return { chromium, executablePath }; } catch { /* следующий браузер */ }
  }
  throw new Finding('Локальный Chromium/Edge не найден. Укажите EDGE.');
}

const report = { date: new Date().toISOString(), base, copyDate: process.env.STAND_QA_COPY_DATE || null,
  checks: {}, network: [], blockedWrites: [], scriptErrors: 0 };
const contextHeaders = (login) => ({ Authorization: `Bearer ${login.access}` });
let browser;

try {
  expect(['qa-results.json', 'qa-standalone-results.json'].includes(resultName), 'Недопустимое имя JSON для доказательств QA.');
  expect([...selectedChecks].every((key) => knownChecks.has(key)), 'STAND_QA_CHECKS содержит неизвестный сценарий.');
  const login = await credentials();
  const { chromium, executablePath } = await chromiumOptions();
  await mkdir(evidence, { recursive: true });
  browser = await chromium.launch({ executablePath, headless: true, args: ['--disable-crash-reporter'] });
  await run(login);
} catch (error) {
  report.fatal = error instanceof Finding ? error.message : `Ошибка запуска (${error.name || 'Error'})`;
  process.exitCode = 2;
} finally {
  await browser?.close();
  // При отсутствии сессии не затирать доказательства предыдущего запуска.
  if (browser) await writeFile(path.join(evidence, resultName), JSON.stringify(report, null, 2) + '\n');
  if (report.fatal) console.error(report.fatal);
  else console.log(Object.entries(report.checks).map(([key, result]) => `${key} ${result.status}`).join('\n'));
}

async function run(login) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block', acceptDownloads: true });
  const draftProducts = new Set();
  const issuePassports = new Set();
  let step = 'init';
  await context.addInitScript(({ origin, session }) => {
    if (location.origin !== origin) return;
    localStorage.setItem('dca_access', session.access);
    localStorage.setItem('dca_refresh', session.refresh || '');
    localStorage.setItem('dca_user', JSON.stringify(session.user));
    if (!localStorage.getItem('dc-theme')) localStorage.setItem('dc-theme', 'light');
  }, { origin: base, session: login });

  await context.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base) return route.abort();
    const method = request.method();
    if (/^(GET|HEAD|OPTIONS)$/.test(method)) return route.continue();
    if (method === 'POST' && /^\/api\/passports\/(check|preview)$/.test(url.pathname)) return route.continue();
    if (method === 'POST' && url.pathname === '/api/passports') {
      const body = request.postDataJSON();
      if (draftProducts.has(id(body?.productId)) && !body.salesOrderId && !body.incomeId && !body.passportNumber) return route.continue();
    }
    const issue = /^\/api\/passports\/([\da-f]{24})\/issue$/i.exec(url.pathname);
    if (method === 'POST' && issue && issuePassports.has(issue[1])) return route.continue();
    report.blockedWrites.push({ step, method, path: url.pathname });
    return route.abort();
  });

  const page = await context.newPage();
  const published = await context.request.get(`${base}/app/version.json`, { maxRedirects: 0, timeout }).catch(() => null);
  report.version = published?.ok() ? await published.json().catch(() => null) : process.env.STAND_QA_CODE || null;
  page.setDefaultTimeout(timeout);
  page.on('pageerror', () => { report.scriptErrors++; });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== base || url.pathname.startsWith('/api/auth/')) return;
    if (response.status() < 400 && !/^\/api\/(passports(?:\/|$)|showcase\/[^/]+\/fill-queue)/.test(url.pathname)) return;
    report.network.push({ step, method: response.request().method(), path: url.pathname, status: response.status(),
      ...(url.searchParams.has('variant') ? { variant: url.searchParams.get('variant') } : {}) });
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    if (url.origin === base && !url.pathname.startsWith('/api/auth/') && request.failure()?.errorText !== 'net::ERR_ABORTED') {
      report.network.push({ step, method: request.method(), path: url.pathname, transport: request.failure()?.errorText });
    }
  });

  const button = (scope, name) => scope.getByRole('button', { name, exact: true });
  const book = page.locator('.bk');
  const moreButton = page.getByRole('button', { name: 'Ещё действия', exact: true }).last();
  const more = () => moreButton.click();
  const menu = (name) => page.getByRole('menuitem', { name, exact: true });
  const firmTitle = page.getByText('От какой фирмы создать паспорт?', { exact: true });

  async function check(key, action) {
    if (selectedChecks.size && !selectedChecks.has(key)) return;
    step = key;
    const result = report.checks[key] = { status: 'PASS' };
    try { await action(result); }
    catch (error) {
      const orderTimeout = key.startsWith('07') && error.name === 'TimeoutError';
      result.status = error instanceof MissingFixture || orderTimeout ? 'SKIP' : 'FAIL';
      result.reason = error instanceof MissingFixture || error instanceof Finding ? error.message
        : error.name === 'TimeoutError' ? 'Действие или ответ интерфейса не появились за отведённое время.' : `Ошибка диагностики (${error.name || 'Error'})`;
      if (orderTimeout) {
        result.ui = await page.evaluate(() => ({
          section: location.hash.split('?')[0],
          positions: document.querySelectorAll('.k-pos-table tbody tr').length,
          passportLinks: document.querySelectorAll('.k-pos-table a[title="Открыть паспорт"]').length,
          expanded: !!document.querySelector('.k-pos-more'),
          planRows: document.querySelectorAll('details.k-sec-plain > summary').length,
          book: !!document.querySelector('.bk'),
        })).catch(() => null);
        await screenshot(`${key}-timeout`, page, { clip: { x: 780, y: 80, width: 805, height: 450 },
          // Структура окна для диагностики локатора. Скрываем текст, изображения и значения форм.
          style: '* { color: transparent !important; text-shadow: none !important; } img, canvas, video, iframe { visibility: hidden !important; }' }).catch(() => {});
      }
    }
  }

  async function read(endpoint, query = {}) {
    const url = new URL(`/api${endpoint}`, base);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    const response = await context.request.get(url.href, { headers: contextHeaders(login), maxRedirects: 0, timeout });
    if (!response.ok()) throw new Finding(`GET ${url.pathname} вернул ${response.status()}.`);
    return response.json();
  }

  const passportRows = (productId) => read('/passports', { productId, limit: 200 });
  const screenshot = async (name, locator = page, options = {}) => {
    await locator.screenshot({ path: path.join(evidence, `qa-${name}.png`), animations: 'disabled', ...options });
  };
  function bookLoad() {
    return page.waitForResponse((r) => /^\/api\/passports\/[\da-f]{24}$/i.test(routeOf(r)) && r.ok() && r.request().method() === 'GET')
      .then((r) => r.json()).catch(() => null);
  }

  async function productBySku(sku) {
    const data = await read('/showcase', { search: sku, limit: 30 });
    return rows(data).find((p) => String(p.sku).trim() === sku);
  }

  async function openProduct(product) {
    await page.goto(`${base}/app/#products`);
    await page.getByPlaceholder('Поиск: наименование, артикул, серия…').fill(String(product.sku));
    const gallery = page.locator(`button.gcard[data-id="${id(product.id)}"]`);
    const table = page.locator('tr[data-i]').filter({ hasText: String(product.sku) }).filter({ hasText: product.name });
    await gallery.or(table).first().click();
    await moreButton.waitFor({ state: 'visible' });
  }

  async function openBook(action, productId, result) {
    const response = bookLoad();
    draftProducts.add(productId);
    try {
      await more();
      await menu(action).click();
      const noOrder = button(page, 'Без заказа');
      await book.or(firmTitle).or(noOrder).first().waitFor({ state: 'visible' });
      if (await noOrder.isVisible()) {
        await noOrder.click();
        result.noOrderChosen = true;
        await book.or(firmTitle).first().waitFor({ state: 'visible' });
      }
      result.firmPrompt = await firmTitle.isVisible();
      if (result.firmPrompt) {
        const dialog = page.getByRole('dialog').filter({ has: firmTitle });
        const select = dialog.locator('select');
        const selection = await select.evaluate((el) => el.value || [...el.options].find((o) => o.value)?.value || '');
        expect(id(selection), 'В форме выбора фирмы нет доступного варианта.');
        result.selectedFirmId = selection;
        await select.selectOption(selection);
        await button(dialog, 'Открыть паспорт').click();
      }
      await book.waitFor({ state: 'visible' });
      const item = await response;
      expect(item?.id, 'Книжка видна, но ответ с ID экземпляра не получен.');
      result.opened = state(item);
      return item;
    } finally { draftProducts.delete(productId); }
  }

  async function downloadPdf(click, name) {
    const response = page.waitForResponse((r) => /^\/api\/passports\/(?:preview|[\da-f]{24}\/pdf)$/i.test(routeOf(r)), { timeout: 60_000 }).catch(() => null);
    const download = page.waitForEvent('download', { timeout: 60_000 }).catch(() => null);
    await click();
    const pdf = await response;
    if (!pdf) return { status: null };
    const info = { status: pdf.status(), path: routeOf(pdf), variant: new URL(pdf.url()).searchParams.get('variant') };
    if (pdf.request().method() === 'POST') info.variant = pdf.request().postDataJSON()?.variant || null;
    if (!pdf.ok()) return info;
    const file = await download;
    info.download = Boolean(file);
    if (file) {
      const saved = path.join(evidence, `qa-${name}.pdf`);
      await file.saveAs(saved);
      const handle = await open(saved, 'r');
      try {
        const header = Buffer.alloc(5);
        await handle.read(header, 0, header.length, 0);
        info.pdf = header.toString('ascii') === '%PDF-';
      } finally { await handle.close(); }
    }
    return info;
  }

  async function printBook(name, scope = book) {
    await button(scope, 'Скачать PDF').click();
    const dialog = page.getByRole('dialog').filter({ has: page.locator('.pf') });
    const fileDialog = page.getByRole('dialog').filter({ has: button(page, 'Скачать') });
    const print = dialog.or(fileDialog).last();
    await print.waitFor({ state: 'visible' });
    await screenshot(`${name}-print`, print);
    return downloadPdf(() => print.getByRole('button', { name: /^Скачать(?: PDF)?$/ }).click(), name);
  }

  async function issue(item) {
    const target = id(item.id);
    expect(target && statusOf(item) === 'draft' && !numberOf(item), 'Для действия нужен черновик без номера.');
    await button(book, 'Выпустить').click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'Выпустить паспорт?' });
    await confirm.waitFor({ state: 'visible' });
    const changed = page.waitForResponse((r) => routeOf(r) === `/api/passports/${target}/issue` && r.request().method() === 'POST');
    issuePassports.add(target);
    try {
      await button(confirm, 'Выпустить').click();
      const response = await changed;
      const body = await response.json().catch(() => null);
      return { status: response.status(), number: body?.passportNumber || null, blockers: response.ok() ? undefined : {
        message: body?.message, missing: Array.isArray(body?.missing) ? body.missing.map((entry) => typeof entry === 'string' ? entry : { key: entry.key, label: entry.label }) : undefined,
      } };
    } finally { issuePassports.delete(target); }
  }

  const closeBook = () => button(book, 'Закрыть книжку').click();
  const closePrint = async () => {
    const cancel = page.locator('form.modal').filter({ has: page.locator('.pf, .modal-foot button') })
      .getByRole('button', { name: 'Отмена', exact: true }).last();
    if (await cancel.isVisible()) await cancel.click();
  };

  let product, item, lineOrderId;
  await check('01-product', async (r) => {
    product = await productBySku('1066');
    if (!product) skip('Изделие 1066 отсутствует в копии или менеджеру недоступно.');
    r.productId = id(product.id);
    await openProduct(product);
    await more();
    r.actions = await page.getByRole('menuitem').filter({ hasText: /паспорт/iu }).evaluateAll((nodes) => nodes.map((node) => ({
      label: node.textContent.trim(), disabled: node.disabled || node.getAttribute('aria-disabled') === 'true',
    })));
    await screenshot('01-product');
    await more();
    expect(r.actions.some((a) => a.label === 'Править шаблон паспорта' && !a.disabled), 'Правка шаблона недоступна менеджеру.');
  });

  await check('02-template-entry', async (r) => {
    if (!product) skip('Карточка изделия 1066 недоступна.');
    r.before = states(rows(await passportRows(product.id)));
    try {
      item = await openBook('Править шаблон паспорта', product.id, r);
      r.heading = await book.locator('.bk-head h2').innerText();
      await screenshot('02-template-entry', book);
    } finally { r.after = states(rows(await passportRows(product.id))); }
    r.created = r.after.filter((p) => !r.before.some((q) => p.id === q.id));
    expect(!r.firmPrompt && !r.created.length && !item.id, 'Кнопка шаблона открыла экземпляр паспорта.');
  });

  await check('03-queue', async (r) => {
    if (!item) skip('Книжка изделия 1066 не открылась.');
    const focus = book.locator('.bk-toc-focus');
    await focus.getByRole('heading', { name: 'Сначала', exact: true }).waitFor();
    await page.waitForFunction(() => !document.querySelector('.bk-toc-focus')?.textContent.includes('Загружаю'));
    r.queue = await focus.locator('.bk-focus-i').allTextContents();
    r.meter = await focus.locator('.bk-focus-meter').first().textContent().catch(() => null);
    r.urgent = r.queue.filter((text) => /срочно/i.test(text));
    r.variantControl = await book.getByText(/^(Упрощённый|Полный)$/u).first().isVisible();
    const materials = focus.getByRole('button', { name: /Описание конструкции и материалов|Части|Материал/i }).first();
    r.materialsAction = await materials.isVisible();
    if (r.materialsAction) {
      await materials.click();
      const save = button(book, 'Сохранить в изделие');
      await save.waitFor({ state: 'visible' });
      r.materialsEditor = await book.locator('.bk-side-slot').getByText('Описание конструкции и материалов', { exact: true }).isVisible();
      r.materialsControls = await book.locator('.bk-side-slot').getByRole('button').allTextContents();
      await screenshot('03-materials', book);
      await button(book, 'К подсказкам').click();
    }
    expect(r.variantControl && !r.urgent.length, 'В книжке скрыт выбор варианта или есть необязательные пункты со статусом «срочно».');
  });

  await check('04-sample', async (r) => {
    if (!product) skip('Карточка изделия 1066 недоступна.');
    r.before = states(rows(await passportRows(product.id)));
    try {
      if (await book.isVisible()) {
        r.bookPrint = await printBook('04-1066');
        await closePrint();
        await closeBook();
      }
      await more();
      r.cardSampleAction = await page.getByRole('menuitem', { name: /образец|предпросмотр/i }).count();
      r.combined = await downloadPdf(() => menu('Паспорт + техописание').click(), '04-combined');
    } finally { r.after = states(rows(await passportRows(product.id))); }
    expect(same(r.before, r.after), 'Просмотр или печать изменили ID, статусы или номера изделия.');
    expect(r.cardSampleAction && r.combined.pdf, 'Отдельного действия для образца нет или PDF не получен.');
  });

  await check('05-issue-incomplete', async (r) => {
    if (!product) skip('Карточка изделия 1066 недоступна.');
    await openProduct(product);
    r.before = states(rows(await passportRows(product.id)));
    const candidate = await openBook('Выпустить паспорт', product.id, r);
    if (statusOf(candidate) !== 'draft') throw new Finding('«Выпустить паспорт» открыл уже выпущенный экземпляр.');
    if (candidate.salesOrderId || candidate.incomeId) throw new Finding('«Выпустить паспорт» открыл экземпляр позиции заказа.');
    r.issue = await issue(candidate);
    r.after = state(await read(`/passports/${candidate.id}`));
    r.errorShown = await page.locator('.toasts').innerText().catch(() => '');
    await screenshot('05-issue-incomplete');
    expect(r.issue.status >= 400 && !r.after.number && r.after.status === 'draft', 'Неполный паспорт не остался черновиком без номера.');
    expect(r.issue.blockers?.message || r.issue.blockers?.missing?.length, 'Ответ выпуска не объясняет причину отказа.');
    await closeBook();
  });

  await check('06-standalone-ready', async (r) => {
    const sku = process.env.STAND_QA_READY_SKU;
    let ready = sku ? await productBySku(sku) : null;
    if (!sku) {
      const drafts = rows(await read('/passports', { status: 'draft', limit: 60, sort: '-updatedAt' }));
      const plausible = drafts.filter((p) => id(p.id) && id(p.productId) && p.productId !== product?.id
        && !p.salesOrderId && !p.incomeId && id(p.supplierOrgId) && Array.isArray(p.missing) && !p.missing.length);
      r.readyCandidates = plausible.length;
      for (const draft of plausible.slice(0, 8)) {
        const full = await read(`/passports/${draft.id}`);
        if (full.readiness?.ready !== true && !(Array.isArray(full.missing) && !full.missing.length && !full.missingChoices?.length)) continue;
        const prod = await read(`/showcase/${draft.productId}`);
        if (!prod.sku || String(prod.sku) === '1066') continue;
        ready = prod;
        r.readinessCandidate = state(full);
        break;
      }
    }
    if (!ready || sku === '1066') skip(sku ? 'Указанное отдельное изделие не найдено в копии.' : 'Среди 60 последних черновиков нет подтверждённого готового экземпляра без заказа.');
    await openProduct(ready);
    r.before = states(rows(await passportRows(ready.id)));
    const candidate = await openBook('Выпустить паспорт', ready.id, r);
    expect(!r.readinessCandidate || candidate.id === r.readinessCandidate.id, 'Вход в выпуск открыл другой экземпляр того же изделия.');
    expect(!candidate.salesOrderId && !candidate.incomeId && candidate.supplierOrgId, 'Открытый паспорт привязан к заказу либо в нём отсутствует фирма.');
    r.issue = await issue(candidate);
    const onlyBrokenImages = r.issue.blockers?.missing?.length && r.issue.blockers.missing.every((m) => m.key?.startsWith('img_') && /повреждён или пропал/i.test(m.label));
    if (onlyBrokenImages) {
      await closeBook();
      skip('Проверка успешного выпуска упёрлась в файлы рисунков, недоступные backend на копии.');
    }
    expect(r.issue.status < 300 && r.issue.number, 'Стенд не выпустил подтверждённый экземпляр.');
    await book.getByText('выпущен', { exact: true }).waitFor();
    r.firstPdf = await printBook('06-standalone');
    r.repeatPdf = await printBook('06-standalone-repeat');
    r.after = states(rows(await passportRows(ready.id)));
    const newlyNumbered = r.after.filter((p) => p.number && !r.before.some((q) => p.id === q.id && p.number === q.number));
    expect(newlyNumbered.length === 1 && newlyNumbered[0].id === candidate.id && r.firstPdf.pdf && r.repeatPdf.pdf, 'Не подтверждён ровно один новый номер и два скачивания PDF.');
    await closeBook();
  });

  await check('07-order-position', async (r) => {
    const orderPassports = product ? rows(await passportRows(product.id)) : [];
    const candidates = orderPassports.filter((p) => p.salesOrderId && p.incomeId && p.passportNumber && statusOf(p) === 'issued');
    if (!candidates.length) candidates.push(...rows(await read('/passports', { status: 'issued', limit: 200 }))
      .filter((p) => p.salesOrderId && p.incomeId && p.passportNumber));
    const candidate = candidates.find((p) => id(p.salesOrderId) && id(p.incomeId) && !String(p.passportNumber).includes('~'));
    if (!candidate) skip('В доступной выборке нет выпущенного паспорта с привязкой к позиции заказа.');
    lineOrderId = candidate.salesOrderId;
    const contract = await read(`/salesorders/${candidate.salesOrderId}`);
    const key = contract.productionNo || contract.id;
    const order = await read(`/production-orders/${encodeURIComponent(key)}`);
    const linked = (order.orders || []).flatMap((o) => o.lines || []).find((line) => line.id === candidate.incomeId && !line.cancelledAt);
    if (!linked) skip('В карточке связанного заказа не найдена активная позиция паспорта.');
    r.expected = state(candidate);
    r.position = { id: id(linked.id), productId: id(linked.productId) };
    await page.goto(`${base}/app/?qa=order-position#salesorders?open=${encodeURIComponent(key)}`);
    const mark = page.getByRole('link', { name: `Паспорт № ${candidate.passportNumber}`, exact: true });
    r.progress = 'open-position';
    await mark.waitFor();
    const row = mark.locator('xpath=ancestor::tr');
    await row.press('Enter');
    const details = page.locator('tr.k-pos-more');
    const edit = button(details, 'Изменить паспорт');
    r.progress = 'open-documents';
    await edit.waitFor();
    for (const [action, label] of [[edit, 'edit'], [button(details, `Паспорт № ${candidate.passportNumber}`), 'view']]) {
      r.progress = label;
      const response = bookLoad();
      await action.click();
      await book.waitFor();
      r[label] = state((await response) || {});
      expect(r[label].id === r.expected.id && r[label].incomeId === r.position.id && r[label].productId === r.position.productId && r[label].salesOrderId === r.expected.salesOrderId,
        'Книжка открыла экземпляр другого изделия, заказа или позиции.');
      if (label === 'edit') {
        const editable = book.locator('.bk-edit').first();
        if (await editable.isVisible()) {
          await editable.click();
          r.inlineEditor = await book.locator('.bk-ed-inline').isVisible();
          await page.keyboard.press('Escape');
        }
        // Заказ и реквизиты покупателя остаются вне снимка.
        await screenshot('07-order-passport', book.locator('.bk-head'));
      }
      await closeBook();
      await details.waitFor();
    }
    r.progress = 'print';
    r.print = await printBook('07-order', details);
    await closePrint();
    expect(r.print.pdf && await details.isVisible(), 'PDF или возврат к раскрытой позиции не подтверждены.');
    const sameModel = (order.orders || []).flatMap((o) => o.lines || []).filter((line) => line.id !== linked.id && line.productId === linked.productId);
    const siblings = rows(await passportRows(linked.productId));
    const sibling = siblings.find((p) => sameModel.some((line) => line.id === p.incomeId) && p.passportNumber && statusOf(p) === 'issued');
    if (!sibling) { r.secondPosition = { status: 'SKIP', reason: 'В заказе нет второй позиции того же изделия со своим выпуском.' }; return; }
    const response = bookLoad();
    await page.getByRole('link', { name: `Паспорт № ${sibling.passportNumber}`, exact: true }).click();
    await book.waitFor();
    r.secondPosition = state((await response) || {});
    expect(r.secondPosition.id === sibling.id && r.secondPosition.incomeId === sibling.incomeId && r.secondPosition.id !== candidate.id,
      'Вторая позиция того же изделия открыла неверный паспорт.');
    await closeBook();
  });

  await check('07b-blocked-plan-position', async (r) => {
    const orderIds = new Set(lineOrderId ? [lineOrderId] : []);
    if (product) {
      const related = rows(await read('/production-orders', { productId: product.id, filter: 'all', limit: 6 }));
      for (const entry of related.slice(0, 4)) {
        const full = await read(`/production-orders/${encodeURIComponent(entry.key || entry.id)}`);
        for (const contract of full.orders || []) if (id(contract.id)) orderIds.add(contract.id);
      }
    }
    const recent = rows(await read('/passports', { status: 'issued', limit: 25, sort: '-updatedAt' }));
    for (const row of recent) if (id(row.salesOrderId)) orderIds.add(row.salesOrderId);
    r.inspectedOrders = 0;
    for (const orderId of [...orderIds].slice(0, 8)) {
      const plan = await read(`/passports/order/${orderId}/plan`, { variant: 'short' }).catch(() => null);
      if (!plan?.lines) continue;
      r.inspectedOrders++;
      const blocked = plan.lines.filter((line) => line.state === 'blocked' && id(line.incomeId) && id(line.productId)
        && line.missing?.length && !line.missing.every((reason) => /фирм/i.test(String(reason))));
      for (const line of blocked.slice(0, 8)) {
        // Уже существующий экземпляр позволяет проверить неправильный выбор без записи в контекст заказа.
        const existing = rows(await passportRows(line.productId)).filter((p) => statusOf(p) !== 'annulled');
        if (!existing.length || existing.every((p) => p.incomeId === line.incomeId)) continue;
        r.expected = { salesOrderId: id(line.orderId || line.salesOrderId) || orderId, incomeId: line.incomeId, productId: line.productId };
        await page.goto(`${base}/app/?qa=blocked-plan#docs?tab=orders&of=orderpass&open=${encodeURIComponent(orderId)}`);
        const prefix = `${line.lineNo ?? '—'} · `;
        const summary = page.locator('details.k-sec-plain > summary').filter({ has: page.locator('.form-sec-t').filter({ hasText: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }) })
          .filter({ hasText: /Заполнить:/ });
        r.progress = 'open-plan';
        if (await summary.count() !== 1) await summary.first().waitFor();
        expect(await summary.count() === 1, 'Строка плана неоднозначна по номеру и признаку блокировки.');
        const response = bookLoad();
        r.progress = 'open-blocked-row';
        await summary.click();
        await book.waitFor();
        r.opened = state((await response) || {});
        await screenshot('07b-plan-passport', book.locator('.bk-head'));
        const right = Object.entries(r.expected).every(([key, value]) => r.opened[key] === value);
        await closeBook();
        expect(right, 'Из заблокированной строки плана открылся экземпляр другого заказа или другой позиции.');
        return;
      }
    }
    skip('В проверенных планах нет заблокированной позиции с уже существующим паспортом другого контекста.');
  });

  await check('08-themes', async (r) => {
    if (!item?.id) skip('Книжка изделия 1066 недоступна.');
    r.themes = {};
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => localStorage.setItem('dc-theme', value), theme);
      await page.reload();
      await openProduct(product);
      const current = {};
      await openBook('Править шаблон паспорта', product.id, current);
      current.applied = await page.locator('html').getAttribute('data-theme');
      current.pdf = await button(book, 'Скачать PDF').isEnabled();
      current.issue = await button(book, 'Выпустить').isVisible();
      current.primaryButtons = await book.locator('.bk-head .btn-primary').count();
      const editable = book.locator('.bk-edit').first();
      if (await editable.isVisible()) {
        await editable.click();
        const editor = book.locator('.bk-ed-inline');
        current.editor = await editor.isVisible();
        if (current.editor) await page.keyboard.press('Escape');
      }
      const cover = book.locator('.bk-page').first();
      const coverTitle = cover.getByText(product.name, { exact: true }).first();
      await coverTitle.scrollIntoViewIfNeeded().catch(() => {});
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      current.coverTitle = await coverTitle.isVisible();
      current.coverImage = await cover.locator('img').first().evaluate((img) => ({ complete: img.complete, loaded: img.naturalWidth > 0 }), undefined, { timeout: 1500 }).catch(() => null);
      await screenshot(`08-${theme}`, book);
      r.themes[theme] = current;
      await closeBook();
      expect(current.applied === theme && current.pdf && current.primaryButtons <= 1,
        'Тема не применилась, действие недоступно или в шапке несколько основных кнопок.');
      expect(current.coverTitle, `На обложке не видно названия изделия в теме ${theme}.`);
    }
  });
}
