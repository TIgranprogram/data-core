// C267: управляемые429 только в браузере; стенд не перегружаем, бизнес-записей нет.
import { createRequire } from 'node:module';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'docs/crew/C267-requests-rate-limit/evidence');
const require = createRequire(path.join(root, 'tools/design-checks/package.json'));
const { chromium } = require('playwright-core');
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 200000) throw new Error('stdin слишком длинный'); }
const session = JSON.parse(input);
if (!session.access || !session.user) throw new Error('Нет сессии стенда');
let executablePath;
for (const name of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
  try { await access(name); executablePath = name; break; } catch { /* следующий */ }
}
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const report = { checks: [], cases: [], errors: [], screenshots: [] };
const check = (ok, name, data) => report.checks.push({ ok: !!ok, name, data });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const base = 'http://localhost:3102/app/';
const colSelector = '.board .col[data-key="requested"]';
async function run(kind, theme = 'light') {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(({ access, refresh, user, theme }) => {
    localStorage.setItem('dca_access', access); localStorage.setItem('dca_refresh', refresh || '');
    localStorage.setItem('dca_user', JSON.stringify(user)); localStorage.setItem('dc-theme', theme);
  }, { access: session.access, refresh: session.refresh, user: session.user, theme });
  await context.route('**/api/client-errors**', route => route.fulfill({ status: 201, json: { id: 'fixture' } }));
  const page = await context.newPage();
  const data = { kind, theme, requests: [], otherRequests: 0, responses: [] };
  page.on('pageerror', error => report.errors.push(kind + ': ' + error.message));
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.pathname.endsWith('/api/supply/requests')) data.responses.push({ status: url.searchParams.get('status'), code: response.status() });
  });
  let start = 0;
  await context.route('**/api/supply/requests?**', async route => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get('status');
    if (status !== 'requested') {
      data.otherRequests++;
      if (kind === 'neighbor' && status === 'ordered') await sleep(1500);
      return route.continue();
    }
    start ||= Date.now();
    const q = url.searchParams.get('search') || '';
    const at = Date.now() - start;
    data.requests.push({ at, q });
    const n = data.requests.length;
    let blocked;
    if (kind === 'transient') blocked = at < 3000;
    else if (kind === 'repeated') blocked = n <= 2;
    else if (kind === 'cancel') blocked = !q;
    else if (kind === 'destroy') blocked = true;
    else blocked = n === 1;
    if (!blocked) return route.continue();
    const headers = { 'content-type': 'application/json' };
    if (!['no-header', 'neighbor'].includes(kind)) headers['Retry-After-long'] = kind === 'repeated' ? '1' : String(Math.max(1, Math.ceil((3000 - at) / 1000)));
    return route.fulfill({ status: 429, headers, body: JSON.stringify({ message: 'ThrottlerException: Too Many Requests' }) });
  });
  const shot = async name => { await page.screenshot({ path: path.join(out, name + '.png') }); report.screenshots.push(name + '.png'); };
  const readable = async (element, name) => {
    const style = await element.evaluate(el => {
      let opacity = 1;
      for (let node = el; node && node !== document.body; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity);
      return { opacity, color: getComputedStyle(el).color, insideCards: !!el.closest('.col-body') };
    });
    check(style.opacity >= .99 && !style.insideCards, name + ': сообщение/действие не приглушено с карточками', style);
  };
  try {
    await page.goto(base + '#requests?view=board', { waitUntil: 'domcontentloaded' });
    const col = page.locator(colSelector);
    await col.waitFor();
    if (kind === 'transient') {
      await col.locator('[role="status"]').waitFor();
      const waiting = await col.innerText();
      check(/подожд|пауза|ожида|огранич/i.test(waiting), kind + theme + ': ожидание объяснено', waiting.slice(-220));
      await readable(col.locator('[role="status"]'), theme + '-waiting');
      await shot(theme + '-waiting');
      await page.waitForFunction(selector => { const c = document.querySelector(selector); return c && !c.querySelector('.is-failed, .is-loading, .skel') && /^\d/.test(c.querySelector('.n')?.textContent || ''); }, colSelector, { timeout: 10000 });
      check(data.requests.length === 2 && data.requests[1].at >= 2950, theme + ': пауза сервера соблюдена', data.requests);
      check(await col.locator('.is-failed').count() === 0, theme + ': колонка восстановилась');
      await shot(theme + '-recovered');
    } else if (kind === 'cancel' || kind === 'destroy') {
      await col.locator('[role="status"]').waitFor();
      if (kind === 'destroy') {
        await page.locator('.sidebar a').filter({ hasText: 'Продукция' }).first().click();
        await page.waitForFunction(() => location.hash.startsWith('#products'));
      }
      else {
        const search = page.locator('.filter-tools .sb input');
        await search.fill('болт'); await search.press('Enter');
        await page.waitForFunction(() => location.hash.includes('q='));
      }
      await sleep(3700);
      check(data.requests.filter(r => !r.q).length === 1, kind + ': устаревший повтор не отправлен', data.requests);
      check(kind === 'destroy' ? await page.locator('.board').count() === 0 : await page.locator(colSelector + ' .is-failed').count() === 0, kind + ': новый экран не испорчен');
    } else {
      const retry = col.getByRole('button', { name: 'Повторить', exact: true });
      await retry.waitFor({ timeout: 7000 });
      await readable(retry, kind + '-retry');
      await shot(kind + '-retry');
      const expected = kind === 'repeated' ? 2 : 1;
      check(data.requests.length === expected, kind + ': нет лишних автоматических попыток', data.requests);
      const others = data.otherRequests;
      await retry.click();
      await page.waitForFunction(selector => { const c = document.querySelector(selector); return c && !c.querySelector('.is-failed, .skel') && /^\d/.test(c.querySelector('.n')?.textContent || ''); }, colSelector, { timeout: 8000 });
      check(data.requests.length === expected + 1, kind + ': явный повтор загрузил колонку', data.requests);
      check(data.otherRequests === others, kind + ': соседние колонки не перезапрашиваются', { before: others, after: data.otherRequests });
      if (kind === 'neighbor') {
        await page.waitForFunction(() => /^\d/.test(document.querySelector('.col[data-key="ordered"] .n')?.textContent || ''), null, { timeout: 7000 });
        check(true, 'neighbor: запоздавший ответ соседней колонки сохранён');
      }
      await shot(kind + '-recovered');
    }
    data.failedColumns = await page.locator('.board .is-failed').count();
    data.theme = await page.evaluate(() => document.documentElement.dataset.theme);
    data.pageOverflow = await page.evaluate(() => document.scrollingElement.scrollHeight - innerHeight);
    check(data.pageOverflow <= 1, kind + theme + ': геометрия страницы сохранена', data.pageOverflow);
  } catch (error) { report.errors.push(kind + theme + ': ' + error.message); }
  finally { report.cases.push(data); await context.close(); }
}
try {
  const cases = process.env.C267_CASES?.split(',');
  if (!cases || cases.includes('transient')) { await run('transient', 'light'); await run('transient', 'dark'); }
  if (!cases || cases.includes('repeated')) await run('repeated', 'soft');
  if (!cases || cases.includes('no-header')) await run('no-header', 'light');
  if (!cases || cases.includes('neighbor')) await run('neighbor', 'light');
  if (!cases || cases.includes('cancel')) await run('cancel', 'light');
  if (!cases || cases.includes('destroy')) await run('destroy', 'light');
} finally { await browser.close(); }
await writeFile(path.join(out, process.env.C267_CASES ? 'after-' + process.env.C267_CASES.replace(/[^a-z-]/g, '-') + '.json' : 'after.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.checks.filter(c => c.ok).length, failed: report.checks.filter(c => !c.ok), errors: report.errors, screenshots: report.screenshots }, null, 2));
if (report.errors.length || report.checks.some(c => !c.ok)) process.exitCode = 1;
