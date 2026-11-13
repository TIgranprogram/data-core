import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from '../../../../tools/design-checks/node_modules/playwright-core/index.mjs';

let browser;
before(async () => { browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true }); });
after(async () => { await browser?.close(); });
const root = new URL('../../', import.meta.url);
const rows = (page, limit, total, prefix = 'row') => ({ total, items: Array.from({ length: Math.max(0, Math.min(limit, total - (page - 1) * limit)) }, (_, i) => ({ id: `${prefix}-${(page - 1) * limit + i}`, name: `${prefix}-${(page - 1) * limit + i}` })) });
async function fixture({ noObserver = false, respond } = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 } });
  page.setDefaultTimeout(4000);
  const calls = [];
  await page.route('http://pagination.test/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) {
      const query = Object.fromEntries(url.searchParams); calls.push(query);
      const response = respond ? await respond(query) : rows(Number(query.page || 1), Number(query.limit || 100), 250, query.search || 'row');
      return route.fulfill({ status: response.status || 200, contentType: 'application/json', body: JSON.stringify(response.body || response) });
    }
    if (url.pathname === '/app/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head><link rel="stylesheet" href="/app/ui/tokens.css"><link rel="stylesheet" href="/app/ui/base.css"><link rel="stylesheet" href="/app/ui/list.css"><link rel="stylesheet" href="/app/ui/panels.css"><link rel="stylesheet" href="/app/ui/kit/kit.css"></head><body></body></html>' });
    if (!url.pathname.startsWith('/app/') || url.pathname.includes('..')) return route.fulfill({ status: 404 });
    const content = await readFile(new URL(url.pathname.slice(5), root));
    return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: content });
  });
  if (noObserver) await page.addInitScript(() => { window.IntersectionObserver = undefined; });
  await page.goto('http://pagination.test/app/');
  return { page, calls };
}
async function mount(page) {
  await page.evaluate(async () => {
    const { mountList } = await import('/app/ui/kit/list.js');
    window.list = mountList({ id: 'test', title: 'Проверка подгрузки', list: { path: '/test', limit: 100, sortDefault: 'name', card: { title: (r) => r.name, sub: () => '' }, columns: [{ key: 'name', label: 'Название' }] } }, {}, { onOpen() {}, onCreate() {}, onChanged() {} });
    document.body.append(window.list.el);
  });
  await page.waitForFunction(() => document.querySelector('.list-foot')?.textContent.includes('100 из 250'), null, { timeout: 4000 });
}

test('таблица: root области прокрутки загружает до края, затем100→200→250 без дублей', async () => {
  const { page, calls } = await fixture();
  try {
    await mount(page);
    await page.locator('.table-wrap').evaluate((el) => { el.scrollTop = el.scrollHeight - el.clientHeight - 200; });
    await page.waitForFunction(() => document.querySelector('.list-foot')?.textContent.includes('200 из 250'));
    await page.locator('.table-wrap').evaluate((el) => { el.scrollTop = el.scrollHeight - el.clientHeight - 200; });
    await page.waitForFunction(() => document.querySelector('.list-foot')?.textContent.includes('250 из 250'));
    const names = await page.locator('tbody tr td:first-child').allTextContents();
    assert.equal(names.length, 250); assert.equal(new Set(names).size, 250);
    assert.deepEqual(calls.map((q) => q.page), ['1', '2', '3']);
    assert.equal(await page.getByRole('button', { name: 'Показать ещё', exact: true }).count(), 0);
    await page.locator('.table-wrap').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(100); assert.equal(calls.length, 3);
  } finally { await page.close(); }
});

test('после resize к телефону продолжает карточки через прокрутку страницы', async () => {
  const { page } = await fixture();
  try {
    await mount(page); await page.setViewportSize({ width: 390, height: 844 });
    // раскладка карточек после resize перестраивается не сразу — прокручивать, когда карточки на месте
    await page.waitForFunction(() => document.querySelectorAll('.cards > li').length > 0);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(() => document.querySelector('.list-foot')?.textContent.includes('200 из 250'));
    assert.equal(await page.locator('.cards > li').count(), 200);
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.locator('.table-wrap').evaluate((el) => { el.scrollTop = el.scrollHeight - el.clientHeight - 100; });
    await page.waitForFunction(() => document.querySelector('.list-foot')?.textContent.includes('250 из 250'));
  } finally { await page.close(); }
});

test('без observer доступны клавиатурная кнопка, повтор ошибки и защита от устаревшего append', async () => {
  let fail = true; let release; let hold = false;
  const { page, calls } = await fixture({ noObserver: true, respond: async (q) => {
    if (q.search === 'fresh') return rows(1, 100, 3, 'fresh');
    if (q.page === '2' && fail) { fail = false; return { status: 400, body: { message: 'Проверочный сбой' } }; }
    if (q.page === '2' && hold) await new Promise((r) => { release = r; });
    return rows(Number(q.page), Number(q.limit), 250);
  } });
  try {
    await mount(page);
    const more = page.getByRole('button', { name: 'Показать ещё', exact: true });
    await more.focus(); await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Повторить', exact: true }).waitFor();
    assert.equal(await page.locator('tbody tr').count(), 100);
    hold = true;
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.list-foot button')?.disabled);
    await page.evaluate(() => window.list.update({ q: 'fresh', sort: '-name' }));
    await page.waitForFunction(() => document.querySelector('.list-foot')?.textContent.includes('3 из 3'));
    release(); await page.waitForTimeout(100);
    assert.deepEqual(await page.locator('tbody tr td:first-child').allTextContents(), ['fresh-0', 'fresh-1', 'fresh-2']);
    assert.equal(calls.filter((q) => q.page === '2').length, 2);
  } finally { release?.(); await page.close(); }
});

test('autoMore: одновременные more не дублируют страницу, reload отменяет старую, destroy исключает поздний render', async () => {
  const { page } = await fixture({ noObserver: true });
  try {
    await page.evaluate(async () => {
      const { autoMore } = await import('/app/ui/kit/auto-more.js');
      const box = document.createElement('div'); document.body.append(box);
      window.requests = []; window.draws = []; window.mode = 'old';
      window.more = autoMore({ root: box, limit: 2, load: async (number) => {
        const mode = window.mode; window.requests.push([mode, number]);
        if (number === 2) await new Promise((r) => { window.releasePage = r; });
        return { total: 4, items: [0, 1].map((i) => ({ id: mode + (number * 2 + i) })) };
      }, render: (items) => window.draws.push(items.map((x) => x.id)) });
      document.body.append(window.more.el); await window.more.reload();
      window.first = window.more.more(); window.more.more();
      window.mode = 'new'; await window.more.reload(); window.releasePage(); await window.first;
    });
    assert.deepEqual(await page.evaluate(() => window.requests), [['old', 1], ['old', 2], ['new', 1]]);
    assert.deepEqual(await page.evaluate(() => window.more.items.map((x) => x.id)), ['new2', 'new3']);
    assert.equal(await page.getByRole('button', { name: 'Показать ещё', exact: true }).count(), 1);
    await page.evaluate(async () => { window.first = window.more.more(); window.more.destroy(); window.releasePage(); await window.first; });
    assert.deepEqual(await page.evaluate(() => window.draws), [['old2', 'old3'], ['new2', 'new3']]);
  } finally { await page.close(); }
});
