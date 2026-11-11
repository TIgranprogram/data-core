import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright-core';
import { formControlSnapshot, formControlFindings } from '../site-audit.mjs';

const require = createRequire(import.meta.url);
const edge = process.env.DESIGN_BROWSER || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(p => fs.existsSync(p));

test('реальный браузер: старые голые поля не проходят, исправленные проходят; axe ловит отсутствие имени', { skip: !edge, timeout: 30000 }, async () => {
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.abort());
    await page.setContent('<html lang="ru"><head><title>Проверка формы</title></head><body><main><div class="drawer"><section class="k-sec"><div id="fields"><div><select><option>Выберите</option></select></div><div><select aria-label="Категория"><option>Выберите</option></select></div></div></section></div></main><style>select{display:block;width:180px;height:36px} label{display:block} .fixed{display:grid;gap:12px}</style></body></html>');
    const scan = `(${formControlSnapshot.toString()})()`;
    const broken = formControlFindings(await page.evaluate(scan));
    assert.equal(broken.filter(x => x.rule === 'fl').length, 2);
    assert.equal(broken.filter(x => x.rule === 'fg').length, 1);
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const axeBefore = await page.evaluate(async () => (await axe.run(document, { runOnly: ['select-name'] })).violations);
    assert.equal(axeBefore.length, 1);
    await page.evaluate(() => {
      const box = document.getElementById('fields'); box.className = 'fixed';
      box.innerHTML = '<label>Категория<select><option>Благоустройство</option></select></label><label>Тип изделия<select><option>Указатель</option></select></label>';
    });
    assert.deepEqual(formControlFindings(await page.evaluate(scan)), []);
    const axeAfter = await page.evaluate(async () => (await axe.run(document, { runOnly: ['select-name'] })).violations);
    assert.equal(axeAfter.length, 0);
    for (const html of [
      '<label><span style="display:none">Категория</span><select><option>Выберите</option></select></label>',
      '<label style="opacity:0" for="x">Категория</label><select id="x"><option>Выберите</option></select>',
    ]) {
      await page.evaluate(html => { document.getElementById('fields').innerHTML = html; }, html);
      assert.ok(formControlFindings(await page.evaluate(scan)).some(x => x.rule === 'fl'), 'Скрытая подпись не видима');
    }
  } finally { await browser.close(); }
});
