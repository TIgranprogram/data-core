import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { chromium } from '../../../../tools/design-checks/node_modules/playwright-core/index.mjs';
import { findBrowser } from '../../../../tools/browser-path.mjs';

const root = new URL('../../', import.meta.url);
const evidence = new URL('../../../../tools/logs/c170-folder-geometry/', import.meta.url);

test('folderTile: длинные русские имена, метаданные и действия не сжимаются в колонках225/320', async () => {
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const errors = [], apiCalls = [];
  try {
    await mkdir(evidence, { recursive: true });
    const page = await browser.newPage({ viewport: { width: 1024, height: 1000 } });
    page.setDefaultTimeout(4000);
    page.on('pageerror', (error) => errors.push(error.message));
    // Тот же route-fixture, что auto-more.test: реальные модули/CSS, без сервера, входа и API.
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== 'http://folder.test' || url.pathname.startsWith('/api/')) {
        apiCalls.push(url.pathname); return route.abort();
      }
      if (url.pathname === '/app/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="ru"><head><meta charset="utf-8"><link rel="stylesheet" href="/app/ui/tokens.css"><link rel="stylesheet" href="/app/ui/base.css"><link rel="stylesheet" href="/app/ui/list.css"><link rel="stylesheet" href="/app/ui/panels.css"><link rel="stylesheet" href="/app/ui/kit/kit.css"></head><body><main></main></body></html>' });
      if (!url.pathname.startsWith('/app/') || url.pathname.includes('..')) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: await readFile(new URL(url.pathname.slice(5), root)) });
    });
    await page.goto('http://folder.test/app/');
    await page.evaluate(async () => {
      const { folderTile } = await import('/app/ui/kit/folder-tile.js');
      window.actions = { download: 0, select: 0 };
      document.querySelector('main').append(folderTile({ name: 'Паспорта и декларации', open: true, files: [
        { id: '1', name: 'Декларация.песочница.jpg', meta: 'Изделие · 280 КБ', onDownload: () => window.actions.download++, action: { label: 'Использовать как паспорт', onClick: () => window.actions.select++ } },
        { id: '2', name: 'Паспорт тренажёра с длинным русским названием и обозначением изделия № 123-456.pdf', meta: 'Позиция заказа · 2,4 МБ', onDownload: () => window.actions.download++, action: { label: 'Использовать как паспорт', onClick: () => window.actions.select++ } },
      ] }));
    });
    for (const theme of ['light', 'dark']) for (const width of [225, 320]) {
      await page.evaluate(({ width, theme }) => {
        document.documentElement.dataset.theme = theme;
        Object.assign(document.querySelector('main').style, { width: `${width}px`, margin: '24px' });
      }, { width, theme });
      const rects = await page.locator('.k-folder').evaluate((folder) => {
        const rect = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        return { folder: rect(folder), overflow: folder.scrollWidth - folder.clientWidth, rows: [...folder.querySelectorAll('.k-folder-file')].map((row) => ({
          row: rect(row), overflow: row.scrollWidth - row.clientWidth, name: rect(row.querySelector('.k-folder-name')),
          buttons: [...row.querySelectorAll('button')].map(rect),
        })) };
      });
      for (const [index, row] of rects.rows.entries()) {
        const where = `${theme}/${width}/файл${index + 1}`;
        assert.ok(row.name.width >= width * .6, `${where}: имя сжато до${row.name.width}px`);
        assert.ok(row.overflow <= 1 && rects.overflow <= 1, `${where}: горизонтальный overflow`);
        for (const button of row.buttons) {
          assert.ok(button.width > 0 && button.height > 0, `${where}: действие невидимо`);
          assert.ok(button.left >= row.row.left - 1 && button.right <= row.row.right + 1, `${where}: действие вышло из строки`);
          assert.ok(button.top >= row.name.bottom - 1, `${where}: действие перекрывает имя или metadata`);
        }
        const [a, b] = row.buttons;
        assert.ok(a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1, `${where}: действия перекрываются`);
      }
      const first = page.locator('.k-folder-file').first();
      await first.getByRole('button', { name: 'Скачать', exact: true }).click();
      await first.getByRole('button', { name: 'Использовать как паспорт', exact: true }).click();
      await page.locator('main').screenshot({ path: new URL(`${theme}-${width}.png`, evidence).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    }
    assert.deepEqual(await page.evaluate(() => window.actions), { download: 4, select: 4 });
    assert.deepEqual(apiCalls, []); assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
