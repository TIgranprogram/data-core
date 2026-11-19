// Запуск через api.sh stand BROWSER на копии. Только чтение.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, path.basename(dir) === 'logs' ? '../..' : '../../..');
const { findBrowser } = await import(pathToFileURL(path.join(root, 'tools/browser-path.mjs')));
const origin = 'http://localhost:3102';
const app = origin + '/app/?qa-entry=1#dicts?d=passportParts&of=dict&open=6afefa496402b642a66109a0';
const output = path.join(root, 'docs/crew/C155-passport-owner-queue/evidence/dictionary-panel');
const mask = '.topbar [aria-label^="Профиль"],.side-link .cnt,.k-nav-n,input[type=password] { visibility:hidden !important; }';
const require = createRequire(path.join(root, 'backend/package.json'));
assert.ok(!process.stdin.isTTY, 'Нужен запуск агентом доступа.');
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  assert.ok(input.length < 65536, 'Сессия превышает допустимый размер.');
}
let session;
try { session = JSON.parse(input); } catch { throw new Error('Не получена сессия агента доступа.'); }
input = '';
assert.ok(session?.access && session.refresh && (session.user?.role === 'admin' || session.user?.isOwner), 'Нужен административный доступ к копии.');

const { chromium } = require(process.env.STAND_QA_PLAYWRIGHT || '../tools/design-checks/node_modules/playwright-core');
const browser = await chromium.launch({
  executablePath: findBrowser({ ...process.env, DESIGN_BROWSER: process.env.DESIGN_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe' }),
  headless: true, args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost'],
});
const report = { status: 'FAIL', stage: 'app', themes: {}, pageErrors: 0, blockedWrites: 0 };
try {
  await mkdir(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 920 }, serviceWorkers: 'block' });
  await context.addInitScript(({ origin, session }) => {
    if (window.top !== window || location.origin !== origin || location.pathname !== '/app/'
      || new URL(location.href).searchParams.get('qa-entry') !== '1') return;
    sessionStorage.setItem('dca_access', session.access);
    sessionStorage.setItem('dca_refresh', session.refresh);
    sessionStorage.setItem('dca_user', JSON.stringify(session.user));
  }, { origin, session });
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!['GET', 'HEAD'].includes(route.request().method())) {
      report.blockedWrites++;
      return route.fulfill({ status: 403, json: { message: 'Сценарий проверяет только чтение' } });
    }
    try {
      const response = await route.fetch({ maxRedirects: 0, timeout: 12000 });
      if (response.headers().location && new URL(response.headers().location, url).origin !== origin) return route.abort();
      await route.fulfill({ response });
    } catch {
      await route.fulfill({ status: 502, json: { message: 'Не ответила копия' } }).catch(() => {});
    }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', () => { report.pageErrors++; });
  await page.goto(app);
  const panel = page.locator('aside.drawer:not(.solo)');
  const first = panel.locator('input[name=name]');
  await first.waitFor();
  assert.match(await first.inputValue(), /C155 QA/, 'Открылась другая запись.');
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => {}))));
  const measure = () => panel.evaluate((el) => {
    const active = document.activeElement;
    const css = getComputedStyle(active);
    return {
      inside: active !== document.body && el.contains(active),
      focusVisible: active.matches(':focus-visible'), tag: active.localName, name: active.getAttribute('name'),
      outlineColor: css.outlineColor, outlineStyle: css.outlineStyle, outlineWidth: css.outlineWidth,
      boxShadow: css.boxShadow, borderColor: css.borderColor,
    };
  });
  const hasRing = (m) => (parseFloat(m.outlineWidth) >= 1 && !['none', 'hidden'].includes(m.outlineStyle)
    && !['transparent', 'rgba(0, 0, 0, 0)'].includes(m.outlineColor)) || m.boxShadow !== 'none';
  for (const theme of ['light', 'dark']) {
    report.stage = theme;
    await page.evaluate((theme) => { document.documentElement.dataset.theme = theme; }, theme);
    await first.focus();
    await page.keyboard.press('Tab');
    const field = await measure();
    const image = 'focus-' + theme + '.png';
    assert.ok(field.inside && field.tag === 'input' && field.name !== 'name' && field.focusVisible && hasRing(field),
      'На поле после Tab нет видимого фокуса.');
    await panel.screenshot({ path: path.join(output, image), style: mask, animations: 'disabled' });
    let button;
    for (let i = 0; i < 16; i++) {
      await page.keyboard.press('Tab');
      button = await measure();
      if (!button.inside || button.tag === 'button') break;
    }
    assert.ok(button?.inside && button.tag === 'button' && button.focusVisible && hasRing(button),
      'На кнопке после Tab нет видимого фокуса.');
    report.themes[theme] = { image, field, button };
  }
  assert.equal(report.pageErrors, 0, 'Ошибка JavaScript.');
  report.status = 'PASS';
  console.log(JSON.stringify({ status: report.status, themes: Object.keys(report.themes), pageErrors: report.pageErrors }));
} catch (error) {
  console.error(JSON.stringify({ stage: report.stage, error: error.name, ...(error.name === 'AssertionError' ? { reason: error.message } : {}) }));
  process.exitCode = 1;
} finally {
  await writeFile(path.join(output, 'focus-result.json'), JSON.stringify(report, null, 2)).catch(() => {});
  await browser.close();
}
