import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from '../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../tools/browser-path.mjs';
import { invoiceMergeData } from '../fixtures/invoice-merge-data.mjs';

const origin = 'http://merge-preview.test';
let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, canMoney) {
  const data = invoiceMergeData(), writes = [], patches = [];
  data.source.no = '101'; data.preview.source.no = '101';
  data.source.payerCompanyId = 'payer';
  if (!canMoney) {
    delete data.preview.resultAmount;
    for (const side of ['source', 'target']) {
      delete data.preview[side].amount; delete data[side].amount;
      for (const line of data[side].requests) delete line.priceHint;
    }
    data.preview.strategies = ['append', 'replaceLines'];
  }
  const page = await browser.newPage({ serviceWorkers: 'block' });
  page.setDefaultTimeout(5000);
  t.after(() => page.close());
  await page.addInitScript(money => {
    localStorage.setItem('dca_access', 'fixture');
    localStorage.setItem('dca_user', JSON.stringify({ id: 'fixture', role: money ? 'admin' : 'request-editor', baseRole: money ? 'admin' : 'manager', canMoney: money }));
  }, canMoney);
  await page.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.startsWith('/api/')) {
      if (req.method() === 'PATCH') {
        patches.push(req.postDataJSON());
        return route.fulfill({ status: 409, json: { code: 'INVOICE_NUMBER_EXISTS', message: 'Такой счёт уже есть', existingInvoiceId: 'target' } });
      }
      if (req.method() === 'POST') {
        writes.push({ path: url.pathname, body: req.postDataJSON() });
        return route.fulfill({ json: { targetInvoiceId: 'target' } });
      }
      const key = url.pathname.split('/').at(-1);
      return route.fulfill({ json: key === 'merge-preview' ? data.preview : data[key] || {} });
    }
    if (url.pathname === '/app/fixture.html') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><main></main>' });
    const file = url.pathname.slice('/app/'.length);
    if (!file.endsWith('.js') || file.includes('..')) return route.abort();
    return route.fulfill({ contentType: 'text/javascript', body: await readFile(new URL('../' + file, import.meta.url)) });
  });
  await page.goto(origin + '/app/fixture.html');
  await page.evaluate(async () => {
    const { buildWorkspaceForm } = await import('/app/sections/invoice-workspace-forms.js');
    const { api } = await import('/app/core/api.js');
    const invoice = await api('/supply/invoices/source');
    const services = { payers: async () => [], contracts: async () => [], overview: () => document.createElement('div'), href: ({ open }) => '#requests?of=invoicecard&open=' + open };
    const form = await buildWorkspaceForm(invoice, { operation: 'meta' }, services);
    const save = document.createElement('button');
    save.textContent = 'Сохранить';
    save.onclick = async () => {
      try { await api('/supply/invoices/source', { method: 'PATCH', body: form.read().values.body }); }
      catch (error) { form.onError(error); }
    };
    document.querySelector('main').append(form.el, save);
  });
  await page.locator('input[name="no"]').fill('102');
  await page.getByRole('button', { name: 'Сохранить', exact: true }).click();
  await page.getByRole('link', { name: 'Открыть существующий счёт →' }).waitFor();
  assert.equal(patches.length, 1);
  assert.equal(patches[0].no, '102');
  assert.equal(writes.length, 0);
  await page.getByRole('button', { name: 'Посмотреть, что добавится' }).click();
  return { page, writes };
}
for (const strategy of ['append', 'replaceLines']) test('C275 — редактор без денег видит строки и подтверждает ' + strategy, async t => {
  const { page, writes } = await fixture(t, false);
  await page.getByText('Объединение счетов — предпросмотр', { exact: true }).waitFor({ timeout: 5000 });
  const select = page.getByRole('dialog').locator('select');
  assert.deepEqual(await select.locator('option').evaluateAll(options => options.map(option => option.value)), ['append', 'replaceLines']);
  await select.selectOption(strategy, { force: true });
  assert.equal(await page.getByText(/Итог целевого счёта/).count(), 0);
  assert.ok(await page.getByText(/Гайка М8/).count());
  assert.equal(writes.length, 0);
  await page.locator('form button[type="submit"]').click();
  await page.waitForURL('**/*#requests?of=invoicecard&open=target', { timeout: 3000 });
  assert.deepEqual(writes, [{ path: '/api/supply/invoices/source/merge', body: { strategy, targetId: 'target' } }]);
});

test('C275 — отмена предпросмотра возвращает введённые реквизиты и выбор существующего счёта', async t => {
  const { page, writes } = await fixture(t, false);
  await page.getByRole('dialog').getByRole('button', { name: 'Отмена' }).click();
  assert.equal(await page.getByRole('dialog').count(), 0);
  assert.equal(await page.locator('input[name="no"]').inputValue(), '102');
  assert.equal(await page.getByRole('link', { name: 'Открыть существующий счёт →' }).getAttribute('href'), '#requests?of=invoicecard&open=target');
  assert.equal(writes.length, 0);
});

test('C275 — администратор видит денежный итог и пропускаемые дубли', async t => {
  const { page, writes } = await fixture(t, true);
  await page.getByText('Объединение счетов — предпросмотр', { exact: true }).waitFor({ timeout: 5000 });
  await page.getByRole('dialog').locator('select').selectOption('mergeSameRequest', { force: true });
  await page.getByText('Дубли будут пропущены', { exact: true }).waitFor({ timeout: 3000 });
  assert.match(await page.getByText(/Итог целевого счёта/).textContent(), /700/);
  assert.equal(writes.length, 0);
});
