// C239: изолированная UI-фикстура; все сайт/документы/загрузки синтетические.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chromium } from '../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { createPult } from '../server.mjs';

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'pult-c239-ui-'));
const stateDir = path.join(temporary, 'state');
const output = path.resolve(process.env.DC_INTAKE_IMAGES_UI_PROOF || 'docs/crew/C239-intake-document-images/evidence/ui');
const owner = '111111111111111111111111';
const arrivalId = '00000000-0000-4000-8000-000000000001';
const confirmationId = '00000000-0000-4000-8000-000000000002';
const access = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: owner, exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.signature`;
// Только локальные принятые иллюстрации source-map; API и все операции остаются синтетическими.
const manifest = JSON.parse(await fs.readFile(new URL('../../docs/crew/C239-intake-document-images/manifest.json', import.meta.url), 'utf8'));
const contract = { id: manifest.target.contractId, number: manifest.target.contractNo, label: 'Договор № 18/11/44 · ООО «Бак-Строй»' };
assert.equal(contract.number, '18/11/44');
const assetPreviews = new Map();
const extractedRoot = path.resolve('docs/crew/C239-intake-document-images/evidence/extracted');
for (const asset of manifest.assets) {
  const filename = path.resolve(asset.path);
  assert.ok(filename.startsWith(extractedRoot + path.sep));
  const bytes = await fs.readFile(filename);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256);
  assetPreviews.set(asset.sha256, `data:image/${asset.format};base64,${bytes.toString('base64')}`);
}
const sourceItems = manifest.items.map((item, index) => ({ lineId: String(index + 100).padStart(24, '0'), sku: item.sku,
  title: item.sku === 'СК-001' ? 'СК-001 Парковая скамья со спинкой и деревянными элементами для благоустройства территории'
    : item.sku === 'УР-001' ? 'УР-001 Парковая урна с деревянной облицовкой и металлическим вкладышем — иллюстрация из исходного КП' : item.title,
  page: item.page, width: item.image.width, height: item.image.height, preview: assetPreviews.get(item.image.sha256) }));
assert.equal(sourceItems.length, 9); assert.equal(new Set(sourceItems.map(item => item.preview)).size, 8);
assert.equal(sourceItems.find(item => item.sku === 'ОГ-002').preview, sourceItems.find(item => item.sku === 'ОГ-004').preview);
const documentName = 'КП-0001 — ФАП Новобжегокай — со скамьями и урнами.pdf';
const injection = '<img src=x onerror="window.c239Injected=true">';
let sent = 0, prepared = 0, selectedContract = null, inject = false;
const preparedTargets = [];
await fs.mkdir(stateDir);
await fs.writeFile(path.join(stateDir, 'document-intake.json'), JSON.stringify({ root: temporary,
  apiBase: 'http://127.0.0.1:3102/api', modelBase: 'http://127.0.0.1:1235/v1', model: 'fixture' }));
const pult = createPult({ root: path.resolve(), stateDir, machine: {}, statusFn: async () => ({ gateFiles: [], branch: 'UI C239', docker: false }),
  documentIntake: { secureSession: null,
    fetchFn: async () => Response.json({ access, user: { id: owner, baseRole: 'manager', canMoney: true } }),
    engine: async () => ({ status: async () => ({ counts: { inbox: 0, processing: 0, ready: 0, question: 1 }, running: false }),
      reviewStatus: async () => ({ counts: { pending: 0, checked: 0, question: 1, uploaded: 0 }, items: [{ arrivalId, name: documentName, state: 'question', kind: 'offer', version: 1,
        hash: 'a'.repeat(64), issues: [{ code: 'QUESTION', message: 'Рисунки исходного документа прикрепляются отдельно.' }] }] }),
      searchImageContracts: async ({ search }) => { assert.equal(search, contract.number); return { items: [{ id: contract.id, label: contract.label }] }; },
      prepareDocumentImages: async ({ token, contractId }) => {
        assert.equal(await token(), access);
        if (contractId) { assert.equal(contractId, contract.id); selectedContract = contractId; }
        if (!selectedContract) return { selectionRequired: true };
        prepared++; preparedTargets.push(selectedContract);
        return {
        confirmationId, contractId: selectedContract, contractNo: contract.number, target: 'http://127.0.0.1:3102/api', uniqueImages: 8, alreadyAttached: sent ? 9 : 0,
        warnings: ['Иллюстрации исходного документа. Разрешение не увеличивается.'],
        items: sourceItems.map((item, index) => ({ ...item, title: inject && index === 0 ? item.title + ' ' + injection : item.title, alreadyAttached: Boolean(sent) })),
      }; },
      sendDocumentImages: async ({ token, confirmationId: id }) => { assert.equal(await token(), access); assert.equal(id, confirmationId); assert.equal(selectedContract, contract.id); sent++; return { attached: 9, added: 9 }; },
    }),
  } });
let browser;
try {
  await fs.mkdir(output, { recursive: true });
  const port = await pult.listen(0), origin = `http://127.0.0.1:${port}`;
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', error => { errors.push(error.name); console.error('Synthetic page error:', error.message); });
  await page.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
  await page.goto(origin);
  await page.getByRole('button', { name: /Разбор документов/ }).click();
  const aside = page.getByRole('complementary', { name: 'Настройки и отчёт разбора документов' });
  await aside.getByRole('button', { name: 'Настройки', exact: true }).click();
  await aside.getByRole('textbox', { name: 'Логин', exact: true }).fill('manager');
  await aside.getByLabel('Пароль', { exact: true }).fill('fixture-only-password');
  await aside.getByRole('button', { name: 'Войти', exact: true }).click();
  await aside.getByText('Вход выполнен.', { exact: true }).waitFor();
  await aside.getByRole('button', { name: 'Отчёт', exact: true }).click();
  const show = aside.getByRole('button', { name: 'Рисунки: ' + documentName, exact: true });
  await show.click();
  await aside.getByLabel('Номер договора').fill('18/11/44');
  await aside.getByRole('button', { name: 'Найти договор', exact: true }).click();
  await aside.getByRole('button', { name: contract.label, exact: true }).waitFor();
  await page.screenshot({ path: path.join(output, 'images-contract-selection-1440-light.png') });
  await aside.getByRole('button', { name: contract.label, exact: true }).click();
  await aside.getByText('Проверьте рисунки и позиции перед отправкой. Каталог изделий не изменяется.', { exact: true }).waitFor();
  await aside.getByText('Договор № 18/11/44 · Позиций: 9 · Рисунков: 8', { exact: true }).waitFor();
  assert.equal(preparedTargets[0], contract.id, 'Выбор и предпросмотр должны относиться к одному договору');
  assert.equal((await aside.innerText()).includes('Договор № 17'), false);
  const table = aside.getByRole('table', { name: 'Рисунки и исходные позиции договора' });
  assert.equal(await table.locator('tbody tr').count(), 9);
  assert.equal(await table.locator('img').count(), 9);
  assert.equal(new Set(await table.locator('img').evaluateAll(images => images.map(image => image.src))).size, 8);
  assert.equal(await table.locator('img[alt="ОГ-002"]').getAttribute('src'), await table.locator('img[alt="ОГ-004"]').getAttribute('src'));
  assert.equal(sent, 0); assert.equal(prepared, 1);
  const accept = aside.getByRole('button', { name: 'Загрузить рисунки', exact: true });
  const top = async filename => {
    await aside.getByRole('heading', { name: 'Рисунки из документа', exact: true }).evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: path.join(output, filename) });
  };
  const bottom = async filename => {
    await accept.evaluate(element => element.scrollIntoView({ block: 'end' }));
    const last = await table.locator('tbody tr').last().boundingBox();
    const button = await accept.boundingBox();
    assert.ok(last && last.y >= 0 && last.y + last.height <= page.viewportSize().height + 1, 'В кадре целиком видна девятая строка');
    assert.ok(button && button.y >= 0 && button.y + button.height <= page.viewportSize().height + 1, 'В кадре видна кнопка подтверждения');
    await page.screenshot({ path: path.join(output, filename) });
  };
  await top('images-preview-1440-light.png');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1024, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await top('images-preview-1024-dark.png');
  await bottom('images-preview-1024-dark-bottom.png');
  await accept.click();
  await aside.getByText('Рисунки проверены у 9 позиций. Новых привязок: 9.', { exact: true }).waitFor();
  assert.equal(sent, 1);
  await show.click();
  await aside.getByText('Все рисунки уже прикреплены. Повторная загрузка не нужна.', { exact: true }).waitFor();
  assert.equal(await accept.isDisabled(), true);
  assert.equal(await table.getByText('Уже прикреплён', { exact: true }).count(), 9);
  assert.ok(preparedTargets.every(id => id === contract.id));
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await top('images-existing-1440-light.png');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 1024, height: 1000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await top('images-existing-1024-dark.png');
  await bottom('images-existing-1024-dark-bottom.png');
  // Проверка экранирования выполняется отдельно от снимков штатных девяти строк.
  inject = true;
  await show.click();
  await table.getByText(sourceItems[0].title + ' ' + injection, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => Boolean(window.c239Injected)), false);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'fixture-proof.json'), JSON.stringify({ synthetic: true, contract,
    selectedTargetIds: preparedTargets, rows: sourceItems.length, uniqueImages: assetPreviews.size,
    sharedAssetSkus: ['ОГ-002', 'ОГ-004'], sourceMap: 'C239/manifest.json', stressLongTitles: ['СК-001', 'УР-001'],
    sent, xssBlocked: true, screenshots: 7, bottomShowsNinthRowAndConfirmation: true }, null, 2) + '\n');
  console.log('PASS C239: единый договор 18/11/44 · Бак-Строй; 9 строк/8 рисунков; light/dark top/bottom; выбор, отправка, повтор, XSS. Изолированная фикстура.');
} finally {
  await browser?.close(); await pult.close();
  assert.equal(path.dirname(temporary), await fs.realpath(os.tmpdir()));
  assert.ok(path.basename(temporary).startsWith('pult-c239-ui-'));
  await fs.rm(temporary, { recursive: true, force: true });
}
