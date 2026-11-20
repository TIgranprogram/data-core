import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

const code = readFileSync(new URL('./passport-source-picker.js', import.meta.url), 'utf8')
  .replace(/^import .*?;\r?\n/gm, '').replace(/^export /gm, '');
const clean = (value) => JSON.parse(JSON.stringify(value));
function setup({ confirm = true, error = null } = {}) {
  const calls = [], dialogs = [], events = [], downloads = [];
  const baseline = { selection: { mode: 'site', revision: 7 }, contextToken: 'baseline-7', sitePassports: [{ id: 'old', status: 'issued' }] };
  const node = (kind, attrs, ...children) => ({ kind, attrs, children });
  const sandbox = vm.createContext({
    api: async (path, options) => {
      calls.push({ path, options: options && clean(options) });
      if (options?.method === 'PUT' && error) throw error;
      return options?.method === 'POST' ? { url: '/api/files/chosen' } : baseline;
    }, PREFIX: '/db', h: (tag, attrs) => ({ tag, attrs, click() { downloads.push(attrs); }, remove() {} }),
    document: { body: { append() {} } }, window: { dispatchEvent(e) { events.push(e.type); } }, Event,
    kit: { confirmDlg: async (...args) => { dialogs.push(args); return confirm; },
      button: (attrs) => node('button', attrs), stack: (...children) => node('stack', null, ...children),
      row: (attrs) => node('row', attrs), badge: (...args) => node('badge', args), actions: (...children) => node('actions', null, ...children) },
  });
  vm.runInContext(code, sandbox);
  sandbox.attachmentSource = vm.runInContext('attachmentSource', sandbox);
  return { sandbox, calls, dialogs, events, downloads, baseline };
}

test('файл и attachment mode сохраняются одним PUT с исходной revision/token', async () => {
  const s = setup(); let saved = 0;
  await s.sandbox.useFileAsPassport('order', 'line', { id: 'chosen', originalName: 'Паспорт.pdf', selectionGeneration: 2 }, { onSaved() { saved++; } });
  assert.equal(s.calls.length, 2);
  assert.equal(s.calls[0].path, '/passports/order/order/lines/line/source');
  assert.deepEqual(s.calls[1].options, { method: 'PUT', body: { mode: 'attachment', expectedRevision: 7, contextToken: 'baseline-7', attachmentId: 'chosen', expectedAttachmentGeneration: 2, confirm: true } });
  assert.match(s.dialogs[0][1], /Паспорт сайта останется в истории/);
  assert.deepEqual(s.events, ['data-changed']); assert.equal(saved, 1);
});

test('отмена подтверждения не пишет source и не меняет готовность', async () => {
  const s = setup({ confirm: false });
  assert.equal(await s.sandbox.useFileAsPassport('order', 'line', { id: 'chosen' }), false);
  assert.equal(s.calls.length, 1); assert.deepEqual(s.events, []);
});

test('409 не повторяет PUT с новой revision и не сообщает успешное изменение', async () => {
  const error = Object.assign(new Error('Контекст изменён'), { status: 409 });
  const s = setup({ error });
  await assert.rejects(s.sandbox.useFileAsPassport('order', 'line', { id: 'chosen' }, { view: s.baseline }), /Контекст изменён/);
  assert.equal(s.calls.length, 1); assert.deepEqual(s.events, []);
  assert.equal(s.calls[0].options.body.contextToken, 'baseline-7');
});

test('возврат к site не передаёт attachment или confirm и не вызывает выпуск', async () => {
  const s = setup();
  await s.sandbox.savePassportSource('order', 'line', s.baseline);
  assert.deepEqual(s.calls[0].options.body, { mode: 'site', expectedRevision: 7, contextToken: 'baseline-7' });
  assert.equal(s.calls.length, 1);
});

test('недоступный файл при attachment source не имеет действия скачивания и зелёной готовности', () => {
  const s = setup();
  const view = { state: 'blocked', source: 'attachment', attachment: { originalName: 'Паспорт.pdf', available: false }, missing: ['Файл пропал'] };
  const rendered = clean(s.sandbox.selectedPassportActions('order', 'line', view));
  const text = JSON.stringify(rendered);
  assert.match(text, /нужен файл/); assert.match(text, /Файл пропал/); assert.doesNotMatch(text, /Скачать паспорт/);
  assert.equal(s.sandbox.attachmentSource(view), true);
});

test('скачивание запрашивает тикет текущего выбора и передаёт baseline', async () => {
  const s = setup();
  await s.sandbox.downloadSelectedPassport('order', 'line', { contextToken: 'current', attachment: { originalName: 'Паспорт.pdf' } });
  assert.deepEqual(s.calls[0], { path: '/passports/order/order/lines/line/source/download-ticket', options: { method: 'POST', body: { contextToken: 'current' } } });
  assert.equal(s.downloads[0].href, '/db/api/files/chosen');
});

test('DOM: настоящий openCard открывает вложенный выбор, подтверждает файл и возвращает в позицию', async () => {
  const { chromium } = await import('../../../tools/design-checks/node_modules/playwright-core/index.mjs');
  const { findBrowser } = await import('../../../tools/browser-path.mjs');
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const errors = [], calls = [];
  const root = new URL('../', import.meta.url);
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 900 } });
    page.setDefaultTimeout(5000);
    page.on('pageerror', (e) => errors.push(e.message));
    // Как auto-more.test: реальный граф JS/CSS, локальные ответы через route, без входа/стенда.
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://picker.test') return route.abort();
      if (url.pathname.startsWith('/api/')) {
        const method = route.request().method();
        calls.push({ path: url.pathname, method, body: method === 'PUT' ? route.request().postDataJSON() : null });
        const source = { selection: { mode: 'site', revision: 7 }, contextToken: 'baseline-7', sitePassports: [] };
        const body = url.pathname.endsWith('/candidates') ? { items: [{ id: 'file', originalName: 'Паспорт песочницы.pdf', typeName: 'Паспорта', available: true, selectionGeneration: 2 }], total: 1, page: 1, limit: 20 } : source;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (url.pathname === '/app/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ru"><head><link rel="stylesheet" href="/app/ui/tokens.css"><link rel="stylesheet" href="/app/ui/base.css"><link rel="stylesheet" href="/app/ui/list.css"><link rel="stylesheet" href="/app/ui/form.css"><link rel="stylesheet" href="/app/ui/panels.css"><link rel="stylesheet" href="/app/ui/kit/kit.css"></head><body></body></html>' });
      if (!url.pathname.startsWith('/app/') || url.pathname.includes('..')) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(new URL(url.pathname.slice(5), root)) });
    });
    await page.goto('http://picker.test/app/#docs?of=orderpass&open=order');
    await page.evaluate(async () => {
      const kit = await import('/app/ui/kit/index.js');
      const { openPassportSourcePicker } = await import('/app/sections/passport-source-picker.js');
      const { session } = await import('/app/core/api.js');
      session.user = { role: 'manager' }; window.saved = 0;
      kit.openCard({ id: 'fixture', title: 'Позиция', popout: false, get: async () => ({}), canEdit: () => false,
        card: { heading: () => 'Позиция заказа', noHistory: true, view: () => [], extra: () => kit.button({
          label: 'Выбрать вложенный паспорт', onClick: (e) => openPassportSourcePicker('order', 'line', { parent: e.currentTarget.closest('.drawer'), onSaved: () => { window.saved++; } }),
        }) },
      }, { id: 'line' }, { changed() {}, close() {} });
    });
    await page.getByRole('button', { name: 'Выбрать вложенный паспорт', exact: true }).click();
    await page.getByRole('heading', { name: 'Выбрать вложенный паспорт', exact: true }).waitFor();
    await page.locator('.k-sec').filter({ hasText: 'Паспорт песочницы.pdf' }).waitFor();
    assert.equal(await page.locator('.drawer:not([hidden])').count(), 1);
    await page.getByRole('button', { name: 'Использовать как паспорт', exact: true }).click();
    await page.locator('.modal-back').getByRole('button', { name: 'Использовать как паспорт', exact: true }).click();
    await page.waitForFunction(() => window.saved === 1);
    await page.getByRole('heading', { name: 'Позиция заказа', exact: true }).waitFor({ state: 'visible' });
    assert.equal(await page.locator('.drawer').count(), 1);
    assert.deepEqual(errors, []);
    assert.equal(calls.filter((c) => c.method === 'GET').length, 2);
    assert.deepEqual(calls.filter((c) => c.method === 'PUT'), [{ path: '/api/passports/order/order/lines/line/source', method: 'PUT', body: { mode: 'attachment', expectedRevision: 7, contextToken: 'baseline-7', attachmentId: 'file', expectedAttachmentGeneration: 2, confirm: true } }]);
  } finally { await browser.close(); }
});
