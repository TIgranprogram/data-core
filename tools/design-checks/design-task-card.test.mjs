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
const workId = '000000000000000000000011';
const workPath = '/api/work-tasks/' + workId;
const photos = Array.from({ length: 3 }, (_, i) => ({ id: `photo-${i}`, url: `/fixture-${i}.svg` }));
const task = {
  id: taskId, code: 'D-22', status: 'work', productName: 'Гамак', customerTitle: 'Деревянный гамак по договору',
  productionNo: '11-26', seqNo: 15, orderId: '000000000000000000000031', incomeId: '000000000000000000000032',
  spec: { size: '2100×600×1000', mount: 'Бетонирование', ral: 'Согласовать', raw: 'Подготовить рабочие чертежи.' },
  qty: 3, unit: 'шт', assignee: { id: 'one', name: 'Учебный проектировщик' }, assigneeId: 'one',
  deadline: '2026-09-25',
  notesCount: 1, openQuestions: 1, photos: photos.slice(0, 2),
  production: { state: 'no-product' },
};
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const evidence = process.env.C204_EVIDENCE;
const mediaEvidence = process.env.C207_EVIDENCE;

async function mount(browser, role, width, theme, isWork = false) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const user = { id: 'fixture', username: 'Учебная учётная запись', role };
  const writes = [];
  let row = { ...task };
  const notePath = (isWork ? workPath : path) + '/notes';
  const photoPath = (isWork ? workPath : path) + '/photos';
  const work = { id: workId, code: 'W-11', productName: 'Гамак', status: 'work', stepIndex: 1, route: [{ name: 'Резка', state: 'done' }, { name: 'Сварка', state: 'current' }], qty: 3 };
  const stamp = '2026-11-22T10:00:00Z';
  const author = { id: 'one', name: 'Учебный менеджер', initials: 'УМ' };
  const notes = isWork ? [{ id: 'work-note', kind: 'comment', text: 'Сверьте размеры.', author, createdAt: stamp }] : [
    { id: 'one', kind: 'question', text: 'Сверьте цвет.', needsAnswer: true, author, createdAt: stamp },
    { id: 'legacy', kind: 'comment', text: '[фото] [фото]', legacyPhotoCount: 2, author, createdAt: stamp },
  ];
  const history = [{ action: `${isWork ? 'worktask' : 'designtask'}.created`, createdAt: stamp, userName: author.name }];
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
      if (role === 'manager' && url.pathname === '/api/photos/upload') {
        writes.push({ url: url.pathname });
        return route.fulfill({ json: { id: photos[2].id, storageUrl: photos[2].url } });
      }
      writes.push({ url: url.pathname, body: request.postDataJSON() });
      if (role === 'manager' && url.pathname === notePath && request.method() === 'POST') {
        const body = request.postDataJSON();
        const note = { id: 'new', kind: 'comment', text: body.text, photos: photos.filter(p => body.photoIds?.includes(p.id)), author, createdAt: stamp };
        notes.push(note);
        return route.fulfill({ status: 201, json: note });
      }
      if (role === 'manager' && url.pathname === photoPath + '/main' && request.method() === 'PATCH') {
        const { photoId } = request.postDataJSON();
        row = { ...row, photos: [...row.photos].sort((a, b) => Number(b.id === photoId) - Number(a.id === photoId)) };
        history.unshift({ action: `${isWork ? 'worktask' : 'designtask'}.photo.main`, createdAt: '2026-11-22T10:03:00Z', userName: author.name });
        return route.fulfill({ json: row });
      }
      if (role === 'manager' && url.pathname === photoPath && request.method() === 'POST') {
        row = { ...row, photos: [...row.photos, photos[2]] };
        history.unshift({ action: `${isWork ? 'worktask' : 'designtask'}.photo.added`, createdAt: '2026-11-22T10:02:00Z', userName: author.name });
        return route.fulfill({ json: row });
      }
      if (url.pathname === path && request.method() === 'PATCH' && role === 'manager') {
        row = { ...row, ...request.postDataJSON() };
        return route.fulfill({ json: row });
      }
      return route.fulfill({ status: 403, json: {} });
    }
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: user });
    if (url.pathname === path) return route.fulfill({ json: row });
    if (url.pathname === workPath) return route.fulfill({ json: work });
    if (url.pathname === '/api/work-tasks') return route.fulfill({ json: { items: [work], total: 1 } });
    if (url.pathname === notePath) return route.fulfill({ json: { items: notes } });
    if (url.pathname === photoPath) return route.fulfill({ json: { photos: row.photos } });
    if (url.pathname === '/api/audit-logs/record') return route.fulfill({ json: { items: history } });
    if (url.pathname === '/api/design-board') return route.fulfill({ json: { tasks: [row], orders: [], stickers: [] } });
    if (/^\/fixture-\d\.svg$/.test(url.pathname)) {
      const color = ['#38996a', '#296fac', '#b74f57'][Number(url.pathname.at(-5))];
      return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 220"><rect width="360" height="220" fill="#eee"/><path d="M30 160 Q190 40 330 160 M35 130L120 70L300 100" fill="none" stroke="${color}" stroke-width="14"/></svg>` });
    }
    if (url.pathname.startsWith('/app/')) {
      const name = url.pathname.slice('/app/'.length) || 'index.html';
      try { return route.fulfill({ contentType: mime[extname(name)] || 'application/octet-stream', body: await readFile(new URL(name, app)) }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; return route.fulfill({ status: 404 }); }
    }
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto(origin + (isWork ? '/app/#work?open=' + workId : '/app/#design?open=' + taskId));
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
        await card.getByRole('button', { name: 'Открыть главное фото' }).click();
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

test('D-22 и W-11: обсуждение, история, главное фото и закрытие просмотрщика', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  if (mediaEvidence) await mkdir(mediaEvidence, { recursive: true });
  const attachment = { name: 'эскиз.png', mimeType: 'image/png', buffer: Buffer.from('fixture') };
  try {
    for (const [isWork, role, width, theme] of [[false, 'manager', 1920, 'light'], [true, 'manager', 2560, 'dark'], [true, 'user', 1024, 'dark']]) {
      const { page, context, writes } = await mount(browser, role, width, theme, isWork);
      try {
        const card = page.locator('.drawer').last();
        const text = isWork ? 'Сверьте размеры.' : 'Сверьте цвет.';
        const discussionTitle = card.getByText('Обсуждение', { exact: true });
        await discussionTitle.click();
        assert.equal(await discussionTitle.count(), 1);
        const messages = card.getByRole('log');
        await messages.getByText(text, { exact: true }).waitFor();
        assert.equal(await messages.getByText('[фото] [фото]', { exact: true }).count(), 0);
        assert.equal(await card.getByText('Вопрос менеджеру', { exact: true }).count(), 0);
        const timeline = card.getByText('История изменений', { exact: true });
        await timeline.click();
        if (!isWork) {
          await card.getByText('Добавлено фото · 2', { exact: true }).waitFor();
          await card.getByRole('button', { name: 'К вопросу', exact: true }).waitFor();
        }
        const main = card.getByRole('button', { name: 'Открыть главное фото' });
        await main.click();
        const viewer = page.getByRole('dialog', { name: 'Фото', exact: true });
        await viewer.getByRole('button', { name: 'Закрыть фото' }).waitFor();
        if (mediaEvidence && role === 'manager') await page.screenshot({ path: join(mediaEvidence, `${isWork ? 'work' : 'design'}-viewer.png`) });
        await page.keyboard.press('Escape');
        await viewer.waitFor({ state: 'hidden' });
        assert.equal(await main.evaluate(el => el === document.activeElement), true);
        assert.equal(context.pages().length, 1);
        const send = card.getByRole('button', { name: 'Отправить' });
        if (role === 'user') {
          assert.equal(await send.count(), 0);
          assert.equal(await card.getByRole('button', { name: 'Загрузить фото задачи' }).count(), 0);
          assert.deepEqual(writes, []);
          continue;
        }
        await send.click();
        assert.equal(writes.length, 0);
        const input = card.getByRole('textbox', { name: 'Сообщение', exact: true });
        await input.fill('Образец подтверждён.');
        if (isWork) await input.evaluate(el => {
          const clipboardData = new DataTransfer();
          clipboardData.items.add(new File(['fixture'], 'эскиз.png', { type: 'image/png' }));
          el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }));
        });
        else await card.locator('.dn-form input[type=file]').setInputFiles(attachment);
        await card.getByText('эскиз.png', { exact: true }).waitFor();
        assert.equal(writes.length, 0);
        await send.click();
        await messages.getByText('Образец подтверждён.', { exact: true }).waitFor();
        await messages.getByRole('button', { name: 'Открыть фото крупно' }).click();
        await viewer.getByRole('button', { name: 'Закрыть фото' }).click();
        const gallery = card.getByRole('button', { name: 'Загрузить фото задачи' });
        await gallery.locator('..').locator('input[type=file]').setInputFiles(attachment);
        await card.getByText('Добавлено фото', { exact: true }).waitFor();
        assert.equal(await messages.getByText('Добавлено фото', { exact: true }).count(), 0);
        await card.getByRole('button', { name: 'Действия с фото 2' }).click();
        await page.getByRole('menuitem', { name: 'Сделать главным' }).click();
        await card.getByText('Выбрано главное фото', { exact: true }).waitFor();
        assert.match(await main.locator('img').getAttribute('src'), /fixture-1\.svg$/);
        if (mediaEvidence) {
          await card.locator('.drawer-body').evaluate(el => { el.scrollTop = el.scrollHeight; });
          await card.screenshot({ path: join(mediaEvidence, `${isWork ? 'work' : 'design'}-discussion.png`) });
        }
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});
