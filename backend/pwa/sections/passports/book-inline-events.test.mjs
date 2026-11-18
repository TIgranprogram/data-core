import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { findBrowser } from '../../../../tools/browser-path.mjs';
import { passportNamePatch } from './book-inline-events.js';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require(process.env.C115_PLAYWRIGHT || '../../../../tools/design-checks/node_modules/playwright-core')); }
catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }

test('клик в поле и по сохранению не открывает родительское поле повторно', { skip: !chromium && 'нет playwright-core' }, async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="name" tabindex="0"><span>Название</span></div>');
    const source = readFileSync(new URL('./book-inline-events.js', import.meta.url), 'utf8');
    await page.evaluate(async (source) => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      const { bindBookInlineEvents } = await import(url);
      URL.revokeObjectURL(url);
      window.opens = 0; window.saves = 0;
      bindBookInlineEvents(document.querySelector('#name'), () => { window.opens++; });
    }, source);
    await page.getByText('Название', { exact: true }).click();
    assert.equal(await page.evaluate(() => window.opens), 1);
    await page.evaluate(() => {
      document.querySelector('#name').innerHTML = '<div class="bk-ed"><textarea aria-label="Название">Старое</textarea><button>Сохранить</button></div>';
      document.querySelector('button').onclick = () => { window.saves++; };
    });
    await page.getByRole('textbox').click();
    await page.getByRole('textbox').fill('Новое название');
    await page.getByRole('textbox').click();
    await page.getByRole('button', { name: 'Сохранить' }).click();
    assert.deepEqual(await page.evaluate(() => [window.opens, window.saves]), [1, 1]);
    await page.locator('#name').focus();
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => window.opens), 2);
  } finally { await browser.close(); }
});

test('своё имя паспорта сохраняет прочие ручные поля и не меняет исходный объект', () => {
  const row = { name: 'Каталожное', manualText: ['purpose', 'name'] };
  assert.deepEqual(passportNamePatch(row, 'Название заказа'), { name: 'Название заказа', manualText: ['purpose', 'name'] });
  assert.equal(row.name, 'Каталожное');
  assert.deepEqual(passportNamePatch({}, 'Новое'), { name: 'Новое', manualText: ['name'] });
});
