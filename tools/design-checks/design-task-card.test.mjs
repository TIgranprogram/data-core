import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const app = new URL('../../backend/pwa/', import.meta.url);
const origin = 'http://127.0.0.1:41736';
const taskId = '000000000000000000000022';
const path = '/api/design-tasks/' + taskId;
const task = {
  id: taskId, code: 'D-22', status: 'work', productName: 'Гамак', customerTitle: 'Деревянный гамак по договору',
  productionNo: '11-26', seqNo: 15, orderId: '000000000000000000000031', incomeId: '000000000000000000000032',
  spec: { size: '2100×600×1000', mount: 'Бетонирование', ral: 'Согласовать', raw: 'Подготовить рабочие чертежи.' },
  qty: 3, unit: 'шт', assignee: { id: 'one', name: 'Учебный проектировщик' }, assigneeId: 'one',
  deadline: '2026-09-25',
  notesCount: 1, openQuestions: 1, photos: [{ id: 'img', url: '/app/icon.svg' }],
  production: { state: 'no-product' },
};
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const evidence = process.env.C204_EVIDENCE;

async function mount(browser, role, width, theme) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const user = { id: 'fixture', username: 'Учебная учётная запись', role };
  const writes = [];
  let row = { ...task };
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  await context.addInitScript(({ user, theme }) => {
    localStorage.setItem('dc-theme', theme);
    sessionStorage.setItem('dca_access', 'fixture');
    sessionStorage.setItem('dca_refresh', 'fixture');
    sessionStorage.setItem('dca_user', JSON.stringify(user));
  }, { user, theme });
  await page.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (!['GET', 'HEAD'].includes(request.method())) {
      writes.push({ url: url.pathname, body: request.postDataJSON() });
      if (url.pathname === path && request.method() === 'PATCH' && role === 'manager') {
        row = { ...row, ...request.postDataJSON() };
        return route.fulfill({ json: row });
      }
      return route.fulfill({ status: 403, json: {} });
    }
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: user });
    if (url.pathname === path) return route.fulfill({ json: row });
    if (url.pathname === path + '/notes') return route.fulfill({ json: { items: [{ id: 'one', kind: 'question', text: 'Сверьте цвет.', needsAnswer: true, author: { name: 'Учебный менеджер', initials: 'УМ' }, createdAt: '2026-11-22' }] } });
    if (url.pathname === '/api/design-board') return route.fulfill({ json: { tasks: [row], orders: [], stickers: [] } });
    if (url.pathname.startsWith('/app/')) {
      const name = url.pathname.slice('/app/'.length) || 'index.html';
      try { return route.fulfill({ contentType: mime[extname(name)] || 'application/octet-stream', body: await readFile(new URL(name, app)) }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; return route.fulfill({ status: 404 }); }
    }
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto(origin + '/app/#design?open=' + taskId);
  return { page, context, writes };
}

test('Карточка проектирования показывает задание первым, различает завершение и запуск и сохраняет права', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  if (evidence) await mkdir(evidence, { recursive: true });
  try {
    for (const [role, width, theme] of [['manager', 1920, 'soft'], ['user', 1024, 'dark']]) {
      const { page, context, writes } = await mount(browser, role, width, theme);
      try {
        const card = page.locator('.drawer').last();
        const table = card.getByRole('table', { name: 'Задание на проектирование' });
        await table.getByText('Бетонирование').waitFor();
        if (theme === 'dark') {
          await card.evaluate(node => { node.style.width = '420px'; });
          assert.ok(await card.locator('.k-head-meta .due').evaluate(node => {
            const panel = node.closest('.drawer').getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(node);
            const lines = [...range.getClientRects()];
            return lines.length > 0 && lines.length <= 2 && lines.every(line => line.right <= panel.right - 8);
          }));
        }
        assert.equal(await card.locator('.pgal').count(), 0);
        const next = card.getByText('Для запуска сопоставьте позицию заказа с изделием.', { exact: true });
        assert.ok((await table.boundingBox()).y < (await next.boundingBox()).y);
        if (evidence) await card.screenshot({ path: join(evidence, 'task-' + width + '.png') });
        await table.getByRole('row', { name: /Деревянный гамак/ }).click();
        await card.getByText('Подготовить рабочие чертежи.', { exact: true }).waitFor();
        await card.getByText('Обсуждение', { exact: true }).click();
        await card.getByText('Сверьте цвет.', { exact: true }).waitFor();
        await card.getByText('Фото и стикеры', { exact: true }).click();
        await card.getByRole('button', { name: 'Открыть галерею' }).click();
        await page.getByRole('dialog', { name: 'Фото', exact: true }).waitFor();
        await page.getByRole('button', { name: 'Закрыть фото' }).click();
        const finish = card.getByRole('button', { name: 'Завершить проектирование', exact: true });
        await card.getByRole('button', { name: 'Ещё действия', exact: true }).click();
        const edit = card.getByRole('menuitem', { name: 'Изменить задачу', exact: true });
        if (role === 'manager') {
          await edit.waitFor();
          await card.getByRole('button', { name: 'Ещё действия', exact: true }).click();
          await finish.click();
          await finish.waitFor({ state: 'hidden' });
          await next.waitFor();
          assert.deepEqual(writes, [{ url: path, body: { status: 'done' } }]);
        } else {
          assert.equal(await edit.count(), 0);
          assert.equal(await finish.count(), 0);
          assert.deepEqual(writes, []);
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});
