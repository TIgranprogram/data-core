// C171: реальный HTTP-сервер Пульта; вход, анализ и модель заменены обезличенной fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { createPult } from '../server.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pult-c171-ui-'));
const output = path.resolve('docs/crew/C171-document-intake-review');
const documents = process.platform === 'win32' ? 'C:\\DataCore\\Проверка счетов' : '/DataCore/Проверка счетов';
const owner = 'synthetic-manager'; const target = 'http://127.0.0.1:3102/api';
const arrivalId = '00000000-0000-4000-8000-000000000001';
const name = 'Счёт поставщика 2456 от 20.11.2026 — оборудование мастерской.pdf';
const suspicious = '<img src=x onerror="window.c171Injected=true">';
const issue = { code: 'QUESTION', message: 'Не подтверждено поле «Итог».', action: 'Сверьте итог счёта с оригиналом.' };
const pages = ['Счёт № 2456 от 20.11.2026\nПоставщик ООО Альфа ИНН 7707083893\nПлательщик ООО Бета ИНН 7702070139\nУрна 2 шт 50,00 100,00\nВсего 100,00 руб. Без НДС\n' + suspicious];
const raw = {
  kind: 'supplier_invoice', kindEvidence: { page: 1, quote: 'Счёт № 2456 от 20.11.2026' },
  number: { value: '2456', page: 1, quote: 'Счёт № 2456 от 20.11.2026' },
  date: { value: '2026-11-20', page: 1, quote: 'Счёт № 2456 от 20.11.2026' },
  seller: { name: 'ООО Альфа', inn: '7707083893', page: 1, quote: 'Поставщик ООО Альфа ИНН 7707083893' },
  buyer: { name: 'ООО Бета', inn: '7702070139', page: 1, quote: 'Плательщик ООО Бета ИНН 7702070139' },
  currency: { value: 'RUB', page: 1, quote: 'руб.' }, gross: { value: 101, page: 1, quote: 'Всего 100,00 руб.' },
  vat: { mode: 'none', rate: null, amount: null, page: 1, quote: 'Без НДС' },
  lines: [{ title: 'Урна', qty: 2, unit: 'шт', unitPrice: 50, amount: 100, page: 1, quote: 'Урна 2 шт 50,00 100,00' }],
};
const review = { counts: { pending: 0, checked: 1, question: 1, uploaded: 0 }, items: [
  { arrivalId, name, state: 'question', version: 2, hash: 'a'.repeat(64), issues: [issue] },
  { arrivalId: '00000000-0000-4000-8000-000000000002', name: 'Счёт 2457 — проверен локально.pdf', state: 'checked', version: 1, hash: 'b'.repeat(64), issues: [] },
] };
let picked = false; const opened = []; let analyses = 0; let drafts = 0;
let preparations = 0; let releasePreparation;
const preparationOnly = process.argv.includes('--preparation-only');
const deliveryOnly = process.argv.includes('--delivery-only');
let sends = 0;
const componentSteps = [
  { id: 'windows', title: 'Windows' }, { id: 'disk', title: 'Место для оригиналов и черновиков' },
  { id: 'pdf', title: 'Чтение текстового PDF' }, { id: 'model', title: 'Ответ локальной модели по схеме' },
  { id: 'datacore', title: 'Контур DataCore и права' },
];
const access = `${Buffer.from('{"alg":"test"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 3600, role: 'manager', version: 1 })).toString('base64url')}.test`;
const engine = {
  async configure({ root }) { return { root, folders: {} }; },
  async status() { return { counts: { inbox: 3, processing: 0, ready: 0, question: 0 }, running: false }; },
  async report() { return { counts: {}, items: [] }; },
  async reviewStatus(binding) { assert.equal(binding.owner, owner); assert.equal(binding.target, target); return review; },
  async getDraft({ arrivalId: selected }) { assert.equal(selected, arrivalId); drafts++; return { owner, target, arrivalId, name, version: 2, state: 'question', pages, raw, issues: [issue] }; },
  async prepareBatch() {
    return { id: arrivalId, target, items: [{ name: review.items[1].name, version: 1 }], problems: [] };
  },
  async sendBatch({ confirmationId }) {
    assert.equal(confirmationId, arrivalId); sends++;
    review.items[1].state = 'uploaded'; review.counts.uploaded = 1; review.counts.checked = 0;
    return { uploaded: 1, problems: [] };
  },
  async analyze({ onProgress, signal }) {
    analyses++;
    onProgress({ processed: 1, total: 3, current: name, stage: 'proposing', state: 'processing', lastEventAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() });
    if (analyses === 1) {
      await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      return { ...review, stopped: { code: 'ABORTED' } };
    }
    return { ...review, processed: 3, total: 3 };
  },
};
const pult = createPult({
  root: path.resolve(), stateDir: temporary, machine: {}, statusFn: async () => ({ gateFiles: [], branch: 'UI C171', docker: false }),
  documentIntake: {
    engine: async () => engine,
    prepare: async ({ onStep }) => {
      preparations++;
      if (preparations === 1) {
        onStep?.({ id: 'model', title: 'Ответ локальной модели по схеме', status: 'checking' });
        await new Promise(resolve => { releasePreparation = resolve; });
        const step = { id: 'model', title: 'Ответ локальной модели по схеме', status: 'blocked', recovery: 'Запустите локальную модель и повторите проверку.' };
        onStep?.(step); return { ready: false, steps: [step] };
      }
      const steps = componentSteps.map(step => ({ ...step, status: 'ready' }));
      for (const step of steps) onStep?.(step);
      return { ready: true, steps };
    },
    fetchFn: async () => Response.json({ access, user: { id: owner, role: 'manager', canMoney: true } }),
    pickFolder: async () => picked ? documents : '', openFolder: async value => opened.push(value),
  },
});

let browser;
try {
  await fs.mkdir(output, { recursive: true });
  const port = await pult.listen(0); const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const errors = []; const actions = [];
  const screenshot = (name, changed = false) => !deliveryOnly && (!preparationOnly || changed) ? page.screenshot({ path: path.join(output, name) }) : Promise.resolve();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().includes('/api/document-intake/')) actions.push(request.url().split('/').at(-1)); });
  await page.route('**/*', route => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  await page.goto(origin); await page.getByRole('button', { name: /Разбор документов/ }).click();
  const control = name => page.getByRole('main').getByRole('button', { name, exact: true });
  const aside = page.getByRole('complementary', { name: 'Настройки и отчёт разбора документов' });
  const sideButton = name => aside.getByRole('button', { name, exact: true });
  await page.getByText('Начните с выбора папки.').waitFor();
  for (const name of ['Разобрать', 'Возобновить', 'Открыть входящие']) assert.ok(await control(name).isDisabled());
  await control('Отчёт').click(); await aside.getByText('Выберите папку, чтобы открыть её отчёт.').waitFor();
  await control('Папка…').click(); await page.getByText('Папка осталась прежней.').waitFor();
  picked = true; await control('Папка…').click(); await page.getByText(documents, { exact: true }).waitFor();
  await Promise.all([page.waitForResponse('**/api/document-intake/inbox'), control('Открыть входящие').click()]);
  assert.deepEqual(opened, [path.join(documents, 'Inbox')]);
  await sideButton('Настройки').click();
  await aside.getByLabel('Адрес сайта', { exact: true }).fill('https://fixture-outside.invalid/api');
  await sideButton('Сохранить настройки').click(); await aside.getByText('Укажите рабочий сайт или адрес локальной копии', { exact: false }).waitFor();
  await sideButton('Тестовая копия на этом ПК').click();
  await sideButton('Сохранить настройки').click(); await aside.getByText('Настройки сохранены.').waitFor();
  await aside.getByLabel('Логин', { exact: true }).fill('учебный-менеджер');
  await aside.getByLabel('Пароль', { exact: true }).fill('fixture-c171-password');
  await sideButton('Войти').click(); await aside.getByText('Вход выполнен.', { exact: false }).waitFor();
  assert.equal(await aside.getByLabel('Пароль', { exact: true }).inputValue(), '');
  assert.doesNotMatch(await page.content(), /fixture-c171-password/);
  assert.doesNotMatch(await fs.readFile(path.join(temporary, 'document-intake.json'), 'utf8'), /fixture-c171-password/);
  await control('Разобрать').click();
  await page.getByRole('main').getByText('Проверяется', { exact: true }).waitFor();
  await screenshot('ui-preparation-progress-1440-light.png', true);
  releasePreparation();
  await page.getByRole('main').getByText('Нужна подготовка', { exact: true }).waitFor();
  await page.getByRole('main').getByText('Запустите локальную модель и повторите проверку.', { exact: true }).waitFor();
  assert.equal(analyses, 0);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.setViewportSize({ width: 1024, height: 1000 });
  await screenshot('ui-preparation-blocked-1024-dark.png', true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 1440, height: 1000 });
  await control('Возобновить').click();
  await page.getByText('Проверено 1 из 3', { exact: true }).waitFor();
  assert.equal(await page.getByRole('main').getByText('Проверено', { exact: true }).count(), 5);
  await aside.getByText('На проверку · 1', { exact: true }).waitFor();
  await screenshot('ui-progress-1440-light.png');
  assert.ok(await control('Разобрать').isDisabled());
  await page.reload(); await page.getByText('Проверено 1 из 3', { exact: true }).waitFor();
  await control('Остановить').click(); await page.getByText('Разбор остановлен.', { exact: false }).waitFor();
  await control('Возобновить').click(); await page.getByText('Проверка завершена.', { exact: false }).waitFor();
  assert.equal(analyses, 2);
  await aside.getByRole('button', { name: `Сверить: ${name}`, exact: true }).click();
  await aside.getByText('Версия 2.', { exact: false }).waitFor();
  await screenshot('ui-draft-top-1440-light.png');
  const number = aside.getByRole('button', { name: /Источник поля «Номер»/ });
  await number.focus(); await page.keyboard.press('Enter');
  await aside.getByText('Страница 1', { exact: true }).waitFor();
  await aside.getByText('Текст исходной страницы', { exact: true }).click();
  await aside.getByText(suspicious, { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => !!window.c171Injected), false); assert.equal(await aside.locator('img').count(), 0);
  await screenshot('ui-draft-1440-light.png');
  await page.emulateMedia({ colorScheme: 'dark' }); await page.setViewportSize({ width: 1024, height: 1000 });
  await aside.getByRole('button', { name: 'Источник позиции 1', exact: true }).click();
  await aside.getByText('Урна 2 шт 50,00 100,00', { exact: true }).waitFor();
  await screenshot('ui-draft-1024-dark.png');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await sideButton('К списку документов').click();
  await aside.getByText('Проверено локально · 1', { exact: true }).waitFor();
  await screenshot('ui-report-1024-dark.png');
  assert.equal(await page.getByRole('button', { name: /Подтвердить отправку|Повторить выбранные/ }).count(), 0);
  assert.equal(await page.getByText('Готово к отправке', { exact: false }).count(), 0);
  assert.equal(actions.some(action => ['run', 'resume', 'retry'].includes(action)), false);
  await control('Отправить готовые…').click();
  await aside.getByText('Готово к отправке · 1').waitFor();
  await aside.getByText('Контур ' + target).waitFor();
  assert.equal(sends, 0);
  await sideButton('Отмена').click(); assert.equal(sends, 0);
  await control('Отправить готовые…').click(); await sideButton('Подтвердить отправку').waitFor();
  await page.screenshot({ path: path.join(output, 'ui-delivery-confirmation-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 1440, height: 1000 });
  await sideButton('Подтвердить отправку').focus(); await page.keyboard.press('Enter');
  await aside.getByText('Загруженные · 1').waitFor();
  assert.equal(sends, 1);
  await page.screenshot({ path: path.join(output, 'ui-delivery-receipt-light.png') });
  await aside.getByRole('button', { name: `Сверить: ${name}`, exact: true }).click();
  await aside.getByText('Версия 2.', { exact: false }).waitFor();
  await sideButton('Настройки').click(); await sideButton('Выйти').click();
  await sideButton('Войти').waitFor();
  await sideButton('Отчёт').click();
  await aside.getByText('Войдите в учётную запись менеджера в настройках, чтобы открыть локальные черновики.').waitFor();
  assert.equal((await aside.textContent()).includes(name), false);
  assert.ok(drafts >= 1); assert.deepEqual(errors, []);
  console.log('PASS C171: подготовка, сверка, отмена и подтверждение отправки, отчёт. Синтетический обработчик.');
} finally {
  await browser?.close(); await pult.close();
  assert.equal(path.dirname(temporary), await fs.realpath(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('pult-c171-ui-'));
  await fs.rm(temporary, { recursive: true, force: true });
}
