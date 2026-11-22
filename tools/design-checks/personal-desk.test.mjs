import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const base = 'http://127.0.0.1:41738';
const app = new URL('../../backend/pwa/', import.meta.url);
const proof = new URL('../../docs/crew/C221-desk-finish/proof/', import.meta.url);
const proofC232 = new URL('../../docs/crew/C232-desk-organization/proof/', import.meta.url);
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const userId = '000000000000000000000001';
const workId = '000000000000000000000077';
const requestId = '000000000000000000000176';
const blocked = '000000000000000000000888';
const productId = '000000000000000000000054';
const positionId = '000000000000000000000975';
const taskId = 'debeeb93-b999-497a-a8ad-27fbe0cf7a36';

async function mount(browser, { theme = 'soft', width = 1920, role = 'manager', filled = true, recentExtra = 0 } = {}) {
  const user = { id: userId, username: 'anna', displayName: 'Анна', role, ...(role === 'user' ? { sections: ['design'] } : {}) };
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(6500);
  const err = [], requests = [], writes = [];
  page.on('pageerror', (e) => err.push(e.message));
  const initial = filled ? [
    { of: 'salesorders', id: '41-26', lane: 'focus' },
    { of: 'work', id: workId, lane: 'next' },
    { of: 'requests', id: requestId, lane: 'waiting' },
    { of: 'stock', id: blocked, lane: 'waiting' },
    { of: 'personal', id: 'debeeb93-b999-497a-a8ad-27fbe0cf7a36', lane: 'focus', title: 'Согласовать покрытие для скамьи', due: '2026-12-01', done: false },
  ] : [];
  let layout = { version: 0, items: initial };
  let conflict = false;
  const files = [];
  const extras = Array.from({ length: recentExtra }, (_, i) => ({ id: String(200 + i).padStart(24, '0'), name: 'Изделие из недавних № ' + (i + 1) }));
  await context.addInitScript(({ user, theme, productId, requestId, blocked, extras, positionId }) => {
    localStorage.setItem('dc-theme', theme);
    sessionStorage.setItem('dca_access', 'fixture');
    sessionStorage.setItem('dca_refresh', 'fixture');
    sessionStorage.setItem('dca_user', JSON.stringify(user));
    localStorage.setItem('dc-recent-cards::' + user.id, JSON.stringify([
      { section: 'products', of: 'products', id: productId, title: 'Скамья парковая, оцинкованная рама' },
      { section: 'requests', of: 'requests', id: requestId, title: 'Заявка снабжения' },
      { section: 'stock', of: 'stock', id: blocked, title: 'Закрытая позиция только для другой зоны' },
      ...extras.map(({ id, name }) => ({ section: 'products', of: 'products', id, title: name })),
      { section: 'salesorders', of: 'salesorders', id: '41-26', title: 'Заказ № 41-26' },
      { section: 'salesorders', of: 'orders', id: positionId, title: 'Скамья, позиция 4' },
    ]));
  }, { user, theme, productId, requestId, blocked, extras, positionId });
  await page.route('**/*', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== base) return route.abort();
    requests.push(url.pathname);
    if (url.pathname.startsWith('/app/')) {
      const name = url.pathname.slice('/app/'.length) || 'index.html';
      try { return route.fulfill({ contentType: mime[extname(name)] || 'application/octet-stream', body: await readFile(new URL(name, app)) }); }
      catch (e) { if (e.code !== 'ENOENT') throw e; return route.fulfill({ status: 404 }); }
    }
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: user });
    if (url.pathname === '/api/auth/me/desk') {
      if (req.method() === 'PUT') {
        const body = req.postDataJSON();
        writes.push(body);
        if (conflict) {
          conflict = false;
          layout = { version: layout.version + 1, items: [...layout.items,
            { of: 'personal', id: '0233818b-8223-4910-8045-4bb2060ef16c', lane: 'next', title: 'Подтвердить размеры вместе с монтажом', done: false }] };
        }
        if (body.version !== layout.version) return route.fulfill({ status: 409, json: { message: 'Стол уже изменился' } });
        layout = { version: layout.version + 1, items: body.items, ...(body.lanes ? { lanes: body.lanes } : {}) };
      }
      return route.fulfill({ json: layout });
    }
    if (url.pathname === '/api/auth/me/desk/tasks/' + taskId + '/files') {
      if (req.method() === 'POST') files.push({ id: '000000000000000000000555', name: 'Дополнение.txt', size: 13, uploadedAt: '2026-11-22T12:00:00.000Z' });
      return route.fulfill({ status: req.method() === 'POST' ? 201 : 200, json: req.method() === 'POST' ? files.at(-1) : files });
    }
    if (url.pathname === '/api/auth/me/desk/tasks/' + taskId + '/files/000000000000000000000555') {
      return route.fulfill({ contentType: 'application/octet-stream', body: 'Приложение' });
    }
    if (url.pathname === '/api/incomes/' + positionId) return route.fulfill({ json: { id: positionId, title: 'Скамья, позиция 4', qty: 2, orderNo: '41-26' } });
    if (url.pathname === '/api/production-orders/41-26') return route.fulfill({ json: {
      key: '41-26', productionNo: '41-26', stage: 'new', deadline: '2026-12-15',
      orders: [{ customer: 'Городские парки', orderNo: '42/26', lines: [{ unassigned: true }, { unassigned: false }] }],
    } });
    if (url.pathname === '/api/work-tasks/' + workId) return route.fulfill({ json: {
      id: workId, code: 'W-77', title: 'Рама скамьи', status: 'work', productionNo: '41-26',
      stepIndex: 0, route: [{ name: 'Сварка' }, { name: 'Порошковая покраска' }],
    } });
    if (url.pathname === '/api/supply/requests/' + requestId) return route.fulfill({ json: {
      id: requestId, num: 176, title: 'Труба профильная 40×20', status: 'requested', qty: 24, unit: 'м', supplierName: 'Стальной прокат',
    } });
    if (url.pathname === '/api/showcase/' + productId) return route.fulfill({ json: { id: productId, sku: '4201', name: 'Скамья парковая' } });
    const extra = extras.find(row => url.pathname === '/api/showcase/' + row.id);
    if (extra) return route.fulfill({ json: extra });
    if (url.pathname === '/api/stock/items/' + blocked) return route.fulfill({ status: 403, json: { message: 'Чужая зона' } });
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto(base + '/app/#desk');
  await page.getByRole('heading', { name: 'Рабочий стол', exact: true }).waitFor();
  await page.getByRole('status').filter({ hasText: 'Сохранено' }).waitFor();
  return { page, context, err, requests, writes, stale() { conflict = true; }, current: () => layout };
}

const lane = (page, name) => page.getByRole('region', { name, exact: true });
const card = (scope, name) => scope.locator('article.desk-card').filter({ hasText: name });
const save = (page) => page.getByRole('status').filter({ hasText: 'Сохранено' }).waitFor();

test('Рабочий стол: карточка из истории, задача с датой, перенос, конфликт и повторное открытие', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser() });
  try {
    const t = await mount(browser);
    const { page } = t;
    const focus = lane(page, 'В фокусе');
    await card(focus, 'Заказ № 41-26').getByText(/Распределите 1 поз/).waitFor();
    await lane(page, 'Запланировано').getByText('Далее — Порошковая покраска').waitFor();
    await page.getByText('Карточка недоступна').waitFor();
    assert.equal(await page.getByText('Закрытая позиция только для другой зоны').count(), 0);
    assert(page.getByRole('link', { name: 'Сегодня', exact: true }));
    assert.equal(await page.getByRole('link', { name: 'Сегодня', exact: true }).count(), 1);
    const history = page.getByRole('complementary', { name: 'Недавние карточки' });
    await history.getByRole('button', { name: 'На стол: Скамья парковая' }).click();
    await card(focus, 'Скамья парковая').waitFor();
    await save(page);
    assert.equal(t.writes.length, 1);
    assert.equal(await history.getByRole('link', { name: 'Скамья парковая', exact: true }).count(), 0);
    const parkGrip = await card(focus, 'Скамья парковая').locator('.desk-grab').boundingBox();
    const recentBox = await history.boundingBox();
    await page.mouse.move(parkGrip.x + parkGrip.width / 2, parkGrip.y + parkGrip.height / 2);
    await page.mouse.down();
    await page.mouse.move(recentBox.x + 18, recentBox.y + 24, { steps: 12 });
    await page.mouse.up();
    await history.getByRole('link', { name: 'Скамья парковая', exact: true }).waitFor();
    assert.equal(await card(focus, 'Скамья парковая').count(), 0);
    await history.getByRole('button', { name: 'Убрать из недавних: Скамья парковая' }).click();
    await history.getByRole('link', { name: 'Скамья парковая', exact: true }).waitFor({ state: 'detached' });

    const order = card(focus, 'Заказ № 41-26');
    await order.getByRole('button', { name: '+ Задача', exact: true }).click();
    let modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await modal.getByText('Введите название задачи.').waitFor();
    await modal.getByRole('textbox', { name: 'Что сделать' }).fill('Уточнить цвет RAL у заказчика');
    await modal.getByLabel('Срок').fill('2026-12-02');
    t.stale();
    await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
    const agenda = page.getByRole('complementary', { name: 'Мои задачи' });
    await agenda.getByRole('button', { name: /Уточнить цвет RAL/ }).waitFor();
    await save(page);
    assert(t.current().items.some((item) => item.title === 'Подтвердить размеры вместе с монтажом'));
    assert.deepEqual(t.current().items.find((item) => item.of === 'salesorders').tasks.map(({ title, due, done }) => ({ title, due, done })),
      [{ title: 'Уточнить цвет RAL у заказчика', due: '2026-12-02', done: false }]);

    const work = card(lane(page, 'Запланировано'), 'Рама скамьи');
    const grip = await work.locator('.desk-grab').boundingBox();
    assert.ok(grip.width > 140);
    const drop = await lane(page, 'Жду').locator('.desk-lane-cards').boundingBox();
    await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
    await page.mouse.down();
    await page.mouse.move(drop.x + drop.width / 2, drop.y + drop.height - 8, { steps: 12 });
    await page.mouse.up();
    await card(lane(page, 'Жду'), 'Рама скамьи').waitFor();
    await save(page);

    await page.reload();
    await card(lane(page, 'Жду'), 'Рама скамьи').waitFor();
    await agenda.getByRole('button', { name: /Уточнить цвет RAL/ }).click();
    await order.getByRole('checkbox', { name: 'Готово: Уточнить цвет RAL у заказчика' }).click();
    await save(page);
    assert.equal(await agenda.getByRole('button', { name: /Уточнить цвет RAL/ }).count(), 0);
    const completed = t.current().items.find((item) => item.of === 'salesorders');
    assert.equal(completed.tasks[0].done, true);
    assert.equal(completed.done, true);
    await order.waitFor({ state: 'detached' });
    const tab = page.getByRole('button', { name: /^Завершённые/ });
    await tab.click();
    const archive = page.getByRole('region', { name: 'Завершённые', exact: true });
    await card(archive, 'Заказ № 41-26').getByRole('button', { name: 'Вернуть на стол' }).click();
    await order.waitFor();
    await save(page);
    await page.reload();
    await order.waitFor();
    assert.equal(t.current().items.find((item) => item.of === 'salesorders').done, false);
    await page.getByRole('button', { name: '+ Задача', exact: true }).first().click();
    modal = page.getByRole('dialog');
    await modal.getByRole('textbox', { name: 'Что сделать' }).fill('Запланировать звонок');
    await modal.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await card(focus, 'Запланировать звонок').waitFor();
    await save(page);
    await order.getByRole('link', { name: 'Заказ № 41-26' }).click();
    await page.locator('aside.drawer').last().waitFor();
    assert.equal(new URL(page.url()).hash.startsWith('#desk?'), true);
    assert.equal(await page.locator('[data-development-mode]').count(), 0);
    assert(!t.requests.includes('/app/development.json'));
    assert(!t.requests.includes('/api/today'));
    assert.deepEqual(t.err, []);
    await t.context.close();
  } finally { await browser.close(); }
});

test('Рабочий стол: пустой вход, роль и две темы без горизонтальной прокрутки', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser() });
  try {
    const limited = await mount(browser, { role: 'user', width: 1024 });
    const { page } = limited;
    await page.getByText('Согласовать покрытие для скамьи').first().waitFor();
    assert.equal(await page.getByText('Заказ № 41-26').count(), 0);
    assert.equal(limited.requests.some((path) => path.includes('/api/production-orders/') || path.includes('/api/work-tasks/')), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await limited.context.close();
    const fresh = await mount(browser, { filled: false });
    await lane(fresh.page, 'В фокусе').getByText('Нет карточек').waitFor();
    assert.equal(fresh.writes.length, 0);
    await fresh.context.close();

    const { page: many, context: recentContext } = await mount(browser, { recentExtra: 24 });
    const recent = many.getByRole('complementary', { name: 'Недавние карточки' });
    const show = recent.getByRole('button', { name: 'Показать все 18', exact: true });
    await show.waitFor();
    assert.equal(await recent.getByRole('link').count(), 6);
    await show.click();
    assert.equal(await recent.getByRole('link').count(), 18);
    await recent.getByRole('button', { name: 'Свернуть', exact: true }).click();
    assert.equal(await recent.getByRole('link').count(), 6);
    await recentContext.close();

    if (!process.env.C221_EVIDENCE) return;
    await mkdir(proof, { recursive: true });
    for (const [theme, width] of [['soft', 1920], ['dark', 2560]]) {
      const t = await mount(browser, { theme, width });
      await card(lane(t.page, 'В фокусе'), 'Заказ № 41-26').getByText(/Распределите 1 поз/).waitFor();
      await t.page.getByRole('complementary', { name: 'Недавние карточки' }).getByRole('link', { name: 'Скамья парковая' }).waitFor();
      assert.equal(await t.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const agenda = t.page.getByRole('complementary', { name: 'Мои задачи' });
      const fit = await agenda.locator('button').first().evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth);
      assert(fit);
      await t.page.screenshot({ path: new URL(theme + '-' + width + '.png', proof).pathname.replace(/^\/(\w:)/, '$1') });
      if (theme === 'dark') {
        await card(lane(t.page, 'В фокусе'), 'Согласовать покрытие для скамьи').getByRole('button', { name: 'Готово' }).click();
        await t.page.getByRole('button', { name: /^Завершённые/ }).click();
        await t.page.getByRole('region', { name: 'Завершённые', exact: true }).getByText('Согласовать покрытие для скамьи').waitFor();
        await t.page.screenshot({ path: new URL('archive-dark-2560.png', proof).pathname.replace(/^\/(\w:)/, '$1') });
      }
      await t.context.close();
    }
  } finally { await browser.close(); }
});


test('Организация стола: стопки, конкретные позиции и файлы, восстановление завершённой задачи', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser() });
  try {
    for (const theme of ['soft', 'dark']) {
      const t = await mount(browser, { theme });
      const { page } = t;
      const mainTask = 'Согласовать покрытие для скамьи';
      const modal = page.locator('.modal-back').last();
      const drawer = page.locator('aside.drawer');
      const laneMenu = (name) => lane(page, name).getByRole('button', { name: 'Действия со стопкой «' + name + '»' });
      async function capture(name) {
        if (!process.env.C232_EVIDENCE) return;
        await mkdir(proofC232, { recursive: true });
        await page.screenshot({ path: new URL(theme + '-' + name + '.png', proofC232).pathname.replace(/^\/(\w:)/, '$1') });
      }
      await page.getByRole('button', { name: '+ Стопка', exact: true }).click();
      await modal.getByLabel('Название стопки').fill('Для заказчика');
      await modal.getByRole('button', { name: 'Сохранить' }).click();
      await save(page);
      await laneMenu('Для заказчика').click();
      await page.getByRole('menuitem', { name: 'Переименовать' }).click();
      await modal.getByLabel('Название стопки').fill('На согласовании');
      await modal.getByRole('button', { name: 'Сохранить' }).click();
      await save(page);
      await card(lane(page, 'В фокусе'), mainTask).getByRole('button', { name: 'Действия с карточкой ' + mainTask }).click();
      await page.getByRole('menuitem', { name: 'Перенести в «На согласовании»' }).click();
      await card(lane(page, 'На согласовании'), mainTask).waitFor();
      await save(page);
      await capture('board');
      await laneMenu('На согласовании').click();
      await page.getByRole('menuitem', { name: 'Удалить стопку' }).click();
      await modal.getByLabel('Куда перенести карточки').selectOption('waiting');
      await modal.getByRole('button', { name: 'Перенести и удалить' }).click();
      await card(lane(page, 'Жду'), mainTask).waitFor();
      await save(page);
      assert.equal(await lane(page, 'На согласовании').count(), 0);
      await card(lane(page, 'Жду'), mainTask).getByRole('link', { name: mainTask }).click();
      await drawer.getByRole('heading', { name: mainTask }).waitFor();
      await drawer.getByRole('button', { name: '+ Карточка' }).click();
      await modal.getByRole('combobox', { name: 'Недавние карточки' }).selectOption('salesorders:41-26');
      await modal.getByRole('button', { name: 'Добавить', exact: true }).click();
      await drawer.getByRole('link', { name: 'Заказ № 41-26' }).waitFor();
      await drawer.getByRole('button', { name: '+ Карточка' }).click();
      await modal.getByRole('textbox', { name: 'Или ссылка на открытую карточку' }).fill(base + '/app/#salesorders?of=orders&open=' + positionId);
      await modal.getByRole('button', { name: 'Добавить', exact: true }).click();
      const linked = drawer.getByRole('link', { name: 'Скамья, позиция 4' });
      await linked.waitFor();
      assert.equal(await linked.getAttribute('href'), '#desk?of=orders&open=' + positionId);
      await drawer.locator('input[type=file]').setInputFiles({
        name: 'Дополнение.txt', mimeType: 'text/plain', buffer: Buffer.from('Приложение'),
      });
      await drawer.getByRole('button', { name: 'Скачать «Дополнение.txt»' }).waitFor();
      const download = page.waitForEvent('download');
      await drawer.getByRole('button', { name: 'Скачать «Дополнение.txt»' }).click();
      assert.equal((await download).suggestedFilename(), 'Дополнение.txt');
      await capture('task');
      await drawer.getByRole('button', { name: 'Завершить задачу' }).click();
      await drawer.getByText('Завершена').waitFor();
      await drawer.getByRole('button', { name: 'Ещё действия' }).click();
      await drawer.getByRole('menuitem', { name: 'Удалить задачу' }).click();
      await modal.getByRole('button', { name: 'Отмена' }).click();
      await drawer.getByRole('heading', { name: mainTask }).waitFor();
      assert(!t.current().items.find((item) => item.id === taskId).deletedAt);
      await drawer.getByRole('button', { name: 'Ещё действия' }).click();
      await drawer.getByRole('menuitem', { name: 'Удалить задачу' }).click();
      await modal.getByRole('button', { name: 'Удалить', exact: true }).click();
      await drawer.waitFor({ state: 'detached' });
      await save(page);
      assert(t.current().items.find((item) => item.id === taskId).deletedAt);
      await page.getByRole('button', { name: /^Корзина задач/ }).click();
      const trash = page.getByRole('region', { name: 'Корзина задач' });
      await trash.getByText(mainTask).waitFor();
      await capture('trash');
      await trash.getByRole('button', { name: 'Восстановить «' + mainTask + '»' }).click();
      await save(page);
      await page.getByRole('button', { name: /^Завершённые/ }).click();
      await page.getByRole('region', { name: 'Завершённые', exact: true }).getByRole('link', { name: mainTask }).click();
      await drawer.getByRole('link', { name: 'Скамья, позиция 4' }).waitFor();
      await drawer.getByRole('button', { name: 'Скачать «Дополнение.txt»' }).waitFor();
      await drawer.getByRole('link', { name: 'Скамья, позиция 4' }).click();
      await page.waitForURL(url => url.hash === '#desk?of=orders&open=' + positionId);
      await drawer.getByRole('heading', { name: /Скамья, позиция 4/ }).waitFor();
      assert.equal(await drawer.count(), 1);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(t.err, []);
      await t.context.close();
    }
  } finally { await browser.close(); }
});
