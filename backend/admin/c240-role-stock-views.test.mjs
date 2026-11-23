import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../tools/browser-path.mjs';

const source = await readFile(new URL('./admin.js', import.meta.url), 'utf8');
const helpers = source.slice(source.indexOf('  const checkedOf ='), source.indexOf('  /** Поля роли:'));
const forms = source.slice(source.indexOf('  function roleForm('), source.indexOf('  function toggleRole('));
const stockModule = await readFile(new URL('./role-stock-views.js', import.meta.url), 'utf8');
const tokens = (await readFile(new URL('../pwa/ui/tokens.css', import.meta.url), 'utf8')).replaceAll("url('../fonts/", "url('http://c240-role.test/app/fonts/");
const css = tokens + '\n' + await readFile(new URL('./admin.css', import.meta.url), 'utf8');
let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, role, isNew = false, theme = 'light') {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); t.after(() => page.close());
  await page.route('http://c240-role.test/app/fonts/*', async route => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    await route.fulfill({ contentType: 'font/woff2', body: await readFile(new URL('../pwa/fonts/' + name, import.meta.url)) });
  });
  await page.setContent('<!doctype html><html data-theme="' + theme + '"><head><meta charset="utf-8"><style>' + css + '</style></head><body><main class="main"><section class="panel"><h1>Настройка роли</h1><div id="fixture"></div></section></main></body></html>');
  await page.evaluate(({ role, isNew, helpers, forms, stockModule }) => {
    const el = (tag, cls, txt) => { const n = document.createElement(tag); if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };
    const roleState = { sections: [{ id: 'stock', label: 'Остатки' }, { id: 'money', label: 'Деньги' }, { id: 'products', label: 'Продукция' }], zones: [], stockCats: [] };
    const ROLE_GROUPS = [['Склад', ['stock']], ['Деньги', ['money']], ['Продукция', ['products']]];
    const ROLE_RULES = [], ROLE_PRESETS = [], BASE_ROLES = ['user', 'manager', 'accountant', 'director', 'admin'];
    const ROLE_HINT = { user: 'Наблюдатель', manager: 'Менеджер', accountant: 'Бухгалтер', director: 'Директор', admin: 'Администратор' };
    const BASE_RANK = { user: 0, manager: 1, accountant: 2, director: 3, admin: 4 };
    const isBuiltinRole = name => BASE_ROLES.includes(name), roleTitle = r => r.label || ROLE_HINT[r.name] || r.name;
    // Вызываются реальные roleForm/roleBody и общие checkGrid/roleCard, а не копия поведения формы.
    eval(stockModule);
    eval(helpers + '\n' + forms + '\nwindow.c240Form = roleForm(role, isNew); window.c240Body = () => roleBody(window.c240Form);');
    document.querySelector('#fixture').append(window.c240Form.wrap);
  }, { role, isNew, helpers, forms, stockModule });
  return page;
}

test('новая роль: наследование не посылает stockViews или resetStockViews', async t => {
  const page = await fixture(t, { name: '', baseRole: 'manager', appSections: ['stock'] }, true);
  const body = await page.evaluate(() => window.c240Body());
  assert.equal(Object.hasOwn(body, 'stockViews'), false);
  assert.equal(Object.hasOwn(body, 'resetStockViews'), false);
  assert.equal(body.baseRole, 'manager');
  assert.deepEqual(body.appSections, ['stock']);
});

test('явный пустой список отключает экраны; возврат к умолчанию использует reset, а не omission', async t => {
  const page = await fixture(t, { name: 'director', appSections: ['stock'], stockViews: [] });
  const mode = page.getByLabel('Дополнительные экраны склада', { exact: true });
  assert.equal(await mode.inputValue(), 'custom');
  assert.deepEqual((await page.evaluate(() => window.c240Body())).stockViews, []);
  await page.getByRole('checkbox', { name: 'Труборез', exact: true }).check();
  let body = await page.evaluate(() => window.c240Body());
  assert.deepEqual(body.stockViews, ['pipe']); assert.equal(Object.hasOwn(body, 'resetStockViews'), false);
  await mode.selectOption('inherit');
  body = await page.evaluate(() => window.c240Body());
  assert.equal(body.resetStockViews, true); assert.equal(Object.hasOwn(body, 'stockViews'), false);
  assert.deepEqual(body.appSections, ['stock']); assert.equal(Object.hasOwn(body, 'money'), false);
});

test('custom роль сохраняет точный выбор pipe/sheet и прежние остальные поля', async t => {
  const role = { name: 'r-chief', label: 'Руководитель', baseRole: 'director', appSections: ['stock', 'products'], money: false, stockViews: ['sheet'] };
  const page = await fixture(t, role, false, 'dark');
  assert.equal(await page.getByRole('checkbox', { name: 'Лазер лист', exact: true }).isChecked(), true);
  assert.equal(await page.getByRole('checkbox', { name: 'Труборез', exact: true }).isChecked(), false);
  assert.deepEqual(await page.evaluate(() => window.c240Body()), { label: 'Руководитель', appSections: ['stock', 'products'], stockViews: ['sheet'], baseRole: 'director', money: false });
  if (process.env.C240_PROOF_DIR) { await mkdir(process.env.C240_PROOF_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.C240_PROOF_DIR, 'role-stock-views-dark.png'), fullPage: true }); }
});

test('у встроенного директора виден режим умолчания и объяснение просмотра', async t => {
  const page = await fixture(t, { name: 'director', appSections: ['stock'] });
  assert.equal(await page.getByLabel('Дополнительные экраны склада', { exact: true }).inputValue(), 'inherit');
  assert.ok(await page.getByText('По умолчанию директор видит оба экрана;', { exact: false }).count());
  assert.ok(await page.getByText('Это не настройка прав на складские операции.', { exact: false }).count());
  if (process.env.C240_PROOF_DIR) { await mkdir(process.env.C240_PROOF_DIR, { recursive: true }); await page.screenshot({ path: path.join(process.env.C240_PROOF_DIR, 'role-stock-views-light.png'), fullPage: true }); }
});

test('classic helper подключён перед admin.js без async/module', async () => {
  const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(html, /<script src="role-stock-views\.js"><\/script>/);
  assert.ok(html.indexOf('src="role-stock-views.js"') < html.indexOf('src="admin.js"'));
});
