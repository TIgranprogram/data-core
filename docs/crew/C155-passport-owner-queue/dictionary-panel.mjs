// Запуск через api.sh stand BROWSER. Разрешены текущее приложение и одна явно указанная QA-запись на копии.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, path.basename(dir) === 'logs' ? '../..' : '../../..');
const { findBrowser } = await import(pathToFileURL(path.join(root, 'tools/browser-path.mjs')));
const origin = 'http://localhost:3102';
const app = origin + '/app/?qa-entry=1';
const dict = '/api/dicts/passportParts';
const evidence = path.join(root, 'docs/crew/C155-passport-owner-queue/evidence/dictionary-panel');
const masked = '.bk-contacts,.bk-firm,.bk-tm,.bk-warranty,.bk-signature,.topbar [aria-label^="Профиль"],.side-link .cnt,input[type=password] { visibility: hidden !important; }';
const require = createRequire(path.join(root, 'backend/package.json'));
const savedId = process.env.C155_DICT_PANEL_FIXTURE_ID;
const issuedId = process.env.C155_ISSUED_PANEL_PASSPORT_ID;
const mark = 'проверка панели C155';
const objectId = (value) => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
assert.ok(!savedId || objectId(savedId), 'Нужен id QA-записи справочника.');
assert.ok(!issuedId || objectId(issuedId), 'Нужен id выпущенного паспорта.');
assert.ok(!process.stdin.isTTY, 'Сценарий запускает агент доступа.');
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  assert.ok(input.length < 65536, 'Сессия превышает размер, допустимый для прогона.');
}
let login;
try { login = JSON.parse(input); } catch { throw new Error('Не получена сессия агента доступа.'); }
input = '';
const { access, refresh, user } = login || {};
assert.ok(access && refresh && user && (user.role === 'admin' || user.role === 'director' || user.isOwner), 'Нужна сессия с правом редактирования паспортных справочников.');

const { chromium } = require(process.env.STAND_QA_PLAYWRIGHT || '../tools/design-checks/node_modules/playwright-core');
const browser = await chromium.launch({
  executablePath: findBrowser({ ...process.env, DESIGN_BROWSER: process.env.DESIGN_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe' }),
  headless: true,
  args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],
});
const err = [];
let writeAllowed;
let fixture;
let wrote = false;
let activePage;
let status = 'FAIL';
let stage = 'browser-context';
const markStage = (next) => { stage = next; console.log('C155 panel | ' + stage); };
const traffic = [];
const geometry = [];
const timeout = 12_000;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, serviceWorkers: 'block' });
  await context.addInitScript(({ origin, access, refresh, user }) => {
    if (window.top !== window || location.origin !== origin || location.pathname !== '/app/'
      || new URL(location.href).searchParams.get('qa-entry') !== '1') return;
    sessionStorage.setItem('dca_access', access);
    sessionStorage.setItem('dca_refresh', refresh);
    sessionStorage.setItem('dca_user', JSON.stringify(user));
    const open = window.open.bind(window);
    window.dictPanelOpenCalls = 0;
    window.open = (...args) => { window.dictPanelOpenCalls++; return open(...args); };
  }, { origin, access, refresh, user });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    const method = route.request().method();
    if (method !== 'GET' && method !== 'HEAD') {
      const allowed = method === 'PATCH' && savedId && url.pathname === dict + '/' + savedId
        && writeAllowed !== undefined && route.request().postDataJSON()?.genSingular === writeAllowed;
      if (!allowed) return route.fulfill({ status: 403, json: { message: 'Запись вне сценария проверки' } });
      writeAllowed = undefined;
    }
    try {
      const response = await route.fetch({ maxRedirects: 0, timeout });
      if (['/app/', '/api/auth/me', '/api/dicts', dict].includes(url.pathname) || (/^\/api\/dicts\/passportParts\/[a-f0-9]{24}(?:\/usage)?$/i).test(url.pathname)) {
        traffic.push({ stage, method, route: url.pathname, status: response.status() });
      }
      const redirect = response.headers().location;
      if (redirect && new URL(redirect, url).origin !== origin) return route.abort();
      await route.fulfill({ response });
    } catch {
      await route.fulfill({ status: 502, json: { message: 'Не ответила локальная копия' } }).catch(() => {});
    }
  });
  const page = activePage = await context.newPage();
  page.setDefaultTimeout(timeout);
  page.on('pageerror', (error) => err.push(error.name));
  await mkdir(evidence, { recursive: true });
  markStage('app-navigation');
  const appResponse = await page.goto(app + '#dicts?d=passportParts');
  assert.ok(appResponse?.ok(), 'Не загрузилась оболочка приложения.');
  markStage('dictionary-screen');
  await page.getByRole('heading', { name: 'Части изделия', exact: true }).waitFor();
  const read = (resource) => page.evaluate(async (path) => {
    const token = sessionStorage.getItem('dca_access');
    const response = await fetch(path, { headers: { Authorization: 'Bearer ' + token } });
    return response.ok ? response.json() : { status: response.status };
  }, resource);
  markStage('dictionary-list-api');
  const data = await read(dict);
  assert.ok(Array.isArray(data.items), 'Список справочника не загружен. HTTP ' + (data.status || 'не определён'));
  if (savedId) {
    fixture = await read(dict + '/' + savedId);
    assert.match(fixture.name || '', /C155 QA/i, 'Сохранение разрешено для выделенной записи C155 QA.');
  }
  const target = data.items.find((item) => item.name === 'Поручень') || data.items.find((item) => item.id === savedId);
  assert.ok(objectId(target?.id), 'На копии нужна запись «Поручень» или назначенная QA-запись.');
  console.log('C155 panel | entry ' + (target.id === savedId ? 'QA' : 'Поручень'));

  const panel = page.locator('aside.drawer');
  const close = () => panel.getByRole('button', { name: 'Закрыть', exact: true }).click();
  const targetRow = page.locator(`tr[data-id="${target.id}"]`);
  const openFixture = () => page.evaluate((id) => { location.hash = '#dicts?d=passportParts&of=dict&open=' + id; }, savedId);
  const checkPanel = async (name) => {
    const value = panel.locator('input[name=name]');
    await value.waitFor();
    assert.equal(await value.inputValue(), name);
    assert.equal(await page.locator('.drawer.solo').count(), 0);
    assert.equal(await panel.getByRole('button', { name: 'В отдельном окне' }).count(), 0);
    const measured = await panel.evaluate(async (el) => {
      await Promise.all(el.getAnimations().map((animation) => animation.finished.catch(() => {})));
      return {
        rect: el.getBoundingClientRect().toJSON(),
        innerWidth: window.innerWidth,
        clientWidth: document.documentElement.clientWidth,
        bodyRectRight: document.body.getBoundingClientRect().right,
        transform: getComputedStyle(el).transform,
      };
    });
    geometry.push({ stage, ...measured });
    assert.ok(measured.rect.left > 0 && Math.abs(measured.bodyRectRight - measured.rect.right) < 5,
      'Панель не расположена у правого края основного приложения.');
  };

  for (const theme of ['light', 'dark']) {
    markStage(`${theme}-dictionary-row`);
    await page.evaluate((theme) => {
      localStorage.setItem('dc-popout-dict', '1');
      localStorage.setItem('dc-theme', theme);
      document.documentElement.setAttribute('data-theme', theme);
    }, theme);
    await targetRow.click();
    markStage(`${theme}-editor`);
    await checkPanel(target.name);
    assert.equal(context.pages().length, 1, 'При редактировании возникло отдельное окно.');
    assert.equal(await page.evaluate(() => window.dictPanelOpenCalls), 0, 'Открытие пыталось вызвать window.open.');
    await page.screenshot({ path: evidence + '/' + theme + '.png', style: masked });
    await close();
    await panel.waitFor({ state: 'detached' });
  }

  if (fixture) {
    markStage('qa-fixture-save');
    const gen = panel.locator('[name=genSingular]');
    const patch = async (value) => {
      writeAllowed = value;
      await gen.fill(value);
      const done = page.waitForResponse((r) => r.request().method() === 'PATCH' && new URL(r.url()).pathname === dict + '/' + savedId);
      await panel.getByRole('button', { name: 'Сохранить', exact: true }).click();
      assert.ok((await done).ok(), 'Справочник не подтвердил сохранение.');
      await gen.waitFor({ state: 'hidden' });
    };
    await openFixture();
    await checkPanel(fixture.name);
    const before = await gen.inputValue();
    try {
      await patch(mark);
      wrote = true;
      markStage('qa-fixture-reopen');
      await close();
      await panel.waitFor({ state: 'detached' });
      await openFixture();
      await checkPanel(fixture.name);
      assert.equal(await gen.inputValue(), mark);
    } finally {
      if (wrote) {
        markStage('qa-fixture-restore');
        if (!await gen.isVisible()) { await openFixture(); await checkPanel(fixture.name); }
        await patch(before);
        assert.equal((await read(dict + '/' + savedId)).genSingular ?? '', before);
      }
    }
    await close();
    await panel.waitFor({ state: 'detached' });
  }

  markStage('old-window-open');
  const popupWork = page.waitForEvent('popup');
  await page.evaluate((url) => { window.open(url, 'dc-solo-dict', 'popup,width=780,height=820'); },
    app + '#dicts?d=passportParts&of=dict&open=' + target.id);
  const popup = activePage = await popupWork;
  popup.on('pageerror', (error) => err.push(error.name));
  popup.setDefaultTimeout(timeout);
  const old = popup.locator('.drawer.solo');
  const name = old.locator('input[name=name]');
  markStage('old-window-unsaved-input');
  await name.fill('Несохранённая проверка');
  await old.getByRole('button', { name: 'Открыть в панели', exact: true }).click();
  assert.equal(await name.inputValue(), 'Несохранённая проверка');
  await old.getByRole('button', { name: 'Отмена', exact: true }).click();
  await popup.getByRole('button', { name: 'Да, отменить', exact: true }).click();
  await name.waitFor({ state: 'hidden' });
  const closed = popup.waitForEvent('close');
  markStage('old-window-return');
  await old.getByRole('button', { name: 'Открыть в панели', exact: true }).click();
  await closed;
  activePage = page;
  await checkPanel(target.name);
  assert.equal(await page.evaluate(() => localStorage.getItem('dc-popout-dict')), null);
  if (issuedId) {
    markStage('issued-dark');
    await page.evaluate((id) => { location.hash = '#docs?tab=archive&of=passarchive&open=' + id; }, issuedId);
    await panel.getByRole('button', { name: 'Открыть паспорт', exact: true }).click();
    const book = page.locator('.bk-back');
    await book.locator('.bk-stat').filter({ hasText: 'Просмотр и печать доступны в этом окне.' }).waitFor();
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await book.locator('.bk').screenshot({ path: evidence + '/issued-dark.png', style: masked });
  }
  assert.equal(err.length, 0, 'Ошибка JavaScript на основном экране.');
  status = 'PASS';
  console.log(JSON.stringify({ light: 'PASS', dark: 'PASS', legacyReturn: 'PASS', saveAndReopen: wrote ? 'PASS' : 'SKIP_NO_FIXTURE', issuedDark: issuedId ? 'PASS' : 'SKIP_NO_ID' }));
} catch (error) {
  const where = error.stack?.match(/dictionary-panel[^/\\]*\.mjs:\d+:\d+/)?.[0];
  console.error(JSON.stringify({ stage, error: error.name, where, ...(error.name === 'AssertionError' ? { reason: error.message } : {}) }));
  process.exitCode = 1;
} finally {
  if (status === 'FAIL' && activePage && !activePage.isClosed()) {
    const target = new URL(activePage.url()).hash;
    const hideOther = target.startsWith('#dicts?d=passportParts') ? '' : '.page,aside.drawer { visibility: hidden !important; }';
    await activePage.screenshot({ path: evidence + '/failure.png', timeout: 3000, style: masked + hideOther }).catch(() => {});
  }
  await writeFile(evidence + '/result.json', JSON.stringify({ status, stage, pageErrors: err.length, traffic, geometry }, null, 2)).catch(() => {});
  await browser.close();
}
