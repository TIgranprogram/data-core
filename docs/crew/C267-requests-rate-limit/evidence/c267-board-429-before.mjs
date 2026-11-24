// Диагностика C267: искусственный отказ одной колонки, без перегрузки сервера. Только стенд.
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
const report = { requests: [], responses: [], errors: [] };
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  await context.addInitScript(({ access, refresh, user }) => {
    localStorage.setItem('dca_access', access); localStorage.setItem('dca_refresh', refresh || '');
    localStorage.setItem('dca_user', JSON.stringify(user)); localStorage.setItem('dc-theme', 'soft');
  }, { access: session.access, refresh: session.refresh, user: session.user });
  // Служебные сообщения о синтетических ошибках не записываем даже в журнал копии.
  await context.route('**/api/client-errors**', route => route.fulfill({ status: 201, json: { id: 'fixture' } }));
  const page = await context.newPage();
  const start = Date.now();
  const isList = url => new URL(url).pathname.endsWith('/api/supply/requests');
  page.on('pageerror', e => report.errors.push(e.message));
  page.on('request', request => { if (isList(request.url())) report.requests.push({ at: Date.now() - start, status: new URL(request.url()).searchParams.get('status'), page: new URL(request.url()).searchParams.get('page') }); });
  page.on('response', response => { if (isList(response.url())) report.responses.push({ at: Date.now() - start, status: new URL(response.url()).searchParams.get('status'), code: response.status() }); });
  let blockedUntil = 0;
  await context.route('**/api/supply/requests?**', async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get('status') !== 'requested') return route.continue();
    blockedUntil ||= Date.now() + 3000;
    if (Date.now() < blockedUntil) return route.fulfill({ status: 429, headers: { 'content-type': 'application/json', 'Retry-After-long': String(Math.ceil((blockedUntil - Date.now()) / 1000)) }, body: JSON.stringify({ message: 'ThrottlerException: Too Many Requests' }) });
    return route.continue();
  });
  await page.goto('http://localhost:3102/app/#requests?view=board', { waitUntil: 'domcontentloaded' });
  await page.locator('.board .col').first().waitFor();
  await page.waitForTimeout(4300);
  report.failed = await page.locator('.board .is-failed').count();
  report.retryButtons = await page.getByRole('button', { name: 'Повторить', exact: true }).count();
  report.text = (await page.locator('.board .col').first().innerText()).slice(0, 600);
  await page.screenshot({ path: path.join(out, 'before-429.png') });
  await context.close();
} catch (error) { report.errors.push(error.message); }
finally { await browser.close(); }
await writeFile(path.join(out, 'before.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exitCode = 1;
