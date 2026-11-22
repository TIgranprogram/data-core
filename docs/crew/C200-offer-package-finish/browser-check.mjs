import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

// Принимает сессию фикстуры только в памяти. Печать идёт в PDF одноразового профиля Chrome.
export async function run({ chromium, executablePath, auth, base, proof, names, workDir = tmpdir() }) {
  assert.equal(base, 'http://127.0.0.1:62061');
  assert.equal(names.length, 3);
  await mkdir(proof, { recursive: true });
  const profileParent = await realpath(workDir);
  const profile = await mkdtemp(join(profileParent, 'c200-pdf-'));
  const spool = join(profile, 'pdf');
  await mkdir(spool);
  await mkdir(join(profile, 'Default'));
  const destination = { id: 'Save as PDF', origin: 'local', account: '' };
  const appState = JSON.stringify({ version: 2, recentDestinations: [destination], selectedDestinationId: destination.id, isHeaderFooterEnabled: false });
  await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify({ printing: { print_preview_sticky_settings: { appState } },
    savefile: { default_directory: spool }, download: { default_directory: spool, prompt_for_download: false } }));
  const ctx = await chromium.launchPersistentContext(profile, {
    executablePath, downloadsPath: spool, acceptDownloads: true, headless: false,
    args: ['--kiosk-printing', '--window-position=-20000,-20000'], viewport: { width: 1440, height: 940 }, serviceWorkers: 'block',
  });
  try {
    await ctx.addInitScript(({ access, refresh, user }) => {
      if (window !== window.top || location.origin !== 'http://127.0.0.1:62061') return;
      sessionStorage.setItem('dca_access', access);
      sessionStorage.setItem('dca_refresh', refresh);
      sessionStorage.setItem('dca_user', JSON.stringify(user));
    }, auth);
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base + '/app/#products?all=1&view=table');
    for (let n = 1; n <= 16; n++) {
      const title = 'Скамья серии ' + String(n).padStart(2, '0');
      await page.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'В КП', exact: true }).click();
    }
    await page.getByRole('button', { name: 'КП (16)', exact: true }).click();
    await page.getByPlaceholder('Кому: заказчик').fill('Парковая мастерская — образец');
    const first = page.locator('.kp-line').filter({ hasText: 'Скамья серии 01' });
    await first.getByLabel('Количество', { exact: true }).fill('2');
    await first.getByLabel('Цена', { exact: true }).fill('1450');
    await page.getByRole('button', { name: 'Собрать пакет КП' }).click();
    const pct = [0, 3, 5];
    for (const [i, name] of names.entries()) {
      const pick = page.getByRole('group', { name: 'Фирмы', exact: true }).getByRole('button', { name, exact: true });
      if (await pick.getAttribute('aria-pressed') !== 'true') await pick.click();
      await page.getByLabel('Наценка для ' + name + ', %').fill(String(pct[i]));
    }
    const res = page.waitForResponse((r) => r.url().endsWith('/api/offers/pack') && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Создать 3 КП', exact: true }).click();
    const created = await res;
    assert.equal(created.status(), 201, await created.text());
    const { items } = await created.json();
    assert.equal(items.length, 3);
    assert.equal(new Set(items.map((i) => i.packId)).size, 1);
    assert.equal(new Set(items.map((i) => i.number)).size, 3);
    const download = page.getByRole('button', { name: 'Скачать ZIP (3 PDF)', exact: true });
    await download.scrollIntoViewIfNeeded();
    await page.waitForFunction(() => document.querySelectorAll('.toasts .toast').length === 0);
    await page.screenshot({ path: join(proof, 'package-browser.png') });
    const [zip] = await Promise.all([page.waitForEvent('download'), download.click()]);
    await zip.saveAs(join(proof, 'package.zip'));
    const reports = [];
    for (const [i, name] of names.entries()) {
      const offer = items.find((o) => o.companyName === name);
      assert(offer);
      let expectedTotal = 0;
      assert.equal(offer.items.length, 16);
      for (const [j, row] of offer.items.entries()) {
        const basePrice = j === 0 ? 1450 : 1100 + 100 * j;
        const expectedPrice = Math.round(basePrice * (100 + pct[i]) / 100);
        assert.equal(row.productName, 'Скамья серии ' + String(j + 1).padStart(2, '0'));
        assert.equal(row.quantity, j === 0 ? 2 : 1);
        assert.equal(row.unitPrice, expectedPrice);
        expectedTotal += expectedPrice * row.quantity;
      }
      assert.equal(offer.total, expectedTotal);
      // После открытия соседнего КП остальные остаются доступными в его блоке «Пакет».
      if (page.url().split('open=')[1]?.split('&')[0] !== offer.id) {
        const current = page.getByText(name, { exact: true }).last();
        await current.locator('xpath=ancestor::*[.//button[normalize-space()="Открыть"]][1]').getByRole('button', { name: 'Открыть', exact: true }).click();
        await page.waitForURL((url) => url.hash.includes('open=' + offer.id));
      }
      await page.getByRole('button', { name: 'Открыть в редакторе', exact: true }).click();
      const editor = page.locator('.offer-editor');
      await editor.getByText(offer.number, { exact: true }).waitFor();
      await editor.getByText('Сохранённая версия', { exact: true }).waitFor();
      const sheets = await editor.getByText(/^Лист 1 из /).textContent();
      const count = Number(sheets.match(/из (\d+)/)[1]);
      assert(count > 1);
      await editor.getByRole('button', { name: 'Печать', exact: true }).click();
      let filename;
      for (let n = 0; n < 100; n++) {
        const pdf = (await readdir(spool)).find((f) => f.toLowerCase().endsWith('.pdf'));
        if (pdf && (await readFile(join(spool, pdf))).includes(Buffer.from('%%EOF'))) { filename = pdf; break; }
        await page.waitForTimeout(200);
      }
      assert(filename, 'Chrome не создал печатный PDF');
      await copyFile(join(spool, filename), join(proof, 'printed-' + (i + 1) + '.pdf'));
      await rm(join(spool, filename));
      reports.push({ company: name, markup: pct[i], number: offer.number, total: expectedTotal, pages: count });
      await editor.getByRole('button', { name: 'Закрыть', exact: true }).click();
    }
    assert.deepEqual(errors, []);
    return reports;
  } finally {
    await ctx.close();
    const actualProfile = await realpath(profile);
    assert.equal(actualProfile, profile);
    assert.equal(dirname(actualProfile), profileParent);
    assert(/^c200-pdf-[A-Za-z0-9]{6}$/.test(basename(actualProfile)));
    await rm(actualProfile, { recursive: true, force: true });
  }
}
