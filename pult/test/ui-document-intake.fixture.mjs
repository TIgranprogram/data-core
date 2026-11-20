// Приёмка интерфейса через реальный локальный сервер пульта. Вход, выбор папки и обработка заменены фикстурой.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { createPult } from '../server.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pult-intake-ui-'));
const root = path.resolve('docs/crew/C169-local-document-intake');
const documents = process.platform === 'win32' ? 'C:\\DataCore\\Договоры и коммерческие предложения' : '/DataCore/Договоры и коммерческие предложения';
const report = {
  counts: { inbox: 3, processing: 0, ready: 1, question: 1 },
  items: [
    { name: 'Заказчик Сфера — КП 71, редакция 2.pdf', state: 'ready', outcome: 'duplicate' },
    { arrivalId: '00000000-0000-4000-8000-000000000001', name: 'Счёт поставщика 2456 от 16.11.2026.pdf', state: 'question', message: 'Для счёта поставщика требуется сверка позиций.', action: 'Откройте оригинал в «Сомнительных» и добавьте проверенные позиции в Снабжение.' },
  ],
};
let picked = false;
let opened = [];
let resumed;
let retried;
const engine = {
  async configure({ root: value }) { return { root: value, folders: {} }; },
  async status() { return report; },
  async report() { return report; },
  async run({ onProgress, signal }) {
    report.counts = { inbox: 2, processing: 1, ready: 1, question: 1 };
    onProgress({ processed: 1, total: 3, current: 'Договор 4 — Установка оборудования в мастерской, приложение и спецификация.pdf', state: 'processing' });
    await new Promise((resolve) => signal.addEventListener('abort', resolve, { once: true }));
    return { ...report, stopped: { code: 'ABORTED' } };
  },
  async retry({ arrivalIds }) {
    retried = arrivalIds;
    report.items = report.items.map(item => arrivalIds.includes(item.arrivalId) ? { ...item, state: 'ready', outcome: 'imported' } : item);
    report.counts.question = 0; report.counts.ready++;
    return report;
  },
  async resume({ onProgress }) {
    onProgress({ processed: 1, total: 1, state: 'ready' });
    report.counts = { inbox: 2, processing: 0, ready: 2, question: 1 };
    report.items = [{ name: 'Договор 4 — Установка оборудования в мастерской.pdf', state: 'ready', outcome: 'imported' }, ...report.items];
    resumed = true;
    return report;
  },
};
const pult = createPult({
  root: path.resolve(), stateDir: temporary, machine: {}, statusFn: async () => ({ gateFiles: [], branch: 'проверка', docker: false }),
  documentIntake: {
    engine: async () => engine,
    fetchFn: async () => Response.json({ access: 'fixture-browser-access', refresh: 'fixture-browser-refresh', user: { role: 'manager' } }),
    pickFolder: async () => picked ? documents : '',
    openFolder: async (value) => opened.push(value),
  },
});

let browser;
try {
  const port = await pult.listen(0);
  const origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', (route) => route.request().url().startsWith(`${origin}/`) ? route.continue() : route.abort());
  await page.goto(`${origin}/`);
  await page.getByRole('button', { name: /Разбор документов/ }).click();
  await page.getByText('Начните с выбора папки.').waitFor();
  const control = (name) => page.getByRole('main').getByRole('button', { name, exact: true });
  const sidebar = page.getByRole('complementary', { name: 'Настройки и отчёт разбора документов' });
  const sideButton = (name) => sidebar.getByRole('button', { name, exact: true });
  assert.ok(await control('Разобрать').isDisabled());
  assert.ok(await control('Возобновить').isDisabled());
  assert.ok(await control('Открыть входящие').isDisabled());
  assert.ok(await sideButton('Войти').isDisabled());
  await control('Отчёт').click();
  await sidebar.getByText('Выберите папку, чтобы открыть её отчёт.').waitFor();
  await control('Папка…').click();
  await page.getByText('Папка осталась прежней.').waitFor();
  picked = true;
  await control('Папка…').click();
  await page.getByText(documents, { exact: true }).waitFor();
  await Promise.all([page.waitForResponse('**/api/document-intake/inbox'), control('Открыть входящие').click()]);
  assert.deepEqual(opened, [path.join(documents, 'Inbox')]);

  await sideButton('Настройки').click();
  const apiBase = sidebar.getByLabel('Адрес сайта', { exact: true });
  await apiBase.fill('https://fixture-outside.invalid/api');
  await sideButton('Сохранить настройки').click();
  await sidebar.getByText('Укажите рабочий сайт или адрес локальной копии', { exact: false }).waitFor();
  await sideButton('Рабочий сайт').click();
  assert.equal(await apiBase.inputValue(), 'https://kppdf-crm.ru/db/api');
  await sideButton('Тестовая копия на этом ПК').click();
  assert.equal(await apiBase.inputValue(), 'http://127.0.0.1:3102/api');
  await sideButton('Сохранить настройки').click();
  await sidebar.getByText('Настройки сохранены.').waitFor();
  await page.getByText('Локальная копия', { exact: true }).waitFor();
  await sidebar.getByLabel('Логин', { exact: true }).fill('учебный-менеджер');
  const password = sidebar.getByLabel('Пароль', { exact: true });
  await password.fill('fixture-browser-password');
  const response = page.waitForResponse('**/api/document-intake/login');
  await sideButton('Войти').click();
  assert.deepEqual(await (await response).json(), { signedIn: true });
  await sidebar.getByText('Вход выполнен.', { exact: false }).waitFor();
  assert.equal(await password.inputValue(), '');
  assert.doesNotMatch(await page.content(), /fixture-browser-(password|access|refresh)/);
  assert.doesNotMatch(await fs.readFile(path.join(temporary, 'document-intake.json'), 'utf8'), /fixture-browser-(password|access|refresh)/);
  assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('fixture-browser')), false);
  await page.screenshot({ path: path.join(root, 'pult-settings-1440-light.png') });

  await control('Разобрать').click();
  await page.getByText('Обработано 1 из 3', { exact: true }).waitFor();
  await sidebar.getByText('Нужна проверка · 1').waitFor();
  await page.screenshot({ path: path.join(root, 'pult-progress-1440-light.png') });
  assert.ok(await control('Разобрать').isDisabled());
  await page.reload();
  await page.getByText('Обработано 1 из 3', { exact: true }).waitFor();
  await control('Остановить').click();
  await page.getByText('Разбор остановлен.', { exact: false }).waitFor();
  await Promise.all([page.waitForResponse('**/api/document-intake/question'), sideButton('Открыть сомнительные').click()]);
  assert.equal(opened.at(-1), path.join(documents, 'Question'));
  await control('Возобновить').click();
  await sidebar.getByText('Договор 4 — Установка оборудования в мастерской.pdf', { exact: true }).waitFor();
  assert.equal(resumed, true);
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await sideButton('Повторить выбранные').waitFor();
  assert.ok(await sideButton('Повторить выбранные').isDisabled());
  await sidebar.getByRole('checkbox', { name: /Повторить: Счёт поставщика/ }).check();
  assert.ok(await sideButton('Повторить выбранные').isEnabled());
  await page.screenshot({ path: path.join(root, 'pult-report-1024-dark.png') });
  await sideButton('Повторить выбранные').click();
  await sidebar.getByText('Готово · 3', { exact: true }).waitFor();
  assert.deepEqual(retried, ['00000000-0000-4000-8000-000000000001']);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.log('PASS: пустая форма, отмена папки, адрес, вход, ход, перезагрузка, остановка, возобновление и исключения. 3 снимка.');
} finally {
  await browser?.close();
  await pult.close();
  await fs.rm(temporary, { recursive: true, force: true });
}
