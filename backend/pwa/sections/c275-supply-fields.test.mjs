import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import test, { after, before } from 'node:test';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';

const origin = 'http://c275.test';
const app = new URL('../', import.meta.url);
const invoicePath = '/api/supply/invoices/c275-invoice';
const requestPath = '/api/supply/requests';
const requestCardPath = requestPath + '/c275-request';
const restoreNotePath = requestCardPath + '/restore-note';
const restoreDeliveryPath = requestCardPath + '/restore-delivery-note';
const manager = { id: 'c275-manager', role: 'manager', displayName: 'Менеджер снабжения', sections: ['requests'], canMoney: false };
const mime = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
};

let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, theme, { initialRequest, history = [], canMoney = false, role = 'manager', width = 1440, otherDeliveries = [] } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block', reducedMotion: 'reduce' });
  t.after(() => page.close());
  page.setDefaultTimeout(6000);
  const writes = [], errors = [], declined = [];
  const user = { ...manager, canMoney, role };
  const audit = [...history];
  let request = initialRequest && { id: 'c275-request', num: 275, status: 'requested', ...initialRequest };
  let invoice = {
    id: 'c275-invoice', status: 'issued', no: 'C275', date: '2026-11-20T00:00:00.000Z', supplierName: 'Учебный поставщик',
    deliveryDate: '2026-11-28T00:00:00.000Z', note: 'Привезти до обеда', requests: [], fileIds: [],
  };
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ manager, theme }) => {
    localStorage.setItem('dc-theme', theme);
    localStorage.setItem('dca_user', JSON.stringify(manager));
    localStorage.setItem('dca_access', 'synthetic');
    localStorage.setItem('dca_refresh', 'synthetic');
  }, { manager: user, theme });
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), method = req.method();
    if (url.origin !== origin) return route.abort();
    const path = url.pathname;
    if (path.startsWith('/app/')) {
      const file = path.slice(5) || 'index.html';
      if (file.includes('..')) return route.abort();
      try { return await route.fulfill({ contentType: mime[extname(file)] || 'application/octet-stream', body: await readFile(new URL(file, app)) }); }
      catch (error) { if (error.code !== 'ENOENT') throw error; return route.fulfill({ status: 404 }); }
    }
    if (method === 'POST' && path === requestPath) {
      const body = req.postDataJSON();
      writes.push({ method, path, body });
      request = { ...body, id: 'c275-request', num: 275, status: 'requested' };
      return route.fulfill({ status: 201, json: request });
    }
    if (method === 'PATCH' && path === requestCardPath) {
      const body = req.postDataJSON();
      writes.push({ method, path, body });
      request = { ...request, ...body };
      return route.fulfill({ json: request });
    }
    if (method === 'PATCH' && [restoreNotePath, restoreDeliveryPath].includes(path)) {
      const body = req.postDataJSON();
      const field = path === restoreNotePath ? 'notes' : 'deliveryNote';
      writes.push({ method, path, body });
      if (body.expected !== (request[field] || null)) return route.fulfill({ status: 409, json: { message: 'Примечание изменилось. Откройте заявку заново' } });
      audit.unshift({ action: 'supply.request.updated', createdAt: '2026-11-26T13:00:00.000Z', userName: user.displayName,
        changes: [{ field, from: request[field], to: body.value }] });
      request = { ...request, [field]: body.value };
      return route.fulfill({ json: request });
    }
    if (method === 'DELETE' && path === requestCardPath && role === 'admin') {
      writes.push({ method, path });
      request = { ...request, deletedAt: '2026-11-26T13:00:00.000Z' };
      return route.fulfill({ json: { id: request.id, deleted: true } });
    }
    if (method === 'POST' && path === '/api/auth/confirm') return route.fulfill({ json: { token: 'fixture-confirmation' } });
    if (method === 'POST' && path === requestCardPath + '/restore') {
      writes.push({ method, path, confirmation: req.headers()['x-confirm-token'] });
      request = { ...request, deletedAt: null };
      return route.fulfill({ json: request });
    }
    if (method === 'PATCH' && path === invoicePath) {
      const body = req.postDataJSON();
      writes.push({ method, path, body });
      invoice = { ...invoice, ...body };
      return route.fulfill({ json: invoice });
    }
    if (method === 'POST' && path === '/api/client-errors') return route.fulfill({ status: 204 });
    if (method !== 'GET') { declined.push({ method, path }); return route.fulfill({ status: 403, json: {} }); }
    if (path === '/api/auth/me') return route.fulfill({ json: user });
    if (path === '/api/audit-logs/record') return route.fulfill({ json: { items: audit } });
    if (path === '/api/today') {
      const today = '2026-11-26';
      const feed = [request, ...otherDeliveries].filter((item) => item?.neededBy).map((item) => {
        const days = (Date.parse(item.neededBy) - Date.parse(today)) / 86_400_000;
        return { kind: 'delivery', id: item.id, title: item.title, sub: `Заявка №${item.num}`, due: item.neededBy,
          daysLeft: Math.max(0, days), overdueDays: Math.max(0, -days), actions: [{ id: 'receive', label: 'Принять' }, { id: 'move', label: 'Перенести дату' }] };
      });
      return route.fulfill({ json: { today, feed, feedTotal: feed.length, week: [], metrics: {} } });
    }
    if (path === '/api/supply/lookups') return route.fulfill({ json: { suppliers: [], categories: [{ id: 'cat', name: 'Сырьё' }], requestedBy: [], companies: [] } });
    if (path === '/api/financial-articles') return route.fulfill({ json: { items: [
      { id: 'expenses', name: 'Расходы', children: [{ id: 'article', name: 'Закупка сырья', categoryIds: ['cat'] }] },
    ] } });
    if (path === requestCardPath) return route.fulfill({ json: request });
    if (path === invoicePath) return route.fulfill({ json: invoice });
    const status = url.searchParams.get('status');
    const items = path === '/api/supply/invoices' ? [invoice]
      : path === requestPath && request && (url.searchParams.get('deleted') === '1') === !!request.deletedAt && (!status || status === request.status) ? [request] : [];
    return route.fulfill({ json: { items, total: items.length, page: 1, limit: 30, counts: {}, facets: {} } });
  });
  await page.goto(origin + '/app/#requests');
  await page.locator('.shell').waitFor().catch(async () => {
    assert.fail([`Приложение не открылось: ${await page.locator('body').innerText()}`, ...errors].join('\n'));
  });
  return { page, writes, errors, declined, currentInvoice: () => invoice, currentRequest: () => request,
    updateRequest: change => { request = { ...request, ...change }; } };
}

async function screenshot(page, name) {
  const folder = process.env.C275_EVIDENCE;
  if (!folder) return;
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: join(folder, name + '.png') });
}

function firstSection(drawer) { return drawer.locator('.drawer-body .form-block').first(); }

test('менеджер создаёт и редактирует заявку, сохранение примечания не перезаписывает свежие количество и статус', async t => {
  const { page, writes, errors, declined, currentRequest, updateRequest } = await fixture(t, 'light');
  await page.getByRole('button', { name: '+ Заявка', exact: true }).click();
  const drawer = page.getByRole('dialog');
  const first = firstSection(drawer);
  await first.locator('[name="title"]').fill('Учебная поставка');
  await first.getByLabel('Дата заявки', { exact: true }).fill('2026-11-25');
  await first.getByLabel('Примечание', { exact: true }).fill('Привезти к воротам');
  await screenshot(page, 'request-create-light');
  await drawer.getByRole('button', { name: 'Создать', exact: true }).click();
  await drawer.getByText('Привезти к воротам', { exact: true }).waitFor();
  await drawer.getByText(/25\.11\.2026/).waitFor();
  await screenshot(page, 'request-card-light');
  await drawer.getByRole('button', { name: 'Ещё действия', exact: true }).click();
  await drawer.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  const date = first.getByLabel('Дата заявки', { exact: true }), note = first.getByLabel('Примечание', { exact: true });
  assert.equal(await date.inputValue(), '2026-11-25');
  assert.equal(await note.inputValue(), 'Привезти к воротам');
  await date.fill('2026-11-26'); await note.fill('Привезти на склад');
  await screenshot(page, 'request-edit-light');
  await drawer.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await drawer.getByRole('button', { name: 'Ещё действия', exact: true }).waitFor();
  assert.deepEqual(writes.map(({ method, path, body }) => [method, path, body.requestDate, body.notes]), [
    ['POST', requestPath, '2026-11-25', 'Привезти к воротам'],
    ['PATCH', requestPath + '/c275-request', '2026-11-26', 'Привезти на склад'],
  ]);

  await drawer.getByRole('button', { name: 'Ещё действия', exact: true }).click();
  await drawer.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  assert.equal(await note.inputValue(), 'Привезти на склад');
  updateRequest({ qty: 8, status: 'ordered' });
  await note.fill('Позвонить перед доставкой');
  await drawer.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await drawer.getByRole('button', { name: 'Ещё действия', exact: true }).waitFor();
  assert.deepEqual(writes[2], { method: 'PATCH', path: requestPath + '/c275-request', body: { notes: 'Позвонить перед доставкой' } });
  assert.equal(currentRequest().qty, 8);
  assert.equal(currentRequest().status, 'ordered');
  assert.deepEqual(errors, []); assert.deepEqual(declined, []);
});

test('примечание позиции счёта не записывает автоматически показанную статью и реквизиты счёта', async t => {
  const { page, writes, errors, declined } = await fixture(t, 'dark', { canMoney: true, initialRequest: {
    title: 'Учебное сырьё', categoryName: 'Сырьё', materialId: 'material', qty: 2, unit: 'шт', note: '', notes: 'Первоначальное',
    invoiceId: 'c275-invoice', invoiceNo: 'C275', invoiceDate: '2026-11-20', supplierName: 'Учебный поставщик',
  } });
  await page.evaluate(() => { location.hash = '#requests?open=c275-request'; });
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: 'Ещё действия', exact: true }).click();
  await drawer.getByRole('menuitem', { name: 'Изменить', exact: true }).click();
  assert.equal(await drawer.locator('select[name="articleId"]').inputValue(), 'article');
  const note = firstSection(drawer).getByLabel('Примечание', { exact: true });
  await note.fill('');
  await drawer.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await drawer.getByRole('button', { name: 'Ещё действия', exact: true }).waitFor();
  assert.deepEqual(writes, [{ method: 'PATCH', path: requestPath + '/c275-request', body: { notes: '' } }]);
  assert.deepEqual(errors, []); assert.deepEqual(declined, []);
});

test('сравнение PATCH сохраняет ноль, очистку суммы и фотографий, порядок фото и пустую дату', async t => {
  const { page } = await fixture(t, 'light');
  const result = await page.evaluate(async () => {
    const { requests } = await import('/app/sections/requests.js');
    const row = { qty: '0', status: 'requested', notes: ' Первая\r\nВторая ', priceHint: 0, photos: [{ id: 'a' }, { id: 'b' }] };
    const values = { ...requests.form.toInitial(row), qty: 0, notes: 'Первая\nВторая', photos: ['a', 'b'] };
    return {
      same: requests.form.toBody(values, row),
      zero: requests.form.toBody({ ...values, priceHint: 0 }, { ...row, priceHint: null }),
      cleared: requests.form.toBody({ ...values, priceHint: null, photos: [] }, row),
      reordered: requests.form.toBody({ ...values, photos: ['b', 'a'] }, row),
    };
  });
  assert.deepEqual(result, { same: {}, zero: { priceHint: 0 }, cleared: { priceHint: null, photoIds: [] }, reordered: { photoIds: ['b', 'a'] } });
});

test('из истории можно вернуть примечание и доставку с подтверждением и защитой от чужой правки', async t => {
  const currentNote = 'Привезти после обеда', previousNote = 'Привезти утром', concurrentNote = 'Позвонить перед выездом';
  const { page, writes, errors, declined, updateRequest, currentRequest } = await fixture(t, 'light', {
    initialRequest: { title: 'Учебная поставка с историей', notes: currentNote, deliveryNote: 'Ко вторым воротам', qty: 4, unit: 'шт' },
    history: [{ action: 'supply.request.updated', createdAt: '2026-11-26T12:00:00.000Z', userName: 'Другой менеджер',
      changes: [{ field: 'notes', from: previousNote, to: currentNote }, { field: 'deliveryNote', from: null, to: 'Ко вторым воротам' }, { field: 'qty', from: 1, to: 4 }] }],
  });
  const drawer = page.locator('.drawer'), dialog = page.locator('.modal');
  const history = drawer.locator('details').filter({ hasText: 'История изменений' });
  const restore = history.getByRole('button', { name: 'Вернуть поле «Примечание»', exact: true });
  const open = async () => {
    await page.evaluate(() => { location.hash = '#requests?open=c275-request'; });
    await history.getByText('История изменений', { exact: true }).click();
    await restore.waitFor();
  };
  await open();
  assert.equal(await history.getByRole('button', { name: /Вернуть/ }).count(), 2);
  assert.match(await history.innerText(), /Количество/);
  await restore.click();
  assert.match(await dialog.innerText(), /Сейчас: Привезти после обеда/);
  assert.match(await dialog.innerText(), /Будет: Привезти утром/);
  await dialog.getByRole('button', { name: 'Отмена', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(writes, []);
  assert.deepEqual(declined, []);

  updateRequest({ notes: concurrentNote });
  await restore.click();
  await dialog.getByRole('button', { name: 'Вернуть', exact: true }).click();
  await page.locator('.toast').filter({ hasText: 'Примечание изменилось. Откройте заявку заново' }).waitFor();
  assert.deepEqual(writes, [{ method: 'PATCH', path: restoreNotePath, body: { expected: currentNote, value: previousNote } }]);
  assert.equal(currentRequest().notes, concurrentNote);
  assert.equal(currentRequest().qty, 4);

  await page.keyboard.press('Escape');
  await drawer.waitFor({ state: 'detached' });
  await open();
  await restore.click();
  assert.match(await dialog.innerText(), /Сейчас: Позвонить перед выездом/);
  await dialog.getByRole('button', { name: 'Вернуть', exact: true }).click();
  await page.locator('.toast').filter({ hasText: 'Значение восстановлено' }).waitFor();
  assert.deepEqual(writes[1], { method: 'PATCH', path: restoreNotePath, body: { expected: concurrentNote, value: previousNote } });
  assert.equal(writes.length, 2);
  assert.equal(currentRequest().notes, previousNote);
  assert.equal(currentRequest().qty, 4);
  await history.getByText(concurrentNote, { exact: true }).waitFor();
  await history.getByRole('button', { name: 'Вернуть поле «Доставка»', exact: true }).click();
  assert.match(await dialog.innerText(), /Сейчас: Ко вторым воротам/);
  assert.match(await dialog.innerText(), /Будет: пусто/);
  await screenshot(page, 'request-delivery-restore-light');
  await dialog.getByRole('button', { name: 'Вернуть', exact: true }).click();
  await dialog.waitFor({ state: 'detached' });
  assert.deepEqual(writes[2], { method: 'PATCH', path: restoreDeliveryPath, body: { expected: 'Ко вторым воротам', value: null } });
  assert.equal(currentRequest().deliveryNote, null);
  assert.equal(currentRequest().notes, previousNote);
  assert.deepEqual(errors, []); assert.deepEqual(declined, []);
});

test('менеджер видит подсказку об удалении и восстанавливает заявку из корзины', async t => {
  const { page, writes, errors, declined, updateRequest } = await fixture(t, 'dark', { width: 1200, initialRequest: {
    title: 'Учебная заявка для корзины', requestDate: '2026-11-26', notes: 'Пропустить машину через дальние ворота', qty: 4, unit: 'шт',
  } });
  await page.evaluate(() => { location.hash = '#requests?open=c275-request'; });
  const drawer = page.locator('.drawer');
  await drawer.getByText('Пропустить машину через дальние ворота', { exact: true }).waitFor();
  await drawer.getByRole('button', { name: 'Ещё действия', exact: true }).click();
  assert.equal(await drawer.getByRole('menuitem', { name: 'Удалить', exact: true }).count(), 0);
  await screenshot(page, 'request-card-manager-dark');
  await drawer.getByRole('menuitem', { name: 'Удаление через администратора', exact: true }).click();
  await page.locator('.toast').filter({ hasText: 'Чтобы удалить заявку, обратитесь к администратору' }).waitFor();
  assert.deepEqual(writes, []);

  updateRequest({ deletedAt: '2026-11-26T13:00:00.000Z' });
  await page.evaluate(() => { location.hash = '#trash'; });
  await page.getByRole('button', { name: /Восстановить .*Учебная заявка для корзины/ }).click();
  const modal = page.locator('.modal');
  await modal.getByLabel('Пароль для входа в программу', { exact: true }).fill('fixture-password');
  await modal.getByRole('button', { name: 'Подтвердить', exact: true }).click();
  await page.locator('.toast').filter({ hasText: 'Восстановлено' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Вернуть в корзину', exact: true }).count(), 0);
  assert.deepEqual(writes, [{ method: 'POST', path: requestCardPath + '/restore', confirmation: 'fixture-confirmation' }]);
  assert.deepEqual(errors, []); assert.deepEqual(declined, []);
});

test('на «Сегодня» менеджер видит поставки по срокам, переносит только срок и может вернуть его', async t => {
  const { page, writes, errors, declined, currentRequest } = await fixture(t, 'dark', {
    initialRequest: { title: 'Учебная поставка на сегодня', status: 'ordered', requestDate: '2026-11-18', invoiceDate: '2026-11-20',
      neededBy: '2026-11-26', qty: 4, unit: 'шт' },
    otherDeliveries: [
      { id: 'overdue', num: 276, title: 'Просроченная учебная поставка', neededBy: '2026-11-24' },
      { id: 'tomorrow', num: 277, title: 'Учебная поставка на завтра', neededBy: '2026-11-27' },
    ],
  });
  await page.getByRole('link', { name: 'Сегодня', exact: true }).click();
  const row = page.locator('.k-feed').filter({ hasText: 'Учебная поставка на сегодня' });
  const urgent = page.locator('[data-b="urgent"]');
  const upcoming = page.locator('[data-b="delivery"]');
  const move = row.getByRole('button', { name: 'Перенести дату', exact: true });
  const modal = page.locator('.modal');
  const dateInput = modal.getByLabel('Новая дата', { exact: true });
  await row.getByText(/26\.11\.2026/).waitFor();
  await upcoming.getByText('Учебная поставка на сегодня', { exact: true }).waitFor();
  await upcoming.getByText('Учебная поставка на завтра', { exact: true }).waitFor();
  assert.equal(await urgent.locator('.k-feed').count(), 1);
  assert.equal(await urgent.getByText('Просроченная учебная поставка', { exact: true }).count(), 1);
  assert.equal(await upcoming.locator('.k-feed').count(), 2);
  await row.focus();
  await row.getByRole('button', { name: 'Принять', exact: true }).waitFor();
  await screenshot(page, 'request-today-row-dark');
  await move.focus();
  await page.keyboard.press('Enter');
  assert.equal(await dateInput.evaluate(input => input === document.activeElement), true);
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'detached' });
  assert.equal(await move.evaluate(button => button === document.activeElement), true);
  assert.deepEqual(writes, []);

  await move.click();
  await dateInput.fill('2026-11-28');
  await screenshot(page, 'request-move-date-dark');
  await modal.getByRole('button', { name: 'Перенести', exact: true }).click();
  await row.getByText(/28\.11\.2026/).waitFor();
  assert.deepEqual(writes, [{ method: 'PATCH', path: requestCardPath, body: { neededBy: '2026-11-28' } }]);
  assert.equal(currentRequest().requestDate, '2026-11-18');
  assert.equal(currentRequest().invoiceDate, '2026-11-20');
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await row.getByText(/26\.11\.2026/).waitFor();
  assert.deepEqual(writes[1], { method: 'PATCH', path: requestCardPath, body: { neededBy: '2026-11-26' } });
  assert.deepEqual(errors, []); assert.deepEqual(declined, []);
});

test('администратор удаляет заявку в корзину после подтверждения', async t => {
  const { page, writes, errors, declined, currentRequest } = await fixture(t, 'light', { role: 'admin', initialRequest: {
    title: 'Учебная заявка на удаление', qty: 4, unit: 'шт',
  } });
  await page.evaluate(() => { location.hash = '#requests?open=c275-request'; });
  const drawer = page.locator('.drawer');
  await drawer.getByRole('button', { name: 'Ещё действия', exact: true }).click();
  await drawer.getByRole('menuitem', { name: 'Удалить', exact: true }).click();
  const modal = page.locator('.modal');
  await modal.getByText(/Можно восстановить из корзины/).waitFor();
  await screenshot(page, 'request-delete-admin-light');
  await modal.getByRole('button', { name: 'Удалить', exact: true }).click();
  await page.locator('.toast').filter({ hasText: 'Удалено' }).waitFor();
  await drawer.waitFor({ state: 'detached' });
  assert.deepEqual(writes, [{ method: 'DELETE', path: requestCardPath }]);
  assert.ok(currentRequest().deletedAt);
  assert.deepEqual(errors, []); assert.deepEqual(declined, []);
});

test('менеджер без денежных прав видит и редактирует доставку и примечание счёта', async t => {
  const { page, writes, errors, declined, currentInvoice } = await fixture(t, 'dark');
  await page.getByRole('tab', { name: 'Счета', exact: true }).click();
  await page.getByRole('link', { name: 'Счёт № C275', exact: true }).click();
  const drawer = page.getByRole('dialog');
  const openEdit = async () => {
    await drawer.getByRole('button', { name: 'Ещё действия', exact: true }).click();
    await drawer.getByRole('menuitem', { name: 'Реквизиты счёта', exact: true }).click();
  };
  const save = async () => {
    const response = page.waitForResponse(res => res.request().method() === 'PATCH' && new URL(res.url()).pathname === invoicePath);
    await drawer.getByRole('button', { name: 'Сохранить', exact: true }).click();
    assert.equal((await response).ok(), true);
    await drawer.getByRole('button', { name: 'Ещё действия', exact: true }).waitFor();
  };
  const first = firstSection(drawer);
  const date = first.getByLabel('Дата доставки', { exact: true }), note = first.getByLabel('Примечание', { exact: true });
  await openEdit();
  assert.equal(await date.inputValue(), '2026-11-28');
  assert.equal(await note.inputValue(), 'Привезти до обеда');
  assert.equal(await drawer.getByLabel('Валюта документа').count(), 0);
  await screenshot(page, 'invoice-edit-dark');
  await first.getByLabel('№ счёта', { exact: true }).fill('C275-2');
  await save();
  assert.equal('deliveryDate' in writes[0].body, false);
  assert.equal('note' in writes[0].body, false);
  assert.equal(currentInvoice().deliveryDate, '2026-11-28T00:00:00.000Z');
  assert.equal(currentInvoice().note, 'Привезти до обеда');

  await openEdit();
  await date.fill(''); await note.fill('');
  await save();
  assert.equal(writes[1].body.deliveryDate, '');
  assert.equal(writes[1].body.note, '');

  await openEdit();
  assert.equal(await date.inputValue(), ''); assert.equal(await note.inputValue(), '');
  await date.fill('2026-12-02'); await note.fill('Звонить перед доставкой');
  await save();
  assert.equal(writes[2].body.deliveryDate, '2026-12-02');
  assert.equal(writes[2].body.note, 'Звонить перед доставкой');
  assert.ok(writes.every(({ body }) => ['amount', 'currency', 'vatMode', 'payerCompanyId', 'priceHint'].every(key => !(key in body))));
  assert.deepEqual(errors, []); assert.deepEqual(declined, []);
});
