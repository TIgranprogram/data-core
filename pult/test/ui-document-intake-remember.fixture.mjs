// C245: настоящий UI/HTTP Пульта, искусственный auth и secureSession, только tempdir.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { chromium } from '../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { createPult } from '../server.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pult-c245-ui-'));
const output = path.resolve('docs/crew/C245-pult-remember-login/evidence/auth-ui');
const production = 'https://kppdf-crm.ru/db/api';
const vault = new Map(), calls = [], report = { provenance: 'real Pult UI, fake auth/secureSession; no production HTTP or real credentials', cases: [], errors: [] };
const jwt = claims => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify(claims)).toString('base64url') + '.synthetic';
let serial = 0, browser, pult, diagnosticPage;
const secure = async (mode, value) => {
  if (mode === 'unprotect') { assert.ok(vault.has(value)); return vault.get(value); }
  const key = randomBytes(48).toString('base64'); vault.set(key, value); return key;
};
try {
  await fs.mkdir(output, { recursive: true });
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  for (const state of ['remembered', 'offline', 'memory']) {
    const stateDir = path.join(root, state === 'memory' ? 'memory' : 'remembered');
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'document-intake.json'), JSON.stringify({ apiBase: production, modelBase: 'http://127.0.0.1:1235/v1', model: 'synthetic-C245-model' }));
    pult = createPult({ root: path.resolve(), stateDir, machine: {}, statusFn: async () => ({ gateFiles: [], branch: 'C245 synthetic auth UI', docker: false }),
      documentIntake: { secureSession: state === 'memory' ? null : secure,
        fetchFn: async (url, request) => {
          assert.ok(url === production + '/auth/login' || url === production + '/auth/refresh');
          const body = JSON.parse(request.body); calls.push({ state, action: url.endsWith('/login') ? 'login' : 'refresh', remember: body.remember });
          if (state === 'offline') throw Error('Synthetic offline');
          const exp = Math.floor(Date.now() / 1000), actor = 'synthetic-C245-owner';
          const access = jwt({ sub: actor, version: 1, role: 'admin', orgId: null, exp: exp + 900, nonce: ++serial });
          const refresh = jwt({ sub: actor, version: 1, exp: exp + 86400, rem: body.remember === true, nonce: serial });
          return Response.json({ access, user: { id: actor, role: 'admin', canMoney: true } }, { headers: { 'Set-Cookie': `refreshToken=${refresh}; Path=/api/auth; HttpOnly; Secure` } });
        },
      },
    });
    const port = await pult.listen(0), origin = 'http://127.0.0.1:' + port;
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
    const page = await context.newPage(); diagnosticPage = page; page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(origin); await page.getByRole('button', { name: /Разбор документов/ }).click();
    const aside = page.getByRole('complementary', { name: 'Настройки и отчёт разбора документов' });
    await aside.getByRole('button', { name: 'Настройки', exact: true }).click();
    if (state !== 'offline') {
      await aside.getByLabel('Логин', { exact: true }).fill('synthetic-C245-owner');
      await aside.getByLabel('Пароль', { exact: true }).fill('synthetic-C245-password');
      await aside.getByRole('button', { name: 'Войти', exact: true }).click();
    }
    const expected = state === 'remembered' ? 'Вход выполнен. Пульт запомнил вход на этом ПК.'
      : state === 'offline' ? 'Восстановим вход, когда выбранный сайт ответит.' : 'Вход выполнен. Сессия действует только до закрытия Пульта.';
    await aside.getByText(expected, { exact: true }).waitFor();
    assert.equal(await aside.getByLabel('Пароль', { exact: true }).inputValue(), '');
    assert.doesNotMatch(await page.content(), /synthetic-C245-password/);
    if (state === 'memory') assert.equal(calls.at(-1).remember, false);
    if (state === 'remembered') assert.equal(calls.at(-1).remember, true);
    for (const theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), theme === 'dark');
      await page.evaluate(async () => { await document.fonts.ready; await Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))); });
      const screenshot = path.join(output, `${state}-${theme}.png`);
      await page.screenshot({ path: screenshot }); report.cases.push({ state, theme, text: expected, screenshot, status: 'PASS' });
    }
    if (state === 'offline') {
      const logout = aside.getByRole('button', { name: 'Выйти', exact: true });
      report.offlineLogoutVisible = await logout.isVisible();
      await page.screenshot({ path: path.join(output, 'offline-logout-check.png') });
      assert.equal(report.offlineLogoutVisible, true, 'Сохранённую offline-сессию должно быть возможно удалить кнопкой Выйти');
      await logout.click();
      await aside.getByText('Восстановим вход, когда выбранный сайт ответит.', { exact: true }).waitFor({ state: 'hidden' });
      await assert.rejects(fs.access(path.join(stateDir, 'document-intake-session.json')), { code: 'ENOENT' });
    }
    await context.close(); diagnosticPage = null; await pult.close(); pult = null;
  }
  assert.deepEqual(report.errors, []); report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL'; report.error = String(error.stack || error); process.exitCode = 1;
  if (diagnosticPage) await diagnosticPage.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
}
finally {
  await browser?.close(); await pult?.close(); await fs.writeFile(path.join(output, 'summary.json'), JSON.stringify(report, null, 2));
  assert.equal(path.dirname(root), await fs.realpath(os.tmpdir())); assert.ok(path.basename(root).startsWith('pult-c245-ui-'));
  await fs.rm(root, { recursive: true, force: true });
}
