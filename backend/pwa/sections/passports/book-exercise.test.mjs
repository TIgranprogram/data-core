import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../../tools/browser-path.mjs';

const root = new URL('../../', import.meta.url), origin = 'http://c236.test';
const pilots = JSON.parse(await readFile(new URL('../../../../docs/crew/C236-trainer-exercise-instructions/PILOT-CONTENT.json', import.meta.url)));
const keys = ['initialPosition', 'movement', 'muscles'];
const content = Object.fromEntries(keys.map(key => [key, pilots.items[0][key]]));
let browser;
before(async () => { browser = await chromium.launch({ executablePath: findBrowser(), headless: true }); });
after(async () => { await browser?.close(); });

async function fixture(t, { theme = 'light', exercise = content, role = 'manager', instance = false, conflict = false, sku = '1067', variant = 'short', withoutUse = false } = {}) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, serviceWorkers: 'block' });
  t.after(() => page.close()); page.setDefaultTimeout(5000);
  const errors = [], calls = [];
  page.on('pageerror', e => errors.push(e.message));
  const template = { mode: 'template', productId: 'product-' + sku, variant, passportCategory: 'TRN', product: { name: 'Жим ногами' }, defaults: { foundationDepth: 0, ...(exercise ? { exerciseInstructions: structuredClone(exercise) } : {}) },
    document: { id: 'template-' + sku, article: sku, name: sku === '1069' ? 'Скороход двойной — черновик' : 'Жим ногами', passportCategory: 'TRN', status: 'draft' },
    textSnapshot: { layout: 2, description: 'Тренажёр для мышц ног.', rules: ['Сохраняйте устойчивое положение.', 'Без рывков.', 'Осмотр перед занятием.', 'Остановите подвижные части.'], sections: [{ key: 'use', title: 'Правила пользования', number: '1', items: Array.from({ length: 11 }, (_, i) => ({ key: 'use-' + i, text: 'Общее правило ' + (i + 1), number: '1.' + (i + 1), src: 'all' })) }], ...(exercise ? { exerciseInstructions: { ...exercise, source: { kind: 'product', productId: 'product-' + sku } } } : {}) }, readiness: { ready: true, missing: [], requiredImages: [], imageSlots: [] } };
  const person = { id: 'fixture', role, username: 'fixture', sections: ['products', 'docs'] };
  if (withoutUse) template.textSnapshot.sections = [];
  template.document.name = pilots.items.find(item => item.sku === sku)?.name || template.document.name;
  await page.addInitScript(({ person, theme }) => { localStorage.setItem('dc-theme', theme); localStorage.setItem('dca_user', JSON.stringify(person)); localStorage.setItem('dca_access', 'fixture'); localStorage.setItem('dca_refresh', 'fixture'); }, { person, theme });
  const html = await readFile(new URL('index.html', root), 'utf8');
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === '/app/fixture.html') return route.fulfill({ contentType: 'text/html', body: html.replace(/<script type="module" src="main.js"><\/script>/, '') });
    if (url.pathname.startsWith('/api/')) {
      const method = route.request().method();
      calls.push({ path: url.pathname, query: url.search, method, body: route.request().postDataJSON() });
      if (url.pathname.includes('/passport-template')) {
        if (method === 'PATCH') {
          if (conflict) return route.fulfill({ status: 409, json: { message: 'Другой редактор изменил инструкцию. Ваш текст сохранён в форме.' } });
          const change = route.request().postDataJSON().changes.exerciseInstructions;
          if (change === null) { delete template.defaults.exerciseInstructions; delete template.textSnapshot.exerciseInstructions; }
          else { template.defaults.exerciseInstructions = change; template.textSnapshot.exerciseInstructions = { ...change, source: { kind: 'product', productId: template.productId } }; }
        }
        template.variant = url.searchParams.get('variant') || template.variant;
        return route.fulfill({ json: template });
      }
      if (url.pathname === '/api/passports/instance') return route.fulfill({ json: { ...template.document, id: 'instance', presentationVersion: 1, variant, productId: template.productId, textSnapshot: template.textSnapshot, readiness: template.readiness } });
      return route.fulfill({ json: { items: [], total: 0 } });
    }
    const file = url.pathname.slice('/app/'.length), type = { js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml', png: 'image/png', woff2: 'font/woff2' }[file.split('.').pop()];
    try { return route.fulfill({ contentType: type || 'text/plain', body: await readFile(new URL(file, root)) }); } catch { return route.fulfill({ status: 404 }); }
  });
  await page.goto(origin + '/app/fixture.html');
  await page.evaluate(async ({ template, instance }) => {
    window.c236Current = true;
    const { openBookEditor } = await import('./sections/passports/book-editor.js');
    await openBookEditor(instance ? 'instance' : null, { template: instance ? null : template, isCurrent: () => window.c236Current });
  }, { template, instance });
  await page.locator('.bk').waitFor();
  const writes = () => calls.filter(call => call.method !== 'GET');
  const open = () => page.getByRole('button', { name: exercise ? 'Изменить инструкцию упражнения' : 'Добавить инструкцию упражнения', exact: true }).click();
  const save = () => page.getByRole('button', { name: 'Сохранить в шаблон', exact: true }).click();
  return { page, template, calls, errors, writes, open, save };
}

async function proof(page, name) {
  if (!process.env.C236_PROOF_DIR) return;
  await page.evaluate(async () => { await document.fonts.ready; document.querySelectorAll('.bk-side-slot textarea').forEach(el => { el.scrollTop = 0; }); });
  await mkdir(process.env.C236_PROOF_DIR, { recursive: true });
  await page.screenshot({ path: path.join(process.env.C236_PROOF_DIR, name + '.png'), fullPage: true });
}

for (const theme of ['light', 'dark']) test('настоящая книжка: три части, общий текст, редактор и raw CAS — ' + theme, async t => {
  const raw = { ...content, initialPosition: '  ' + content.initialPosition + '\r\n\r\nОстановитесь.  ' };
  const f = await fixture(t, { theme, exercise: raw });
  assert.equal(await f.page.locator('.bk-pages').getByRole('heading', { name: 'Инструкция упражнения', exact: true }).count(), 1);
  for (const label of ['Исходное положение', 'Движения и завершение', 'Задействованные мышцы']) assert.equal(await f.page.locator('.bk-pages').getByRole('heading', { name: label, exact: true }).count(), 1);
  assert.equal(await f.page.locator('.bk-pages p').filter({ hasText: /Общее правило \d+$/ }).count(), 11);
  await f.open();
  assert.equal(await f.page.getByLabel('Исходное положение', { exact: true }).inputValue(), raw.initialPosition.replace(/\r\n/g, '\n'));
  await f.page.getByLabel('Движения и завершение', { exact: true }).fill(content.movement + '\n\nПлавно остановитесь.');
  await proof(f.page, 'exercise-editor-' + theme);
  await f.save();
  await f.page.waitForFunction(() => !document.querySelector('.bk-side-slot textarea'));
  assert.equal(f.writes().length, 1);
  assert.deepEqual(f.writes()[0].body.expected, { exerciseInstructions: raw });
  assert.equal(f.writes()[0].body.changes.exerciseInstructions.initialPosition, raw.initialPosition.replace(/\r\n/g, '\n').trim());
  assert.equal(f.template.defaults.foundationDepth, 0);
  assert.deepEqual(f.errors, []);
});

test('пустой 1069 не заполняется; валидация частей/HTML/4000 без truncate, отмена без записи', async t => {
  const f = await fixture(t, { exercise: null, sku: '1069' });
  assert.equal(await f.page.locator('.bk-pages').getByText('Исходное положение', { exact: true }).count(), 0);
  await f.open(); await f.save();
  await f.page.getByRole('alert').filter({ hasText: 'Исходное положение: заполните поле' }).waitFor();
  await proof(f.page, 'exercise-draft-empty-light');
  for (const [key, label] of [['initialPosition', 'Исходное положение'], ['movement', 'Движения и завершение'], ['muscles', 'Задействованные мышцы']]) await f.page.getByLabel(label, { exact: true }).fill(key === 'initialPosition' ? '<b>Текст</b>' : 'Текст');
  await f.save(); await f.page.getByRole('alert').filter({ hasText: 'без HTML' }).waitFor();
  await f.page.getByLabel('Исходное положение', { exact: true }).fill('я'.repeat(3991)); // +5+5 = 4001.
  await f.save(); await f.page.getByRole('alert').filter({ hasText: 'общий лимит 4000' }).waitFor();
  assert.equal(await f.page.getByLabel('Исходное положение', { exact: true }).inputValue(), 'я'.repeat(3991));
  await proof(f.page, 'exercise-validation-light');
  assert.equal(f.writes().length, 0);
  await f.page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await f.page.getByRole('button', { name: 'Выйти', exact: true }).click();
  assert.equal(f.writes().length, 0);
});

test('409 сохраняет введённый текст и исходный baseline', async t => {
  const f = await fixture(t, { conflict: true }); await f.open();
  await f.page.getByLabel('Исходное положение', { exact: true }).fill('Мой набранный текст');
  await f.save(); await f.page.getByRole('alert').filter({ hasText: 'Другой редактор' }).waitFor();
  await proof(f.page, 'exercise-conflict-light');
  assert.equal(await f.page.getByLabel('Исходное положение', { exact: true }).inputValue(), 'Мой набранный текст');
  assert.deepEqual(f.writes()[0].body.expected, { exerciseInstructions: content });
});

test('явное удаление очищает только блок после подтверждения', async t => {
  const f = await fixture(t); await f.open();
  await f.page.getByRole('button', { name: 'Удалить инструкцию', exact: true }).click();
  assert.equal(f.writes().length, 0);
  await f.page.locator('.modal-back:not(.bk-back)').getByRole('button', { name: 'Удалить инструкцию', exact: true }).click();
  await f.page.waitForFunction(() => !document.querySelector('.bk-side-slot textarea'));
  assert.deepEqual(f.writes()[0].body, { expected: { exerciseInstructions: content }, changes: { exerciseInstructions: null } });
  assert.equal(f.template.defaults.foundationDepth, 0);
  assert.equal(await f.page.getByRole('button', { name: 'Добавить инструкцию упражнения', exact: true }).count(), 1);
});

for (const instance of [true, false]) test('экземпляр только читает; observer не редактирует шаблон: ' + instance, async t => {
  const f = await fixture(t, { instance, role: instance ? 'manager' : 'viewer' });
  assert.equal(await f.page.locator('.bk-pages').getByRole('heading', { name: 'Инструкция упражнения', exact: true }).count(), 1);
  assert.equal(await f.page.getByRole('button', { name: /(?:Изменить|Добавить) инструкцию упражнения/ }).count(), 0);
  assert.equal(f.writes().length, 0);
});

test('4000 символов сохраняются целиком, первый baseline null; full без use показывает блок один раз', async t => {
  const f = await fixture(t, { exercise: null, sku: '1068', variant: 'full', withoutUse: true }); await f.open();
  await f.page.getByLabel('Исходное положение', { exact: true }).fill('я'.repeat(3990));
  await f.page.getByLabel('Движения и завершение', { exact: true }).fill('Текст');
  await f.page.getByLabel('Задействованные мышцы', { exact: true }).fill('Текст');
  await f.save(); await f.page.waitForFunction(() => !document.querySelector('.bk-side-slot textarea'));
  assert.deepEqual(f.writes()[0].body.expected, { exerciseInstructions: null });
  assert.equal(keys.reduce((n, key) => n + f.writes()[0].body.changes.exerciseInstructions[key].length, 0), 4000);
  assert.equal(await f.page.locator('.bk-pages').getByRole('heading', { name: 'Инструкция упражнения', exact: true }).count(), 1);
  assert.equal(f.writes()[0].query, '?variant=full');
});

test('смена варианта спрашивает о правке, новый вариант не получает черновик; уход с SKU блокирует stale save', async t => {
  const f = await fixture(t); await f.open();
  await f.page.getByLabel('Исходное положение', { exact: true }).fill('Несохранённый черновик');
  await f.page.getByRole('button', { name: 'Полный', exact: true }).click();
  await f.page.getByRole('button', { name: 'Отмена', exact: true }).last().click();
  assert.equal(await f.page.getByLabel('Исходное положение', { exact: true }).inputValue(), 'Несохранённый черновик');
  await f.page.getByRole('button', { name: 'Полный', exact: true }).click();
  await f.page.getByRole('button', { name: 'Выйти', exact: true }).click();
  await f.page.waitForFunction(() => !document.querySelector('.bk-side-slot textarea'));
  await f.open();
  assert.equal(await f.page.getByLabel('Исходное положение', { exact: true }).inputValue(), content.initialPosition);
  assert.equal(f.calls.filter(call => call.method === 'GET' && call.path.includes('/passport-template')).at(-1).query, '?variant=full');
  await f.page.evaluate(() => { window.c236Current = false; });
  await f.save(); await f.page.getByRole('alert').filter({ hasText: 'Форма устарела' }).waitFor();
  assert.equal(f.writes().length, 0);
});


