import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const require = createRequire(import.meta.url);
const app = new URL('../../backend/pwa/', import.meta.url);
const origin = 'http://127.0.0.1:41737';
const id = (n) => String(n).padStart(24, '0');
const order = { orderId: id(41), productionNo: '41-26', customer: 'Городские парки' };
const closedOrder = { orderId: id(42), productionNo: '42-26', customer: 'Северный парк' };
const otherOrder = { orderId: id(43), productionNo: '43-26', customer: 'Зелёный берег' };
const incomingOrder = { orderId: id(44), productionNo: '44-26', customer: 'Озёрный сквер' };
const orders = [order, closedOrder, otherOrder, incomingOrder];
const assignee = { id: id(50), name: 'Анна Волкова', initials: 'АВ' };
const taskRow = (n, order, status, name) => ({ ...order, id: id(n + 100), incomeId: id(n), title: name, productName: name, code: `D-${n}`, status, seqNo: 4, qty: 1, assignee: status === 'queue' ? null : assignee });
const jobs = [
  { ...taskRow(5, order, 'work', 'Стенка для лазания'), openQuestions: 1 },
  taskRow(6, order, 'done', 'Песочница'), taskRow(7, closedOrder, 'cancelled', 'Снятая горка'), taskRow(8, otherOrder, 'queue', 'Качели'),
  { ...taskRow(9, otherOrder, 'paused', 'Арка'), pauseReason: 'Ждём эскиз', assignee: null },
];
const line = (n, o, title, sku) => ({ orderId: o.orderId, incomeId: id(n), lineNo: n, title, qty: 2, unit: 'шт', sku });
const lines = [line(1, order, 'Скамья со спинкой', 'С-210'), line(2, order, 'Велопарковка', 'В-56'), line(3, order, 'Урна с металлическим вкладышем и креплением для общественного пространства', 'У-37'), line(12, incomingOrder, 'Ограждение'), ...jobs.map((job, i) => line(i + 5, job, job.productName))];
const evidence = process.env.C210_EVIDENCE;
const compactEvidence = process.env.C217_EVIDENCE;
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

async function mount(browser, { role = 'manager', theme = 'light', width = 1920, development = false, requests = 0, legacy = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  const user = { id: 'fixture', username: 'Учебная учётная запись', role };
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [], tasks = jobs.map((t) => ({ ...t })), writes = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.addInitScript(({ user, theme }) => {
    localStorage.setItem('dc-theme', theme);
    sessionStorage.setItem('dca_access', 'fixture');
    sessionStorage.setItem('dca_refresh', 'fixture');
    sessionStorage.setItem('dca_user', JSON.stringify(user));
  }, { user, theme });
  const orderLines = (o) => lines.filter((line) => line.orderId === o.orderId).map((line) => ({ ...line, task: tasks.find((task) => task.incomeId === line.incomeId) || null }));
  await page.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (development && url.pathname === '/app/development.json') return route.fulfill({ json: {
      mode: 'development', origin, code: { builtAt: '2026-11-22T08:20:00Z' },
      data: { snapshotAt: '2026-11-22T06:00:00Z', backup: 'datacore-2026-11-22_060000.tgz', restoredAt: '2026-11-22T08:10:00Z' },
    } });
    if (url.pathname.startsWith('/app/')) {
      const name = url.pathname.slice('/app/'.length) || 'index.html';
      try { return route.fulfill({ contentType: mime[extname(name)] || 'application/octet-stream', body: await readFile(new URL(name, app)) }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; return route.fulfill({ status: 404 }); }
    }
    if (url.pathname === '/api/auth/me') return route.fulfill({ json: user });
    if (url.pathname === '/api/product-requests/count') return route.fulfill({ json: { open: requests } });
    if (url.pathname === '/api/dicts/persons') return route.fulfill({ json: { items: [assignee] } });
    if (url.pathname === '/api/design-board') {
      const entries = orders.map((o) => {
        const positions = orderLines(o);
        const counts = {};
        for (const position of positions) { const key = position.task?.status || 'free'; counts[key] = (counts[key] || 0) + 1; }
        if (legacy && o === incomingOrder) return { ...o, lines: positions };
        return { ...o, counts: { free: 0, ...counts }, linesCount: positions.length };
      });
      return route.fulfill({ json: { orders: entries, tasks: tasks.filter((t) => ['queue', 'work', 'paused'].includes(t.status)) } });
    }
    if (/^\/api\/design-board\/\d+\/lines$/.test(url.pathname)) return route.fulfill({ json: { lines: orderLines({ orderId: url.pathname.split('/')[3] }) } });
    if (url.pathname === '/api/design-tasks' && request.method() === 'GET') {
      const status = url.searchParams.get('status');
      const orderId = url.searchParams.get('orderId');
      const needsAnswer = url.searchParams.get('needsAnswer');
      const items = tasks.filter((t) => (!status || status.split(',').includes(t.status)) && (!orderId || orderId === t.orderId) && (!needsAnswer || t.openQuestions));
      return route.fulfill({ json: { items, total: items.length } });
    }
    const task = tasks.find((t) => `/api/design-tasks/${t.id}` === url.pathname);
    if (task && request.method() === 'GET') return route.fulfill({ json: task });
    if (role === 'manager' && url.pathname === '/api/design-tasks' && request.method() === 'POST') {
      const body = request.postDataJSON();
      writes.push({ method: 'POST', body });
      const position = lines.find((l) => l.incomeId === body.incomeId);
      const owner = orders.find((o) => o.orderId === position.orderId);
      const saved = taskRow(Number(body.incomeId), owner, body.status, position.title);
      saved.pauseReason = body.pauseReason;
      saved.assigneeId = body.assigneeId;
      tasks.push(saved);
      return route.fulfill({ status: 201, json: saved });
    }
    if (role === 'manager' && task && request.method() === 'PATCH') {
      const body = request.postDataJSON();
      writes.push({ method: 'PATCH', body });
      Object.assign(task, body);
      if (body.status !== 'paused' && body.status !== 'cancelled') delete task.pauseReason;
      return route.fulfill({ json: task });
    }
    return route.fulfill({ json: { items: [], total: 0 } });
  });
  await page.goto(origin + '/app/#design');
  await page.getByRole('button', { name: 'Открыть заказ № 41-26 в проектировании' }).waitFor();
  return { page, context, writes, errors };
}

const side = (page) => page.getByRole('complementary', { name: 'Заказы в проектировании' });
const leftOrder = (page) => side(page).locator('.design-side-order').filter({ hasText: order.customer });
const disclosure = (page) => leftOrder(page).getByRole('button', { name: /^Изделия/ });
const activeCol = (page, key) => page.locator(`.design-board > .col[data-key="${key}"]`);
const statusPanel = (page) => page.locator('.design-status-panel');
const statusTab = (page, name) => page.getByRole('group', { name: 'Дополнительные статусы задач' }).getByRole('button', { name, exact: true });
const taskCard = (scope, name) => scope.getByRole('group', { name: `Открыть: ${name}` });
const dialog = (page, name) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name }) });

async function drag(page, source, target, { cancel = false, highlight = false } = {}) {
  await Promise.all([source.waitFor(), target.waitFor()]);
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox(), to = await target.boundingBox();
  assert.ok(from && to);
  const x = to.x + to.width / 2, y = to.y + Math.min(220, to.height - 8);
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 12 });
  if (highlight) {
    await target.locator('xpath=self::*[contains(concat(" ", normalize-space(@class), " "), " drop ")]').waitFor();
    const ghost = page.locator('body > .drag-ghost');
    await ghost.waitFor();
    assert.equal(await ghost.evaluate((node) => getComputedStyle(node).getPropertyValue('--drag-rotation').trim()), '0deg');
  }
  if (cancel) await page.keyboard.press('Escape');
  await page.mouse.up();
  await page.locator('body > .drag-ghost').waitFor({ state: 'detached' });
}

test('Доска проектирования: позиции, перенос, архив, фильтры и закрытие карточек', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  if (evidence) await mkdir(evidence, { recursive: true });
  try {
    const { page, context, writes, errors } = await mount(browser);
    try {
      assert.deepEqual(await page.locator('.design-board > .col').evaluateAll((cols) => cols.map((col) => col.dataset.key)), ['queue', 'work']);
      assert.equal(await side(page).getByText(closedOrder.customer, { exact: true }).count(), 0);
      const footer = leftOrder(page).locator('.design-order-footer');
      assert.equal((await disclosure(page).boundingBox()).width, (await footer.boundingBox()).width);
      assert.ok(await disclosure(page).locator('.design-order-chevron').evaluate((node) => node.getBoundingClientRect().left > node.parentElement.getBoundingClientRect().right - 30));
      await disclosure(page).focus();
      await page.keyboard.press('Enter');
      const done = leftOrder(page).getByRole('listitem').filter({ hasText: 'Песочница' });
      await done.getByText('Завершено', { exact: true }).waitFor();
      assert.equal(await disclosure(page).getAttribute('aria-expanded'), 'true');
      assert.equal(await disclosure(page).evaluate((node) => document.activeElement === node), true);
      await page.keyboard.press('Enter');
      assert.equal(await disclosure(page).getAttribute('aria-expanded'), 'false');
      await page.keyboard.press('Enter');
      await done.waitFor();
      assert.equal(await done.locator('.design-side-grip').count(), 0);
      const free = leftOrder(page).getByRole('listitem').filter({ hasText: 'Скамья со спинкой' });
      const grip = free.locator('.design-side-grip');
      assert.equal(await grip.evaluate((node) => getComputedStyle(node).cursor), 'grab');
      assert.ok((await free.boundingBox()).x - (await leftOrder(page).boundingBox()).x >= 24);
      await free.getByText('Ещё не взято').waitFor();
      if (evidence) await page.screenshot({ path: join(evidence, 'positions-1920-light.png') });

      await leftOrder(page).getByText(order.customer, { exact: true }).click();
      const drawer = page.locator('.drawer');
      await drawer.getByRole('heading', { name: /41-26/ }).waitFor();
      await leftOrder(page).getByRole('button', { name: 'Песочница', exact: true }).click();
      await drawer.getByRole('heading', { name: /Песочница/ }).waitFor();
      await leftOrder(page).getByRole('button', { name: /Открыть заказ/ }).click();
      await drawer.getByRole('heading', { name: /41-26/ }).waitFor();
      await drawer.getByRole('button', { name: 'Закрыть', exact: true }).click();
      await drawer.waitFor({ state: 'detached' });
      await page.waitForURL(url => url.hash === '#design');

      assert.equal(await side(page).getByRole('button', { name: /Закрытые/ }).count(), 0);
      assert.equal(await side(page).getByText(otherOrder.customer, { exact: true }).count(), 0);
      await side(page).getByText(incomingOrder.customer, { exact: true }).waitFor();
      await leftOrder(page).getByRole('button', { name: /Действия с заказом/ }).click();
      await page.getByRole('menuitem', { name: 'Показать только этот заказ' }).click();
      await page.waitForURL(url => url.hash.includes('designOrder='));
      await side(page).getByText(incomingOrder.customer, { exact: true }).waitFor({ state: 'detached' });
      await activeCol(page, 'queue').getByText('Качели', { exact: true }).waitFor({ state: 'detached' });
      await leftOrder(page).getByRole('button', { name: /Действия с заказом/ }).click();
      await page.getByRole('menuitem', { name: 'Сбросить: показать все заказы' }).click();
      await activeCol(page, 'queue').getByText('Качели', { exact: true }).waitFor();

      const doneTab = statusTab(page, 'Завершены');
      await doneTab.focus();
      await page.keyboard.press('Space');
      await statusPanel(page).getByText('Песочница', { exact: true }).waitFor();
      assert.equal(await doneTab.getAttribute('aria-expanded'), 'true');
      await page.keyboard.press('Space');
      await statusPanel(page).waitFor({ state: 'hidden' });
      await doneTab.click();
      const cancelledTab = statusTab(page, 'Отменены');
      await cancelledTab.click();
      await statusPanel(page).getByText('Снятая горка', { exact: true }).waitFor();
      assert.equal(await doneTab.getAttribute('aria-expanded'), 'false');
      await drag(page, grip, statusPanel(page));
      assert.deepEqual(writes, []);
      await cancelledTab.focus();
      await page.keyboard.press('Escape');
      await statusPanel(page).waitFor({ state: 'hidden' });
      assert.equal(await cancelledTab.evaluate((node) => document.activeElement === node), true);

      await drag(page, grip, activeCol(page, 'queue'), { cancel: true, highlight: true });
      assert.deepEqual(writes, []);
      await drag(page, grip, activeCol(page, 'queue'), { highlight: true });
      await activeCol(page, 'queue').getByText('Скамья со спинкой', { exact: true }).waitFor();
      await free.getByText('На распределении').waitFor();
      assert.equal(await free.locator('.design-side-grip').count(), 0);
      assert.deepEqual(writes, [{ method: 'POST', body: { incomeId: id(1), status: 'queue' } }]);

      const secondGrip = leftOrder(page).getByRole('listitem').filter({ hasText: 'Велопарковка' }).locator('.design-side-grip');
      await drag(page, secondGrip, activeCol(page, 'work'), { highlight: true });
      const assign = dialog(page, 'Кто проектирует?');
      await assign.waitFor();
      await assign.getByRole('button', { name: 'Назначить и взять в работу' }).click();
      await assign.getByText('Выберите исполнителя.', { exact: true }).waitFor();
      assert.equal(writes.length, 1);
      await assign.getByRole('button', { name: 'Отмена', exact: true }).click();
      await assign.waitFor({ state: 'hidden' });
      await secondGrip.waitFor();
      await drag(page, secondGrip, activeCol(page, 'work'), { highlight: true });
      await assign.getByLabel('Исполнитель').selectOption({ label: assignee.name });
      await assign.getByRole('button', { name: 'Назначить и взять в работу' }).click();
      await activeCol(page, 'work').getByText('Велопарковка', { exact: true }).waitFor();
      assert.deepEqual(writes.at(-1), { method: 'POST', body: { incomeId: id(2), status: 'work', assigneeId: assignee.id } });
      await doneTab.click();
      await taskCard(statusPanel(page), 'Песочница').getByRole('button', { name: 'Действия' }).click();
      await page.getByRole('menuitem', { name: 'Перенести: На распределении' }).click();
      await activeCol(page, 'queue').getByText('Песочница', { exact: true }).waitFor();
      await statusPanel(page).getByText('Песочница', { exact: true }).waitFor({ state: 'detached' });
      assert.deepEqual(writes.at(-1), { method: 'PATCH', body: { status: 'queue' } });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }

    for (const config of [{ width: 2560, theme: 'dark' }, { width: 1024, theme: 'soft', role: 'user' }]) {
      const { page, context, errors } = await mount(browser, config);
      try {
        await disclosure(page).click();
        await leftOrder(page).getByText('Завершено').waitFor();
        const doneTab = statusTab(page, 'Завершены');
        await doneTab.click();
        await statusPanel(page).getByText('Песочница', { exact: true }).waitFor();
        const railBox = await doneTab.boundingBox(), panelBox = await statusPanel(page).boundingBox();
        assert.ok(Math.abs(panelBox.x + panelBox.width - railBox.x) <= 1 && railBox.x + railBox.width <= config.width);
        const boardPage = page.locator('.design-board-layout');
        const bounds = await boardPage.evaluate((node) => ({ width: innerWidth, doc: document.documentElement.scrollWidth, board: node.getBoundingClientRect().right }));
        assert.ok(bounds.doc <= bounds.width && bounds.board <= bounds.width, JSON.stringify(bounds));
        assert.equal(await leftOrder(page).locator('.design-side-grip').count(), config.role === 'user' ? 0 : 3);
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const violations = await boardPage.evaluate(async (node) => (await axe.run(node, { runOnly: ['aria-valid-attr-value', 'button-name', 'nested-interactive'] })).violations);
        assert.deepEqual(violations, []);
        if (evidence) await page.screenshot({ path: join(evidence, `archive-${config.width}-${config.theme}.png`) });
        if (compactEvidence && config.theme === 'dark') {
          await statusTab(page, 'Приостановлены').click();
          await statusPanel(page).getByText('Арка', { exact: true }).waitFor();
          await page.screenshot({ path: join(compactEvidence, 'queue-2560-dark.png') });
        }
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
});

test('Компактная шапка и боковая панель паузы: положение вкладки и перенос в обе стороны', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  if (compactEvidence) await mkdir(compactEvidence, { recursive: true });
  try {
    const { page, context, writes, errors } = await mount(browser, { width: 2560, theme: 'soft', development: true });
    try {
      const tools = page.locator('.filter-tools');
      const questions = tools.getByRole('button', { name: 'Есть вопрос без ответа', exact: true });
      const filters = tools.getByRole('button', { name: 'Фильтры', exact: true });
      const search = tools.locator('input');
      await questions.waitFor();
      const centers = await Promise.all([filters, search, questions].map(async (item) => { const { y, height } = await item.boundingBox(); return y + height / 2; }));
      assert.ok(Math.max(...centers) - Math.min(...centers) < 2);
      assert.equal(await page.getByRole('tablist', { name: 'Раздел проектирования' }).count(), 0);
      assert.equal(await page.locator('.list-panel.compact').isVisible(), false);
      const banner = page.locator('.main > [data-development-mode]');
      await banner.getByText(/Разработка · копия данных/).waitFor();
      await banner.getByText(/Архив datacore-/).waitFor();
      const statusTitle = await banner.locator('.ntf-title').boundingBox(), statusSub = await banner.locator('.ntf-sub').boundingBox();
      assert.ok(Math.abs(statusTitle.y - statusSub.y) < 5);

      await filters.click();
      await page.getByRole('complementary', { name: 'Фильтры' }).waitFor();
      await page.keyboard.press('Escape');
      await questions.click();
      await page.waitForURL((url) => url.hash.includes('needsAnswer=1'));
      await taskCard(activeCol(page, 'queue'), 'Качели').waitFor({ state: 'detached' });
      await taskCard(activeCol(page, 'work'), 'Стенка для лазания').waitFor();
      await tools.getByRole('button', { name: 'Все', exact: true }).click();
      await taskCard(activeCol(page, 'queue'), 'Качели').waitFor();
      await search.fill(otherOrder.customer);
      await side(page).getByText('Заказы по этому фильтру не найдены.').waitFor();
      await search.fill('');
      await side(page).getByText(order.customer, { exact: true }).waitFor();

      const pausing = statusTab(page, 'Приостановлены');
      const orderOfTabs = page.getByRole('group', { name: 'Дополнительные статусы задач' }).getByRole('button');
      assert.deepEqual(await orderOfTabs.allTextContents(), ['Завершены', 'Отменены', 'Приостановлены']);
      const before = await pausing.boundingBox();
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      const pressed = await pausing.evaluate((node) => {
        const style = getComputedStyle(node);
        return { rotate: style.rotate, transform: style.transform, duration: style.transitionDuration, shadow: style.boxShadow };
      });
      assert.deepEqual(await pausing.boundingBox(), before);
      assert.equal(pressed.rotate, '180deg');
      assert.equal(pressed.transform, 'none');
      assert.equal(pressed.duration, '0s');
      assert.match(pressed.shadow, /inset/);
      await page.mouse.up();
      const panel = statusPanel(page);
      const pauseCol = panel.getByRole('region', { name: 'Приостановлены', exact: true });
      await pauseCol.getByText(/Ждём эскиз/).waitFor();
      assert.deepEqual(await pausing.boundingBox(), before);
      const panelBox = await panel.boundingBox();
      assert.ok(Math.abs(panelBox.x + panelBox.width - before.x) <= 1 && panelBox.y + panelBox.height >= before.y + before.height);
      const palette = (node) => {
        const { backgroundColor, borderTopColor } = getComputedStyle(node);
        return { backgroundColor, borderTopColor };
      };
      const tabPalette = await pausing.evaluate(palette);
      assert.deepEqual(await panel.evaluate(palette), tabPalette);
      assert.notEqual((await statusTab(page, 'Завершены').evaluate(palette)).backgroundColor, tabPalette.backgroundColor);
      if (compactEvidence) await page.screenshot({ path: join(compactEvidence, 'pause-2560-soft.png') });

      const working = taskCard(activeCol(page, 'work'), 'Стенка для лазания');
      await drag(page, working, pauseCol, { highlight: true });
      const reason = dialog(page, 'Приостановить задачу');
      await reason.getByRole('button', { name: 'Приостановить', exact: true }).click();
      await reason.getByText('Впишите причину паузы.', { exact: true }).waitFor();
      await reason.getByRole('button', { name: 'Отмена', exact: true }).click();
      await reason.waitFor({ state: 'hidden' });
      assert.deepEqual(writes, []);

      await drag(page, working, pauseCol, { highlight: true });
      await reason.getByLabel('Причина паузы').fill('Уточняем размеры');
      await reason.getByRole('button', { name: 'Приостановить', exact: true }).click();
      await pauseCol.getByText(/Уточняем размеры/).waitFor();
      await working.waitFor({ state: 'detached' });
      assert.deepEqual(writes, [{ method: 'PATCH', body: { status: 'paused', pauseReason: 'Уточняем размеры' } }]);

      await drag(page, taskCard(pauseCol, 'Арка'), activeCol(page, 'work'), { highlight: true });
      const assign = dialog(page, 'Кто проектирует?');
      await assign.getByLabel('Исполнитель').selectOption({ label: assignee.name });
      await assign.getByRole('button', { name: 'Назначить и взять в работу' }).click();
      await taskCard(activeCol(page, 'work'), 'Арка').waitFor();
      await taskCard(pauseCol, 'Арка').waitFor({ state: 'detached' });
      assert.deepEqual(writes.at(-1), { method: 'PATCH', body: { status: 'work', assigneeId: assignee.id } });

      await disclosure(page).click();
      const grip = leftOrder(page).getByRole('listitem').filter({ hasText: 'Скамья со спинкой' }).locator('.design-side-grip');
      await drag(page, grip, pauseCol, { highlight: true });
      await reason.getByLabel('Причина паузы').fill('Ждём поставку');
      await reason.getByRole('button', { name: 'Приостановить', exact: true }).click();
      await taskCard(pauseCol, 'Скамья со спинкой').getByText(/Ждём поставку/).waitFor();
      assert.deepEqual(writes.at(-1), { method: 'POST', body: { incomeId: id(1), status: 'paused', pauseReason: 'Ждём поставку' } });

      await statusTab(page, 'Завершены').click();
      const completed = taskCard(panel, 'Песочница');
      await completed.waitFor();
      await drag(page, completed, activeCol(page, 'queue'));
      await drag(page, taskCard(activeCol(page, 'work'), 'Арка'), panel.getByRole('region', { name: 'Завершены', exact: true }));
      assert.equal(writes.length, 3);
      await pausing.click();
      await pauseCol.waitFor();
      await pausing.click();
      await panel.waitFor({ state: 'hidden' });
      await taskCard(activeCol(page, 'work'), 'Арка').getByRole('button', { name: 'Действия' }).click();
      await page.getByRole('menuitem', { name: 'Перенести: Приостановлены' }).click();
      await reason.getByRole('button', { name: 'Отмена', exact: true }).click();
      await reason.waitFor({ state: 'hidden' });
      assert.equal(writes.length, 3);

      const lastOrder = side(page).locator('.design-side-order').filter({ hasText: incomingOrder.customer });
      await lastOrder.getByRole('button', { name: /^Изделия/ }).click();
      await drag(page, lastOrder.locator('.design-side-grip'), activeCol(page, 'queue'), { highlight: true });
      await taskCard(activeCol(page, 'queue'), 'Ограждение').waitFor();
      await lastOrder.waitFor({ state: 'detached' });
      assert.deepEqual(writes.at(-1), { method: 'POST', body: { incomeId: id(12), status: 'queue' } });
      assert.deepEqual(errors, []);
    } finally { await context.close(); }

    const withRequests = await mount(browser, { requests: 1, legacy: true });
    try {
      const { page } = withRequests;
      await side(page).getByText(incomingOrder.customer, { exact: true }).waitFor();
      const tabs = page.getByRole('tablist', { name: 'Раздел проектирования' });
      await tabs.getByRole('tab', { name: 'Заявки на создание изделия (1)' }).click();
      await page.locator('.design-board-layout').waitFor({ state: 'hidden' });
      await tabs.getByRole('tab', { name: 'Задачи', exact: true }).click();
      await page.locator('.design-board-layout').waitFor();
      await page.getByRole('button', { name: 'Таблица', exact: true }).click();
      await page.locator('.list-panel .chips').getByRole('button', { name: 'Есть вопрос без ответа', exact: true }).waitFor();
      assert.equal(await page.locator('.filter-tools > .chips').count(), 0);
    } finally { await withRequests.context.close(); }
  } finally { await browser.close(); }
});
