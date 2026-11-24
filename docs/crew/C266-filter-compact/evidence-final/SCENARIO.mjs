// C266: только чтение изолированного стенда; сессия поступает через stdin, в отчёты не попадает.
import { createRequire } from 'node:module';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.join(root, 'docs/crew/C266-filter-compact/evidence-final');
const require = createRequire(path.join(root, 'tools/design-checks/package.json'));
const { chromium } = require('playwright-core');
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 200000) throw new Error('stdin слишком длинный'); }
const session = JSON.parse(input);
if (!session.access || !session.user) throw new Error('Нет сессии стенда');
const candidates = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'];
let executablePath;
for (const name of candidates) { try { await access(name); executablePath = name; break; } catch { /* следующий */ } }
if (!executablePath) throw new Error('Нет браузера');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath, headless: true });
const report = { checks: [], metrics: [], screenshots: [], errors: [] };
const check = (ok, name, data) => report.checks.push({ ok: !!ok, name, ...(data === undefined ? {} : { data }) });
const base = 'http://localhost:3102/app/';
const settle = page => page.waitForTimeout(600);
async function shot(page, name) {
  await page.screenshot({ path: path.join(out, name + '.png') });
  report.screenshots.push(name + '.png');
}
async function geometry(page, name) {
  const m = await page.evaluate(() => {
    const side = document.querySelector('.list-screen .list-side');
    const main = document.querySelector('.ls-main');
    const body = side?.querySelector('.ls-body');
    const box = el => { const r = el?.getBoundingClientRect(); return r && { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
    const clipped = [...document.querySelectorAll('.ff-nv')].filter(el => el.offsetWidth && el.scrollWidth > el.clientWidth + 1).map(el => el.textContent);
    return { side: box(side), main: box(main), body: body && { client: body.clientHeight, scroll: body.scrollHeight, width: body.clientWidth, scrollWidth: body.scrollWidth }, clipped,
      height: innerHeight, pageOverflow: document.scrollingElement.scrollHeight - innerHeight, pageX: document.scrollingElement.scrollWidth - innerWidth,
      theme: document.documentElement.dataset.theme, focus: document.activeElement?.dataset?.fk || '' };
  });
  report.metrics.push({ name, ...m });
  if (m.side?.width) {
    check(m.side.bottom <= m.height + 1, name + ': панель в окне', m.side.bottom);
    check(Math.abs(m.side.y - m.main.y) <= 1, name + ': панель на одном уровне со списком');
    check(m.body.scrollWidth <= m.body.width + 1, name + ': панель без горизонтального скролла');
  }
  check(m.clipped.length === 0, name + ': значения целиком', m.clipped);
  check(m.pageOverflow <= 1 && m.pageX <= 1, name + ': страница без лишнего скролла');
}
try {
  for (const theme of ['light', 'soft', 'dark']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
    await context.addInitScript(({ access, refresh, user, theme }) => {
      localStorage.setItem('dca_access', access); localStorage.setItem('dca_refresh', refresh || ''); localStorage.setItem('dca_user', JSON.stringify(user));
      localStorage.setItem('dc-theme', theme); localStorage.setItem('dc:filters:open:stock', '1');
    }, { access: session.access, refresh: session.refresh, user: session.user, theme });
    const page = await context.newPage();
    page.on('pageerror', e => report.errors.push(theme + ': ' + e.message));
    await page.goto(base + '#stock?all=1', { waitUntil: 'domcontentloaded' });
    await page.locator('.list-screen h1').waitFor();
    await page.getByRole('button', { name: 'Трубы', exact: true }).first().click();
    const pipe = page.locator('[data-fk="g:pipe"]');
    await pipe.waitFor(); await settle(page);
    check(await pipe.getAttribute('aria-expanded') === 'false', theme + ': труба сначала свёрнута');
    await geometry(page, theme + '-collapsed'); await shot(page, theme + '-collapsed');
    await pipe.click(); await page.getByRole('textbox', { name: 'Найти размер трубы' }).waitFor(); await settle(page);
    check(await page.locator('.ff-pipe .ff-num').count() <= 24, theme + ': первые 24 варианта');
    await geometry(page, theme + '-expanded'); await shot(page, theme + '-expanded');
    const more = page.locator('[data-fk="pipe-more"]');
    if (await more.count()) {
      const before = await page.locator('.ff-pipe .ff-num').count(); await more.click(); await settle(page);
      check(await page.locator('.ff-pipe .ff-num').count() > before, theme + ': Ещё показывает остальные');
      await page.locator('.ls-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
      check(await page.locator('.ls-body').evaluate(el => el.scrollTop > 0), theme + ': тело панели прокручивается');
    }
    const search = page.getByRole('textbox', { name: 'Найти размер трубы' });
    await search.fill('20x20'); await settle(page);
    const latin = await page.locator('.ff-pipe .ff-num').count();
    await search.fill('20х20'); await settle(page);
    const cyrillic = await page.locator('.ff-pipe .ff-num').count();
    check(latin > 0 && latin === cyrillic, theme + ': латинский и русский х дают одинаковый результат', { latin, cyrillic });
    await search.fill('zzzz9999'); await settle(page);
    check(await page.getByText('Нет такого размера', { exact: true }).isVisible(), theme + ': пустая выдача объяснена');
    await search.press('Escape'); await settle(page);
    check(await search.inputValue() === '', theme + ': Esc очищает поиск');
    await search.fill('20'); await settle(page);
    await search.evaluate(el => el.setSelectionRange(0, 0)); await search.press('ArrowRight'); await search.press('3'); await settle(page);
    check(await search.evaluate(el => document.activeElement === el && el.selectionStart === 2), theme + ': каретка остаётся на месте');
    await search.fill('20'); await settle(page); await shot(page, theme + '-search');
    const first = page.locator('.ff-pipe .ff-num').first();
    const chosen = await first.getAttribute('data-fk');
    await first.click(); await settle(page);
    check(await page.locator('[data-fk="x:pipe"]').count() === 1 && (await page.evaluate(() => location.hash)).includes('ft='), theme + ': размер выбран');
    check(await page.evaluate(() => document.activeElement?.dataset?.fk === 'x:pipe'), theme + ': фокус на выбранном шаге');
    const filterCount = await page.locator('.filter-tools > button').first().innerText();
    check(filterCount.includes('1'), theme + ': одна труба считается одним фильтром', filterCount);
    await shot(page, theme + '-selected');
    await page.locator('[data-fk="x:pipe"]').click(); await settle(page);
    check(!(await page.evaluate(() => location.hash)).includes('ft='), theme + ': выбранный шаг снимается');
    await page.locator('[data-fk="g:wash"]').waitFor();
    const wash = page.locator('.ff-wash .ff-num').first(); await wash.click(); await settle(page);
    check(await page.locator('[data-fk="x:wash"]').count() === 1, theme + ': мойка выбирается');
    const reset = page.locator('.filter-tools .ls-reset'); await reset.click(); await settle(page);
    check(!(await page.evaluate(() => location.hash)).includes('ft=') && await reset.isHidden(), theme + ': общий сброс завершён');
    const toggle = page.locator('.filter-tools > button').first(); await toggle.click();
    check(await page.locator('.list-side').isHidden(), theme + ': панель закрывается'); await toggle.click();
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-fk="g:pipe"]').waitFor();
    check(await page.locator('.list-side').isVisible(), theme + ': открытие панели запомнено');
    if (theme === 'light') {
      for (const [width, height] of [[2560, 1440], [1024, 900], [1440, 640]]) {
        await page.setViewportSize({ width, height }); await settle(page);
        const resize = page.getByRole('separator', { name: 'Ширина панели фильтров' });
        await resize.focus(); await resize.press('Home'); await settle(page);
        await page.locator('[data-fk="g:pipe"]').click(); await settle(page);
        await geometry(page, 'light-' + width); await shot(page, 'light-' + width);
        await page.locator('[data-fk="g:pipe"]').click();
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      for (const hash of ['#requests?view=table', '#products?view=table', '#money?tab=debts', '#movements']) {
        await page.goto(base + hash, { waitUntil: 'domcontentloaded' }); await page.locator('.list-screen h1').waitFor(); await settle(page);
        await geometry(page, hash); await shot(page, hash.replace(/[^a-z]/g, '-'));
      }
    }
    await context.close();
  }
} catch (error) { report.errors.push(error.message); }
finally { await browser.close(); }
await writeFile(path.join(out, 'metrics.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.checks.filter(c => c.ok).length, failed: report.checks.filter(c => !c.ok), errors: report.errors, screenshots: report.screenshots }, null, 2));
if (report.errors.length || report.checks.some(c => !c.ok)) process.exitCode = 1;
