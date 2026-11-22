import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { findBrowser } from '../browser-path.mjs';

const origin = 'http://gantt.test';
const proof = process.env.GANTT_PROOF_DIR;
const app = new URL('../../backend/pwa/', import.meta.url);
const day = 86_400_000;
const date = (time) => new Date(time).toISOString().slice(0, 10);
const user = { id: 'manager', username: 'fixture', displayName: 'Проверка', role: 'manager' };
const people = [
  { id: 'anna', name: 'Анна Соколова', capacityHours: 8, workTypeIds: ['weld', 'cut'] },
  { id: 'boris', name: 'Борис Карпов', capacityHours: 8, workTypeIds: ['cut'] },
  { id: 'vera', name: 'Вера Мирова', capacityHours: 8, workTypeIds: ['weld'] },
];
const workTypes = [{ workTypeId: 'weld', name: 'Сварка', hue: 1 }, { workTypeId: 'cut', name: 'Резка', hue: 3 }];
const plus = (n) => date(Date.now() + n * day);
const isWorkday = (ms) => ![0, 6].includes(new Date(ms).getUTCDay());
function endAfterShift(oldStart, oldEnd, newStart) {
  let duration = 0;
  for (let ms = Date.parse(oldStart); ms <= Date.parse(oldEnd); ms += day) if (isWorkday(ms)) duration++;
  let ms = Date.parse(newStart);
  for (let left = Math.max(1, duration); left > 1;) {
    ms += day;
    if (isWorkday(ms)) left--;
  }
  return date(ms);
}
const sample = {
  planId: 'plan1', incomeId: 'item1', orderId: 'order1', orderNo: '24-17', productionNo: '24-20',
  productName: 'Навес из оцинкованной стали с боковыми панелями', partRowId: 'frame', partName: 'Рама',
  workTypeId: 'weld', workTypeName: 'Сварка', hue: 1, assigneeId: 'anna',
  start: plus(-2), end: plus(3), deadline: plus(-1), overdue: true, hours: 12, hoursPerUnit: 6, status: 'work',
};
const initialBars = () => [
  { ...sample, stepId: 'step1' },
  { ...sample, stepId: 'step2', partRowId: 'roof', partName: 'Крыша', workTypeId: 'cut', workTypeName: 'Резка', hue: 3, start: plus(1), end: plus(4), assigneeId: null, status: 'plan' },
  { ...sample, stepId: 'step3', planId: 'plan2', incomeId: 'item2', orderId: 'order2', orderNo: '24-68', productionNo: '', productName: 'Опора ограждения', workTypeId: 'cut', workTypeName: 'Резка', hue: 3, start: plus(3), end: plus(8), assigneeId: 'boris', overdue: false, inDesign: true, status: 'plan' },
  { ...sample, stepId: 'step4', planId: 'plan3', incomeId: 'item3', orderId: 'order3', orderNo: '24-78', productName: 'Стойка светильника', partRowId: null, partName: null, start: plus(0), end: plus(0), assigneeId: 'anna', status: 'done', overdue: false },
  { ...sample, stepId: 'task:old:0', taskId: 'old', stepIndex: 0, locked: true, incomeId: 'item4', orderId: 'order4', orderNo: '24-79', productName: 'Кронштейн', partRowId: null, partName: null, workTypeId: null, workTypeName: 'Изготовление', hue: null, start: plus(-3), end: plus(-3), assigneeId: 'anna', status: 'done', overdue: false },
];

async function fixture(viewport = { width: 1920, height: 1080 }, { theme = 'light', role = 'manager' } = {}) {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const page = await browser.newPage({ viewport, serviceWorkers: 'block' });
  page.setDefaultTimeout(5000);
  const bars = initialBars(), requests = [], writes = [], errors = [];
  const versions = new Map();
  const behavior = { failSchedule: false, withoutProduct: false, rejectNextMove: false };
  page.on('pageerror', (e) => errors.push(e.message));
  const account = { ...user, role };
  await page.addInitScript(({ account, theme }) => {
    localStorage.setItem('dca_access', 'fixture');
    localStorage.setItem('dca_refresh', 'fixture');
    localStorage.setItem('dca_user', JSON.stringify(account));
    localStorage.setItem('dc-theme', theme);
  }, { account, theme });
  await page.route(origin + '/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname.startsWith('/app/')) {
      const name = url.pathname.slice(5) || 'index.html';
      const type = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'text/javascript' : name.endsWith('.html') ? 'text/html' : name.endsWith('.svg') ? 'image/svg+xml' : undefined;
      try { return route.fulfill({ contentType: type, body: await readFile(new URL(name, app)) }); }
      catch (e) { if (e.code !== 'ENOENT') throw e; return route.fulfill({ status: 404, body: '' }); }
    }
    const path = url.pathname.slice(4), method = req.method();
    let reply = { items: [], total: 0, page: 1, limit: 50 };
    if (path === '/auth/me') reply = account;
    if (path === '/work-tasks/people') {
      const type = url.searchParams.get('workTypeId');
      reply = { items: people.filter((p) => !type || p.workTypeIds.includes(type)) };
    }
    if (path === '/work-tasks/old' || path === '/work-tasks/old/plan') {
      const bar = bars.find((b) => b.taskId === 'old');
      if (method === 'PATCH') {
        const body = req.postDataJSON();
        writes.push({ method, path, body });
        if (path.endsWith('/plan')) {
          bar.start = body.start;
          bar.end = date(Date.parse(body.start) + (body.days - 1) * day);
        } else bar.assigneeId = body.assigneeId;
      }
      reply = { id: 'old', code: 'W-9', title: 'Кронштейн', status: 'work', route: [], orderNo: '24-79' };
    }
    if (path.startsWith('/orderline-plans/by-income/')) reply = { productId: behavior.withoutProduct ? null : 'product1' };
    if (path.endsWith('/apply')) reply = { applied: 2 };
    if (path === '/work-schedule') {
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      requests.push({ from, to });
      if ((Date.parse(to) - Date.parse(from)) / day > 366) {
        return route.fulfill({ status: 400, json: { message: 'Период не длиннее года' } });
      }
      if (behavior.failSchedule) return route.fulfill({ status: 503, json: { message: 'Условный отказ' } });
      reply = {
        bars: bars.filter((b) => b.end >= url.searchParams.get('from') && b.start <= url.searchParams.get('to') && (!url.searchParams.has('personId') || b.assigneeId === url.searchParams.get('personId')) && (!url.searchParams.has('orderId') || b.orderId === url.searchParams.get('orderId')))
          .map((b) => b.taskId ? b : { ...b, rev: versions.get(b.planId) ?? 1 }),
        people, legend: workTypes,
        load: [{ personId: 'anna', hours: 12, date: plus(1) }, { personId: 'anna', hours: 7, date: plus(2) }],
      };
    }
    const step = /^\/orderline-plans\/[^/]+\/steps\/([^/]+)(\/mark)?$/.exec(path);
    if (step) {
      const b = bars.find((x) => x.stepId === step[1]), body = req.postDataJSON();
      const rev = versions.get(b.planId) ?? 1;
      writes.push({ method, body });
      if (behavior.rejectNextMove) { behavior.rejectNextMove = false; versions.set(b.planId, rev + 1); }
      if (body.rev != null && body.rev !== (versions.get(b.planId) ?? 1)) return route.fulfill({ status: 409, json: { message: 'План изменён' } });
      if (body.assigneeId && !people.find((p) => p.id === body.assigneeId)?.workTypeIds.includes(b.workTypeId)) return route.fulfill({ status: 400, json: { message: 'У сотрудника нет вида работ' } });
      if (step[2]) {
        if (body.what === 'start') b.startedAt = new Date().toISOString();
        else { b.startedAt ||= new Date().toISOString(); b.finishedAt = new Date().toISOString(); }
      } else {
        const end = body.start && !body.end ? endAfterShift(b.start, b.end, body.start) : b.end;
        const { rev: _rev, ...update } = body;
        Object.assign(b, { end, ...update });
      }
      versions.set(b.planId, rev + 1);
      reply = { bar: b, rev: rev + 1 };
    }
    return route.fulfill({ json: reply });
  });
  const open = async (hash = '#work?view=gantt') => {
    await page.goto(origin + '/app/' + hash);
    await page.locator('.k-planner').waitFor();
  };
  return { browser, page, bars, requests, writes, errors, behavior, open };
}

async function screenshot(page, name) {
  if (!proof) return;
  await mkdir(proof, { recursive: true });
  await page.screenshot({ path: join(proof, name), animations: 'disabled' });
}

test('Гант: период, масштаб, дерево, легенда и переходы из «Что горит»', async () => {
  const { browser, page, requests, open, errors } = await fixture();
  try {
    await open();
    const graph = page.locator('.k-planner');
    const button = (name) => page.getByRole('button', { name, exact: true });
    const row = (id) => graph.locator(`[data-row="${id}"]`);
    const scroller = graph.locator('.gt-scroll');
    await row('o:order1').waitFor();
    await button('Свернуть всё').click();
    assert.equal(await graph.locator('[data-bar]').count(), 0);
    await row('o:order1').getByRole('button').click();
    await row('i:item1').getByRole('button').click();
    assert.equal(await graph.locator('[data-bar]').count(), 0);
    await row('p:item1:frame').getByRole('button').click();
    await row('p:item1:roof').getByRole('button').click();
    await row('s:step1').getByText('Сварка', { exact: true }).first().waitFor();
    assert.equal(await graph.locator('[data-bar]').count(), 2);
    await button('Свернуть всё').click();
    await button('Раскрыть всё').click();
    assert.equal(await graph.locator('[data-bar]').count(), 5);
    await screenshot(page, '1920-orders-light.png');
    await button('Сварка').click();
    assert.equal(await button('Сварка').getAttribute('aria-pressed'), 'true');
    assert.equal(await graph.locator('[data-bar].hl-on').count(), 2);
    await button('Сварка').click();
    assert.equal(await button('Сварка').getAttribute('aria-pressed'), 'false');
    await button('Работа по позиции').click();
    assert.equal(await graph.locator('[data-bar].hl-on').getAttribute('data-bar'), 'task:old:0');
    await button('Работа по позиции').click();
    for (const scale of ['Неделя', 'Месяц', 'Обзор работ', 'День']) {
      await button(scale).click();
      await graph.locator('.gt-scroll').waitFor();
      assert.equal(await button(scale).getAttribute('aria-pressed'), 'true', scale);
    }
    const visibleX = () => scroller.evaluate((s) => s.querySelector('.gt-today').getBoundingClientRect().left - s.getBoundingClientRect().left);
    const earlier = requests.at(-1).from, initialX = await visibleX();
    const scheduleFrom = (response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/work-schedule' ? url.searchParams.get('from') : null;
    };
    const previousPeriod = page.waitForResponse((response) => {
      const from = scheduleFrom(response);
      return from && from !== earlier;
    });
    await button('←').click();
    await previousPeriod;
    await scroller.waitFor();
    assert.notEqual(requests.at(-1).from, earlier);
    assert.notEqual(await visibleX(), initialX, '«Раньше» сдвигает видимую шкалу, даже когда сегодня остаётся в загруженном периоде');
    const nextPeriod = page.waitForResponse((response) => scheduleFrom(response) === earlier);
    await button('→').click();
    await nextPeriod;
    await scroller.waitFor();
    await button('Сегодня').click();
    await graph.locator('.gt-today').waitFor();
    await button('Свернуть всё').click();
    await button('Без исполнителя: 1').click();
    await row('_none').waitFor();
    await graph.locator('[data-bar="step2"]').waitFor();
    await button('Просрочено: 2').click();
    await graph.locator('[data-bar="step1"]').waitFor();
    await button('В проектировании: 1').click();
    await graph.locator('[data-bar="step3"]').waitFor();
    await button('Перегружены: 1 чел.').click();
    await row('anna').locator('.gt-ttitle.over').waitFor();
    await graph.locator('[data-bar="step1"]').waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Гант: фильтры, правая панель шага, перенос и отмена', async () => {
  const { browser, page, bars, writes, behavior, open, errors } = await fixture();
  try {
    await open('#workschedule');
    const drawer = page.locator('.drawer');
    const graph = page.locator('.k-planner');
    const button = (name) => page.getByRole('button', { name, exact: true });
    const bar = (id) => graph.locator(`[data-bar="${id}"]`);
    await button('Фильтры').click();
    const side = page.locator('.list-side');
    await side.getByRole('tab', { name: /Заказ № 24-68/ }).click();
    await button('Фильтры · 1').waitFor();
    await bar('step3').waitFor();
    assert.equal(await bar('step1').count(), 0);
    assert.equal(await page.getByText('Перегружены: 1 чел.', { exact: true }).count(), 0);
    for (const [group, value, step] of [
      ['Позиция', /Навес из оцинкованной/, 'step1'], ['Часть', /Крыша/, 'step2'],
      ['Исполнитель', /Без исполнителя/, 'step2'], ['Вид работ', /Сварка/, 'step1'],
    ]) {
      await button('Сбросить фильтры').click();
      await side.getByRole('tablist', { name: group, exact: true }).getByRole('tab', { name: value }).click();
      await bar(step).waitFor();
      await button('Фильтры · 1').waitFor();
    }
    await button('Сбросить фильтры').click();
    await button('Фильтры').click();
    await button('Раскрыть всё').click();
    await bar('step1').click();
    await drawer.locator('select[name="assigneeId"]').waitFor();
    await screenshot(page, '1920-step-light.png');
    const assignee = drawer.locator('select').first();
    assert.equal(await assignee.locator('option[value="boris"]').count(), 0);
    await assignee.selectOption('__all');
    assert.equal(await assignee.locator('option[value="boris"]').count(), 1);
    await drawer.getByRole('button', { name: 'Начал', exact: true }).click();
    await drawer.getByRole('button', { name: 'Закончил', exact: true }).click();
    await drawer.getByText(/Закончен:.*:/).waitFor();
    const norm = drawer.getByRole('button', { name: 'Принять как норму' });
    behavior.withoutProduct = true;
    await norm.click();
    await page.getByText(/У позиции нет изделия/).waitFor();
    assert.equal(await norm.evaluate((el) => el.classList.contains('is-busy')), false);
    behavior.withoutProduct = false;
    await norm.click();
    await page.getByText(/Норма обновлена/).waitFor();
    await drawer.locator('input[type=date]').nth(1).fill(plus(-7));
    await drawer.getByRole('button', { name: 'Сохранить' }).click();
    await page.getByText('Конец раньше начала — поправьте даты').waitFor();
    await drawer.locator('input[type=date]').nth(1).fill(plus(4));
    await assignee.selectOption('vera');
    await drawer.getByRole('button', { name: 'Сохранить' }).click();
    await drawer.waitFor({ state: 'hidden' });
    assert.equal(bars[0].assigneeId, 'vera');
    assert.equal(writes.at(-1).body.rev, 3, 'сохранение использует rev после факта');
    await graph.locator('[data-bar="step1"][title*="Вера Мирова"]').waitFor();
    const original = bars[0].start;
    await bar('step1').press('ArrowRight');
    await page.getByText(/Шаг начнётся/).waitFor();
    assert.notEqual(bars[0].start, original);
    assert.ok(![0, 6].includes(new Date(bars[0].start).getUTCDay()));
    assert.equal(writes.at(-1).body.rev, 4, 'перенос использует rev из GET');
    assert.equal(writes.at(-1).body.end, undefined, 'длительность пересчитывает сервер');
    await button('Отменить').click();
    await page.getByText('Перенос отменён').waitFor();
    assert.equal(bars[0].start, original);
    assert.equal(writes.at(-1).body.rev, 5, 'отмена использует rev ответа переноса');
    await graph.locator(`[data-bar="step1"][title*="${original.split('-').reverse().join('.')}"]`).waitFor();
    behavior.rejectNextMove = true;
    await bar('step1').press('ArrowRight');
    await page.getByText(/План изменил другой человек/).waitFor();
    assert.equal(bars[0].start, original);
    await bar('task:old:0').click();
    await drawer.getByText(/W-9.*Кронштейн/).first().waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Гант ограничивает период на широком мониторе и заполняет шкалу загруженными днями', async () => {
  const { browser, page, open, requests, errors } = await fixture({ width: 3440, height: 1440 });
  try {
    await open();
    const chart = page.locator('.k-planner');
    const month = chart.getByRole('button', { name: 'Месяц', exact: true });
    await month.click();
    await month.waitFor();
    assert.equal(await month.getAttribute('aria-pressed'), 'true');
    await chart.getByRole('button', { name: 'Раскрыть всё' }).click();
    assert.equal(await chart.locator('[data-bar]').count(), 5);
    await screenshot(page, '3440-month.png');

    await open('#workschedule');
    assert.equal(await month.getAttribute('aria-pressed'), 'true');
    const { from, to } = requests.at(-1);
    const days = (Date.parse(to) - Date.parse(from)) / day + 1;
    assert.ok(days > 0 && days <= 366);
    const timeline = await chart.locator('.gt-scroll').evaluate(el => {
      const track = el.querySelector('.gt-head-track');
      const dayWidth = parseFloat(track.style.getPropertyValue('--gt-day'));
      return { days: track.getBoundingClientRect().width / dayWidth, occupied: track.offsetWidth + el.querySelector('.gt-head .gt-label').offsetWidth, available: el.clientWidth };
    });
    assert.ok(Math.abs(timeline.days - days) < 0.01, 'на шкале ровно загруженный период');
    assert.ok(timeline.occupied >= timeline.available, 'даты занимают всю ширину');
    await chart.getByRole('button', { name: '→', exact: true }).click();
    await month.waitFor();
    const next = requests.at(-1);
    assert.ok(next.from > from);
    assert.equal((Date.parse(next.to) - Date.parse(next.from)) / day + 1, days);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Обзор работ и масштабы сохраняют операции до сегодняшней даты', async () => {
  const { browser, page, bars, open, requests } = await fixture({ width: 2560, height: 1080 });
  try {
    for (const bar of bars) {
      bar.start = date(Date.parse(bar.start) - 34 * day);
      bar.end = date(Date.parse(bar.end) - 34 * day);
    }
    await open();
    const chart = page.locator('.k-planner');
    const button = (name) => chart.getByRole('button', { name, exact: true });
    assert.equal(await button('Обзор работ').getAttribute('aria-pressed'), 'true');
    await button('Раскрыть всё').click();
    const loaded = structuredClone(requests);
    for (const scale of ['Месяц', 'Обзор работ', 'День', 'Обзор работ']) {
      await button(scale).click();
      assert.equal(await chart.locator('[data-bar]').count(), 5);
      assert.deepEqual(requests, loaded, 'масштаб меняет вид загруженного периода');
      await chart.locator('[data-bar="step1"]').waitFor();
      await page.waitForFunction(() => {
        const bar = document.querySelector('[data-bar="step1"]').getBoundingClientRect();
        const scroller = document.querySelector('.gt-scroll');
        const left = scroller.getBoundingClientRect().left;
        return bar.right > left + scroller.querySelector('.gt-label').offsetWidth && bar.left < left + scroller.clientWidth;
      });
    }
    await button('Сегодня').click();
    await chart.locator('.gt-today').waitFor();
    assert.deepEqual(requests, loaded);
  } finally { await browser.close(); }
});

test('Гант показывает повтор при сбое и использует существующую дату вместо ошибочного адреса', async () => {
  const { browser, page, requests, behavior, errors } = await fixture();
  try {
    behavior.failSchedule = true;
    await page.goto(origin + '/app/#workschedule?from=2026-02-31');
    const retry = page.getByRole('button', { name: 'Повторить', exact: true });
    await retry.waitFor();
    assert.notEqual(requests[0].from, '2026-02-31');
    behavior.failSchedule = false;
    await retry.click();
    await page.locator('[data-row="o:order1"]').waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Поиск в «В работе» применён к полосам и сохраняет фильтр статуса списка', async () => {
  const { browser, page, open, requests, errors } = await fixture();
  try {
    await open('#work?view=gantt&status=done');
    const view = page.getByRole('group', { name: 'Вид', exact: true });
    const search = page.locator('.filter-tools').getByRole('textbox', { name: 'Поиск' });
    const chart = page.locator('.k-planner');
    await chart.locator('[data-row="o:order1"]').waitFor();
    assert.match(await search.getAttribute('placeholder'), /исполнитель/);
    assert.equal(await page.locator('.list-panel .chips').isVisible(), false);
    const calls = requests.length;
    await search.fill('соколова рама');
    await search.press('Enter');
    await chart.locator('[data-bar="step1"]').waitFor();
    assert.deepEqual(await chart.locator('[data-bar]').evaluateAll((nodes) => nodes.map((el) => el.dataset.bar)), ['step1']);
    assert.equal(requests.length, calls, 'поиск уточняет загруженный период');
    await search.fill('нет такой детали');
    await search.press('Enter');
    await chart.getByText('По этим фильтрам работ нет').waitFor();
    await page.getByRole('button', { name: 'Очистить поиск' }).click();
    await chart.locator('[data-row="o:order2"]').waitFor();
    await view.getByRole('button', { name: 'Список' }).click();
    assert.match(new URL(page.url()).hash, /status=done/);
    assert.match(await search.getAttribute('placeholder'), /W-12/);
    await page.locator('.list-panel .chips').waitFor();
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});

test('Витрина сохраняет стандартное поведение планировщика, наблюдатель видит сведения шага', async () => {
  const admin = await fixture({ width: 1024, height: 900 }, { role: 'admin' });
  try {
    const { page } = admin;
    await page.goto(origin + '/app/#kit');
    const chart = page.locator('.k-planner.tree').first();
    await chart.getByRole('button', { name: 'Обзор работ', exact: true }).click();
    await chart.getByRole('button', { name: 'Сегодня', exact: true }).click();
    await chart.getByRole('button', { name: 'Раскрыть всё', exact: true }).click();
    assert.equal(await chart.locator('[data-bar]').count(), 4);
    await chart.getByRole('button', { name: 'Сварка', exact: true }).click();
    assert.equal(await chart.locator('[data-bar].hl-on').count(), 1);
    assert.deepEqual(admin.errors, []);
  } finally { await admin.browser.close(); }
  const observer = await fixture({ width: 1024, height: 900 }, { role: 'user', theme: 'dark' });
  try {
    const { page } = observer;
    await observer.open('#workschedule?incomeId=item1');
    const bar = page.locator('[data-bar="step1"]');
    assert.equal(await bar.evaluate((el) => el.classList.contains('drag')), false);
    await bar.press('Enter');
    const drawer = page.locator('.drawer');
    await drawer.getByText('Анна Соколова', { exact: true }).waitFor();
    await drawer.getByText('Начало по плану', { exact: true }).waitFor();
    await screenshot(page, '1024-step-dark.png');
    assert.equal(await drawer.getByRole('button', { name: 'Сохранить' }).count(), 0);
    assert.deepEqual(observer.errors, []);
  } finally { await observer.browser.close(); }
});

test('Перенос сохраняет даты при назначении, старое задание делает один запрос с отменой', async () => {
  const { browser, page, bars, writes, open, errors } = await fixture({ width: 2560, height: 1080 }, { theme: 'dark' });
  try {
    const old = bars.find((b) => b.taskId === 'old');
    old.locked = false;
    old.status = 'work';
    await open();
    const chart = page.locator('.k-planner');
    await chart.getByRole('button', { name: 'По людям' }).click();
    await chart.getByRole('button', { name: 'Раскрыть всё' }).click();
    const bar = chart.locator('[data-bar="step1"]');
    const original = bars[0].start;
    const dragTo = async (person, source = bar, offset = 0) => {
      const b = await source.boundingBox();
      const row = await chart.locator(`[data-row="${person}"] .gt-track`).boundingBox();
      assert.ok(b && row);
      const x = b.x + b.width / 2;
      await page.mouse.move(x, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(x + offset, row.y + row.height / 2, { steps: 8 });
      await page.mouse.up();
    };
    await screenshot(page, '2560-people-dark.png');
    await dragTo('boris');
    await page.getByText('У сотрудника нет вида работ', { exact: false }).first().waitFor();
    assert.equal(bars[0].assigneeId, 'anna');
    await bar.waitFor();
    await dragTo('vera', bar, 72);
    await page.getByText('Шаг передан другому исполнителю').waitFor();
    assert.equal(bars[0].assigneeId, 'vera');
    assert.equal(bars[0].start, original);
    assert.deepEqual(writes.at(-1).body, { assigneeId: 'vera', rev: 1 });
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await page.getByText('Перенос отменён').waitFor();
    assert.equal(bars[0].assigneeId, 'anna');
    await chart.locator('[data-row="ps:anna:step1"] [data-bar="step1"]').waitFor();
    const legacy = chart.locator('[data-bar="task:old:0"]');
    await legacy.waitFor();
    const count = writes.length, start = old.start;
    await dragTo('vera', legacy, 72);
    await page.getByText('Задание передано другому исполнителю').waitFor();
    assert.deepEqual(writes.slice(count), [{ method: 'PATCH', path: '/work-tasks/old', body: { assigneeId: 'vera' } }]);
    assert.equal(old.start, start);
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[data-row="pi:anna:item4"] [data-bar="task:old:0"]'));
    assert.deepEqual(writes.at(-1), { method: 'PATCH', path: '/work-tasks/old', body: { assigneeId: 'anna' } });
    const beforeShift = writes.length;
    await legacy.press('ArrowRight');
    await page.getByText(/Шаг начнётся/).waitFor();
    assert.deepEqual(writes.slice(beforeShift), [{ method: 'PATCH', path: '/work-tasks/old/plan', body: { stepIndex: 0, start: date(Date.parse(start) + day), days: 1 } }]);
    assert.equal(old.assigneeId, 'anna');
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
