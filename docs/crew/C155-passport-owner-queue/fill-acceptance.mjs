// Только GET на изолированной копии. Запуск через api.sh stand BROWSER.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const fromLogs = path.basename(path.dirname(script)) === 'logs';
const guard = fromLogs ? '../../docs/crew/C155-passport-owner-queue/acceptance.test.mjs' : './acceptance.test.mjs';
const { runFocusedAcceptance } = await import(guard);

await runFocusedAcceptance('fill', async ({ app, page, read, check, at, expect, need, objectId, screenshot }) => {
  await check('fill-composition-1067', async (result) => {
    const catalog = await read('/api/showcase?search=1067&limit=30');
    const row = catalog.items.find((item) => String(item.sku).trim() === '1067');
    need(objectId(row?.id), 'Изделие 1067 отсутствует на копии или менеджеру недоступно.');
    const queue = await read('/api/showcase/' + row.id + '/fill-queue');
    const first = queue.items[0];
    const composition = queue.items.find((item) => item.key === 'composition');
    need(composition?.label === 'Состав изделия', 'У 1067 в очереди нет пункта «Состав изделия».');
    const primary = first.key === 'composition';
    result.queue = { first: first.key, label: first.label, compositionEntry: primary ? 'Что дальше' : 'Ещё' };
    await page.goto(app + '#products');
    await at(result, 'Найти 1067 в «Продукции»', async () => {
      await page.getByPlaceholder('Поиск: наименование, артикул, серия…').fill('1067');
      const gallery = page.locator(`button.gcard[data-id="${row.id}"]`);
      const table = page.locator('tr[data-i]').filter({ hasText: '1067' }).filter({ hasText: row.name });
      await gallery.or(table).first().click();
    });
    const drawer = page.locator('aside.drawer:visible').last();
    const comp = drawer.getByRole('tab', { name: /^Состав и работы/ });
    const files = drawer.getByRole('tab', { name: /^Файлы/ });
    const summary = drawer.locator('summary').filter({ has: page.getByText('Состав', { exact: true }) });
    const detail = summary.locator('xpath=..');
    const more = drawer.locator('summary .form-sec-t').filter({ hasText: /^Ещё [0-9]+$/ }).locator('xpath=..');
    const fill = drawer.locator('button[title="Заполнить: Состав изделия"]').filter({ hasText: /^Заполнить$/ });
    const edit = detail.getByRole('button', { name: 'Изменить состав', exact: true });
    const privateFields = '.drawer [data-k="infoCard"], .drawer .k-pane .k-row-meta, .drawer .k-pane p:has(> b), .drawer .money { visibility: hidden !important; }';
    await comp.click();
    await summary.waitFor();
    if (await detail.evaluate((node) => node.open)) await summary.click();
    expect(!await detail.evaluate((node) => node.open), 'Исходный блок «Состав» не свёрнут.');
    result.rounds = [];
    async function checkOpen(label) {
      try {
        if (!primary) {
          await at(result, label + ' — раскрыть «Ещё»', async () => {
            await more.waitFor({ state: 'visible', timeout: 8_000 });
            if (!await more.evaluate((node) => node.parentElement.open)) await more.click();
          });
        }
        await at(result, label + ' — дождаться кнопки', () => fill.waitFor({ state: 'visible', timeout: 8_000 }));
        await at(result, label + ' — клик', () => fill.click());
        await at(result, label + ' — раскрытие', () => edit.waitFor({ state: 'visible', timeout: 12_000 }));
        await at(result, label + ' — фокус в видимой области', () => page.waitForFunction(() => {
          const active = document.activeElement;
          if (!active?.matches('.drawer .k-pane details[open] button') || active.textContent.trim() !== 'Изменить состав') return false;
          const button = active.getBoundingClientRect();
          const scroller = active.closest('.drawer-body')?.getBoundingClientRect();
          return button.top >= Math.max(0, scroller?.top ?? 0) && button.bottom <= Math.min(innerHeight, scroller?.bottom ?? innerHeight);
        }, null, { timeout: 12_000 }));
        expect(await detail.evaluate((node) => node.open) && await comp.getAttribute('aria-selected') === 'true',
          'Кнопка «Заполнить» не раскрыла состав на правильной вкладке.');
        result.rounds.push({ label, open: true, visible: true, focused: true, inViewport: true });
      } catch (error) {
        result.diagnostic = await drawer.evaluate((node) => {
          const btn = [...node.querySelectorAll('button')].find((item) => item.textContent.trim() === 'Изменить состав');
          const active = document.activeElement;
          return { titles: [...node.querySelectorAll('button[title^="Заполнить"]')].map((item) => item.title),
            detailsOpen: btn?.closest('details')?.open ?? null, editExists: !!btn, editInPane: !!btn?.closest('.k-pane'),
            activeIsEdit: !!btn && active === btn, activeTag: active?.tagName,
            selectedTabs: [...node.querySelectorAll('[role="tab"][aria-selected="true"]')].map((item) => item.textContent.trim()) };
        });
        await screenshot('fill-failure', drawer, privateFields).then(() => { result.failureImage = 'acceptance-fill-failure.png'; }, () => {});
        throw error;
      }
    }
    await checkOpen('Нажать «Заполнить» на вкладке «Состав и работы» со свёрнутым составом');
    await checkOpen('Нажать «Заполнить» повторно');
    await files.click();
    expect(await files.getAttribute('aria-selected') === 'true', 'Вкладка «Файлы» не переключилась.');
    await checkOpen('Нажать «Заполнить» со вкладки «Файлы»');
    result.images = [];
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('dc-theme', value);
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      await screenshot('fill-' + theme, drawer, privateFields);
      result.images.push('acceptance-fill-' + theme + '.png');
    }
    await at(result, 'Открыть штатный редактор состава', () => edit.click());
    const editor = drawer.filter({ has: page.getByRole('heading', { name: 'Состав изделия', exact: true }) });
    await editor.getByRole('button', { name: 'Сохранить состав', exact: true }).waitFor();
    await editor.getByText(/Изделие «/).filter({ hasText: row.name }).waitFor();
    await at(result, 'Выйти из редактора без сохранения', async () => {
      await editor.getByRole('button', { name: 'Отмена', exact: true }).click();
      const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Отменить изменения?', exact: true }) });
      await confirm.getByRole('button', { name: 'Да, отменить', exact: true }).click();
      await editor.waitFor({ state: 'detached' });
    });
    result.editor = { openedForProduct: true, cancelled: true };
  });
}, script);
