// Менеджер изолированной копии. Запуск только через проверенный api.sh stand BROWSER.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const shared = path.basename(path.dirname(script)) === 'logs'
  ? '../../docs/crew/C155-passport-owner-queue/acceptance.test.mjs'
  : '../C155-passport-owner-queue/acceptance.test.mjs';
const { runFocusedAcceptance } = await import(shared);
const orderId = '6aff0bcb34de43c56e5ac570';
const approvedLineId = '6aff1ada34de43c56e5acb25';
const lineId = process.env.C159_QA_LINE_ID;
const targetId = '6ae1269ae36900370537a2f3';
const matchId = '6adaff0f2a8dad6034b14522';
const photoId = process.env.C159_QA_PHOTO_ID;
const noPhotoId = process.env.C159_QA_NO_PHOTO_ID || matchId;
const bind = process.env.C159_BIND === '1';
const bindMatching = process.env.C159_MATCH === '1';
const matchOnly = process.env.C159_MATCH_ONLY === '1';
const zoomOnly = process.env.C159_ZOOM_ONLY === '1';
const versionText = process.env.C159_QA_VERSION || '';
const important = ['title', 'qty', 'unit', 'amount', 'amountManual', 'unitPrice', 'paidAmount', 'paidDate',
  'orderId', 'orderNo', 'companyId', 'companyName', 'productionNo', 'customer', 'paymentForm'];
const maskZoomBackground = 'body > :not(.lightbox) { visibility: hidden !important; }';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fields = (row) => important.map((key) => row[key] ?? null);
const escapeRegex = (part) => String(part).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

await runFocusedAcceptance(zoomOnly ? 'c159-zoom' : matchOnly ? 'c159-match' : 'c159', async ({
  app, page, button, read, listen, json, screenshot, check, at, expect, need, objectId, exactBody, grant,
}) => {
  await check('order-product-picker', async (result) => {
    expect(objectId(lineId) && (!matchOnly || bindMatching) && (!photoId || objectId(photoId)) && (!noPhotoId || objectId(noPhotoId))
      && (!(bind || bindMatching) || (lineId === approvedLineId && /^[0-9]+$/.test(versionText))),
    'Нужен согласованный id QA позиции, для записи также подтверждённая версия.');
    if (zoomOnly) expect(lineId === approvedLineId && !bind && !bindMatching && !matchOnly, 'Для просмотра фото разрешено только чтение QA позиции.');
    const linePath = '/api/incomes/' + lineId;
    const order = await read('/api/salesorders/' + orderId);
    const before = await read(linePath);
    expect(order.orderNo === 'QA-C155-ORDER-1119' && before.id === lineId && before.orderId === orderId
      && before.title === 'QA C159 — выбор изделия' && Number.isInteger(before.version)
      && (!before.productId || [targetId, matchId].includes(before.productId)), 'Запись не совпадает с выделенной QA позицией, её заказом или исходной связью.');
    const writeAllowed = bind && !matchOnly && !before.productId;
    if (writeAllowed) expect(before.version === Number(versionText), 'Версия QA позиции изменилась до прогонки.');
    result.fixture = { orderId, lineId, targetId, matchId, version: before.version, alreadyLinked: before.productId || null };
    const target = await read('/api/showcase/' + targetId);
    const drawer = page.locator('aside[data-k="drawer"]:visible').filter({ has: page.getByRole('heading', { name: 'Выбрать изделие', exact: true }) });
    const orderDrawer = page.locator('aside[data-k="drawer"]:visible').filter({ has: page.getByRole('heading', { name: /Позиция №/ }) });
    const matching = page.locator('aside[data-k="drawer"]:visible').filter({ has: page.getByRole('heading', { name: /^Договор / }) });
    const table = drawer.getByRole('table', { name: 'Изделия', exact: true });
    const productRow = (id) => table.locator(`tr[data-id="${id}"]:visible`);
    const query = drawer.getByRole('textbox', { name: 'Поиск изделий', exact: true });
    const save = button(drawer, 'Привязать изделие');
    const cancel = button(drawer, 'Отмена');
    const advance = (label, run) => at(result, label, async () => {
      try { return await run(); }
      catch (error) {
        if (await drawer.count() === 1 && await drawer.isVisible()) {
          result.diagnostic = { visibleRows: await table.locator('tr[data-id]:visible').count(),
            inputPresent: await query.count() === 1, confirmEnabled: await save.count() === 1 && await save.isEnabled() };
          const name = zoomOnly ? 'picker-zoom-failure' : matchOnly ? 'picker-matching-failure' : 'picker-failure';
          await screenshot(name, drawer).then(() => { result.failureImage = 'acceptance-' + name + '.png'; }, () => {});
        } else if (matchOnly || zoomOnly) {
          result.diagnostic = await page.evaluate(() => {
            const [section, options = ''] = location.hash.slice(1).split('?');
            const params = new URLSearchParams(options);
            return { section, of: params.get('of'), drawers: document.querySelectorAll('aside.drawer').length,
              matchingRows: document.querySelectorAll('.mt tr[data-id]').length };
          });
          const parent = page.locator('aside[data-k="drawer"]:visible').last();
          if (await parent.isVisible()) await screenshot('picker-matching-parent-failure', parent,
            'aside.drawer .form-block:not(:has(.mt)), aside.drawer .t-sub, aside.drawer .drawer-sub { visibility: hidden !important; }')
            .then(() => { result.failureImage = 'acceptance-picker-matching-parent-failure.png'; }, () => {});
        }
        throw error;
      }
    });
    const captureThemes = async (name, scope = drawer, privacyStyle = '') => {
      const files = [];
      for (const theme of ['light', 'dark']) {
        await page.evaluate((value) => {
          localStorage.setItem('dc-theme', value);
          document.documentElement.setAttribute('data-theme', value);
        }, theme);
        await screenshot('picker-' + name + '-' + theme, scope, privacyStyle);
        files.push('acceptance-picker-' + name + '-' + theme + '.png');
      }
      return files;
    };

    async function openPicker(current = false) {
      if (current) {
        await button(orderDrawer, 'Ещё действия').click();
        await page.getByRole('menuitem', { name: 'Сменить изделие', exact: true }).click();
      } else await button(orderDrawer, 'Выбрать изделие').click();
      await drawer.waitFor();
      await query.waitFor();
    }

    async function catalog(action, selected = {}) {
      const pending = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.pathname === '/api/showcase' && response.request().method() === 'GET'
          && Number(url.searchParams.get('limit') || 50) > 1
          && Object.entries(selected).every(([key, value]) => url.searchParams.get(key) === value);
      }, { timeout: 15_000 }).catch(() => null);
      await action();
      return json(pending, 'Загрузка списка изделий');
    }
    const search = (text) => catalog(() => query.fill(text), { search: text });

    async function filter(name, label, queryFields) {
      const control = drawer.getByRole('combobox', { name, exact: true });
      return catalog(async () => {
        await control.click();
        await drawer.getByRole('option', { name: new RegExp('^' + escapeRegex(label) + '(?:\\s+\\([0-9]+\\))?$') }).click();
      }, queryFields);
    }

    if (zoomOnly) {
      expect(before.productId === matchId, 'Текущая связь QA позиции не соответствует ожидаемой 1067.');
      await advance('Открыть каталог из «Сопоставления» и найти 1066', async () => {
        const request = listen('GET', '/api/matching/suggest', { orderId });
        await page.goto(app + '#salesorders?of=matching&open=' + orderId, { waitUntil: 'domcontentloaded' });
        const related = await json(request, 'Список позиций сопоставления');
        const item = related.items.find((candidate) => candidate.lineId === lineId);
        expect(item?.state === 'confirmed' && item.productId === matchId, 'Сопоставление QA позиции с 1067 не подтверждено.');
        const row = matching.locator(`tr[data-id="${lineId}"]`);
        await button(row, 'Заменить из каталога').click();
        await drawer.waitFor();
        const current = drawer.locator('section').filter({ has: page.getByRole('heading', { name: 'Текущее изделие', exact: true }) });
        await current.getByText('1067', { exact: true }).waitFor();
        await findProduct(target);
      });
      const sourcePhoto = button(productRow(targetId), 'Открыть фото крупно');
      const dialog = page.getByRole('dialog', { name: 'Фото', exact: true });
      const closeZoom = button(dialog, 'Закрыть фото');
      await advance('Открыть крупное фото и проверить кнопку закрытия', async () => {
        await sourcePhoto.click();
        await closeZoom.waitFor({ state: 'visible' });
        await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"][aria-label="Фото"] img')]
          .some((image) => image.complete && image.naturalWidth > 0));
        result.zoomImages = await captureThemes('zoom', dialog, maskZoomBackground);
      });
      await advance('Нажать «Закрыть фото» и проверить возврат фокуса', async () => {
        await closeZoom.click();
        await dialog.waitFor({ state: 'detached' });
        await page.waitForFunction((id) => {
          const row = document.activeElement?.closest('tr[data-id]');
          return row?.dataset.id === id && document.activeElement.getAttribute('aria-label') === 'Открыть фото крупно';
        }, targetId);
        expect(!await save.isEnabled(), 'Просмотр фото изменил выбранное изделие.');
      });
      await advance('Показать пробный выбор 1066 в обеих темах и отменить', async () => {
        await productRow(targetId).click();
        await drawer.getByText('Выбранное изделие', { exact: true }).waitFor();
        result.matchingImages = await captureThemes('matching-current-selected');
        await cancel.click();
        await drawer.waitFor({ state: 'detached' });
        const current = await read(linePath);
        expect(current.productId === before.productId && current.version === before.version && same(fields(current), fields(before)),
          'Просмотр или закрытие изменили QA позицию.');
        result.zoom = { closeVisible: true, dialogClosed: true, focusReturned: true, currentLinkUnchanged: true };
      });
      return;
    }
    if (matchOnly) {
      if (before.productId === matchId) result.matching = { skipped: 'Сопоставление уже сохранено.' };
      else await checkMatching();
      return;
    }
    const groups = await read('/api/showcase/groups');
    await page.goto(app + '#orders?open=' + lineId, { waitUntil: 'domcontentloaded' });
    await advance('Открыть правую панель из карточки позиции', () => openPicker(!!before.productId));
    await table.waitFor();
    const loadMore = button(drawer, 'Показать ещё');
    await advance('Загрузить вторую страницу каталога', async () => {
      await loadMore.waitFor();
      const first = await table.locator('tr[data-id]').evaluateAll((rows) => rows.map((row) => row.dataset.id));
      const more = await catalog(() => loadMore.click(), { page: '2' });
      await productRow(more.items[0].id).waitFor();
      const after = await table.locator('tr[data-id]').evaluateAll((rows) => rows.map((row) => row.dataset.id));
      expect(after.length > first.length && first.every((id) => after.includes(id)) && new Set(after).size === after.length,
        'Вторая страница заменила первую, потеряла результаты или повторила карточки.');
      result.pages = { initial: first.length, afterMore: after.length, total: more.total };
    });
    const found = await advance('Найти похожие изделия запросом «жим»', () => search('жим'));
    expect(found.total >= 2 && found.items.length >= 2, 'Поиск «жим» не показал несколько похожих изделий.');
    await productRow(found.items[0].id).waitFor();
    result.searchHits = found.total;
    const fromSearch = photoId ? found.items.find((item) => item.id === photoId)
      : found.items.find((item) => typeof item.photo === 'string' || item.photo?.thumb || item.photo?.url);
    const photoProduct = fromSearch || (photoId ? await read('/api/showcase/' + photoId) : null);
    need(photoProduct, 'Для поиска «жим» нет согласованной позиции с фото на копии.');
    await advance('Увеличить фото, затем закрыть просмотр клавишей Escape', async () => {
      if (!fromSearch) await search(String(photoProduct.sku ?? photoProduct.name));
      const photo = button(productRow(photoProduct.id), 'Открыть фото крупно');
      await photo.waitFor();
      const previewChoice = await save.isEnabled();
      await photo.click();
      const dialog = page.getByRole('dialog', { name: 'Фото', exact: true });
      await dialog.waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"][aria-label="Фото"] img')]
        .some((image) => image.complete && image.naturalWidth > 0));
      await screenshot('picker-enlarged-photo', dialog, maskZoomBackground);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      expect(await save.isEnabled() === previewChoice && await drawer.getByText('Выбранное изделие', { exact: true }).count() === 0,
        'Просмотр фото изменил выбор изделия.');
      result.photo = { id: photoProduct.id, enlarged: true, selected: false };
      if (!fromSearch) await search('жим');
    });
    await productRow(found.items[0].id).waitFor();
    result.listImages = await captureThemes('search');
    const byGroup = new Map(groups.map((group) => [group.id, group]));
    const groupPath = (id) => {
      const chain = [];
      for (let node = byGroup.get(id); node && chain.length < 6; node = byGroup.get(node.parentId)) chain.unshift(node);
      return chain;
    };
    const usableFilter = (item) => item.series && groupPath(item.groupId).length > 1;
    let featured = found.items.find(usableFilter);
    let filterSearch = 'жим';
    if (!featured) {
      const facets = await read('/api/showcase?facets=1&limit=1');
      for (const option of (facets.facets?.series || []).slice(0, 5)) {
        const bySeries = await read('/api/showcase?series=' + encodeURIComponent(option.value) + '&limit=20');
        featured = bySeries.items.find(usableFilter);
        if (featured) break;
      }
      need(featured, 'Среди доступных серий не найдено изделие с разделом и группой.');
      filterSearch = String(featured.sku ?? featured.name);
      const exact = await search(filterSearch);
      expect(exact.items.some((item) => item.id === featured.id), 'Изделие для проверки фильтров не найдено по артикулу.');
    }
    const [section, group] = groupPath(featured.groupId);
    await advance('Выбрать раздел, зависимую группу и серию', async () => {
      await filter('Раздел', section.name, { search: filterSearch, groupId: section.id });
      await filter('Группа', group.name, { search: filterSearch, groupId: group.id });
      const params = { search: filterSearch, groupId: group.id, series: featured.series };
      const narrowed = await filter('Серия', featured.series, params);
      expect(narrowed.total > 0 && narrowed.items.every((item) => item.series === featured.series),
        'Результаты после выбора серии ей не соответствуют.');
      await productRow(narrowed.items[0].id).waitFor();
      const refreshed = await catalog(() => button(drawer, 'Обновить каталог').click(), params);
      expect(refreshed.total > 0 && await query.inputValue() === filterSearch, 'Обновление каталога сбросило применённый поиск или фильтры.');
      await catalog(() => button(drawer, 'Сбросить фильтры').click(), { search: null, groupId: null, series: null });
      result.filters = { section: true, group: true, series: true, refreshed: true, reset: true, count: narrowed.total, alternativeFixture: filterSearch !== 'жим' };
    });

    if (noPhotoId) {
      const withoutPhoto = await read('/api/showcase/' + noPhotoId);
      const emptyPhoto = await search(String(withoutPhoto.sku ?? withoutPhoto.name));
      expect(emptyPhoto.items.some((item) => item.id === noPhotoId), 'Изделие для проверки заглушки скрыто из выдачи.');
      await productRow(noPhotoId).getByText(/^нет фото$/i).waitFor();
      result.placeholder = true;
    } else need(false, 'Не указан согласованный пример изделия без доступного фото.');

    await advance('Проверить пустую выдачу и возврат к поиску', async () => {
      const empty = await search('zzc159qanosuchelementzzz');
      expect(empty.total === 0, 'Критерий пустой выдачи вернул изделия.');
      await drawer.getByText('Изделия не найдены', { exact: true }).waitFor();
      result.empty = true;
    });

    async function findProduct(item) {
      const matches = await search(String(item.sku ?? item.name));
      expect(matches.items.some((candidate) => candidate.id === item.id), 'Согласованное изделие отсутствует при точном поиске.');
      await productRow(item.id).waitFor();
    }
    await advance('Выбрать точное изделие клавишей Enter и отменить', async () => {
      const trial = before.productId ? found.items.find((item) => item.id !== before.productId) : target;
      expect(trial, 'Для повторного просмотра нет альтернативного изделия, которое можно отменить.');
      await findProduct(trial);
      await productRow(trial.id).press('Enter');
      await drawer.getByText('Выбранное изделие', { exact: true }).waitFor();
      if (!before.productId) expect(await save.isEnabled(), 'Подтверждение после выбора недоступно.');
      result.selectionImages = await captureThemes('selected');
      await cancel.click();
      await drawer.waitFor({ state: 'detached' });
      const afterCancel = await read(linePath);
      expect(afterCancel.version === before.version && afterCancel.productId === before.productId && same(fields(afterCancel), fields(before)),
        'Предпросмотр, выбор или отмена изменили позицию.');
      result.cancelled = true;
    });

    if (writeAllowed) {
      await advance('Заново открыть панель и явно подтвердить привязку', async () => {
        await openPicker();
        await findProduct(target);
        await productRow(targetId).click();
        await drawer.getByText('Выбранное изделие', { exact: true }).waitFor();
        const pending = listen('PATCH', linePath);
        grant('PATCH', linePath, (body, url) => !url.search && exactBody(body, { productId: targetId, version: before.version }));
        await save.click();
        const saved = await json(pending, 'Сохранение связи изделия');
        result.patchAccepted = true;
        expect(saved.id === lineId && saved.productId === targetId && saved.version === before.version + 1 && same(fields(saved), fields(before)),
          'Ответ PATCH содержит неверное изделие, версию или изменённые сведения позиции.');
        await drawer.waitFor({ state: 'detached' });
        const actual = await read(linePath);
        expect(actual.id === lineId && actual.productId === targetId && actual.version === saved.version && same(fields(actual), fields(before)),
          'Контрольный GET не подтвердил связь и прежние реквизиты позиции.');
        result.saved = { productId: targetId, version: actual.version, bindingRequests: 1, preservedFields: important };
      });
    }
    if (writeAllowed || before.productId) {
      await advance('Открыть смену изделия и проверить текущую связь', async () => {
        const currentId = writeAllowed ? targetId : before.productId;
        const currentProduct = currentId === targetId ? target : await read('/api/showcase/' + currentId);
        await orderDrawer.locator(`a[href="#products?open=${currentId}"]`).waitFor();
        await openPicker(true);
        const summary = drawer.locator('section').filter({ has: page.getByRole('heading', { name: 'Текущее изделие', exact: true }) });
        await summary.getByText(String(currentProduct.sku), { exact: true }).waitFor();
        await cancel.click();
        await drawer.waitFor({ state: 'detached' });
        result.reopened = true;
      });
    }
    if (!writeAllowed) result.saved = { skipped: before.productId ? 'Привязка уже сохранена.' : 'Режим без записи.' };
    if (bindMatching && before.productId !== matchId) await checkMatching();
    if (before.productId === matchId) result.matching = { skipped: 'Сопоставление уже сохранено.' };

    async function checkMatching() {
      const current = await read(linePath);
      expect(current.productId === targetId && current.version === Number(versionText) + 1 && same(fields(current), fields(before)),
        'Исходная привязка 1066 и её версия не подтверждены перед «Сопоставлением».');
      const next = await read('/api/showcase/' + matchId);
      const grouped = listen('GET', '/api/matching/suggest', { orderId });
      const searchPage = app + '#salesorders?of=matching&open=' + orderId;
      const related = await advance('Открыть «Сопоставление» договора и получить его строки', async () => {
        await page.goto(searchPage, { waitUntil: 'domcontentloaded' });
        return json(grouped, 'Список позиций сопоставления');
      });
      const item = related.items.find((candidate) => candidate.lineId === lineId);
      expect(item?.productId === targetId, 'Нужная позиция или её связь отсутствуют в «Сопоставлении».');
      result.matchingInitial = { lineId, state: item.state, matched: item.matched, productId: item.productId };
      const row = matching.locator(`tr[data-id="${lineId}"]`);
      const change = row.getByRole('button', { name: /^(Выбрать|Заменить) из каталога$/ });
      await advance('Открыть каталог из строки договора', async () => {
        await change.click();
        await drawer.waitFor();
      });
      const currentSummary = drawer.locator('section').filter({ has: page.getByRole('heading', { name: 'Текущее изделие', exact: true }) });
      await advance('Проверить текущее изделие и выбрать 1067', async () => {
        await currentSummary.getByText(String(target.sku), { exact: true }).waitFor();
        await findProduct(next);
        await productRow(matchId).click();
        await drawer.getByText('Выбранное изделие', { exact: true }).waitFor();
      });
      await screenshot('picker-matching-selected', drawer);
      const beforeConfirm = await read(linePath);
      expect(beforeConfirm.productId === targetId && beforeConfirm.version === current.version, 'Выбор в «Сопоставлении» сразу изменил позицию.');
      const finding = '/api/matching/confirm';
      const pending = listen('POST', finding);
      grant('POST', finding, (body, url) => !url.search && exactBody(body, { lineId, productId: matchId }));
      const confirmation = await advance('Нажать «Привязать изделие» в «Сопоставлении»', async () => {
        await save.click();
        return json(pending, 'Подтверждение сопоставления');
      });
      result.matchAccepted = true;
      expect(confirmation.lineId === lineId && confirmation.productId === matchId && confirmation.state === 'confirmed',
        'Подтверждение «Сопоставления» вернуло другую позицию или иной статус.');
      await advance('Проверить сохранение и заново открыть «Сопоставление»', async () => {
        await drawer.waitFor({ state: 'detached' });
        const actual = await read(linePath);
        expect(actual.id === lineId && actual.productId === matchId && same(fields(actual), fields(before)),
          '«Сопоставление» не сменило изделие или изменило исходные реквизиты позиции.');
        await row.getByText('арт. ' + next.sku, { exact: true }).waitFor();
        await change.click();
        await currentSummary.getByText(String(next.sku), { exact: true }).waitFor();
        await cancel.click();
        await drawer.waitFor({ state: 'detached' });
      });
      result.matching = { lineId, productId: matchId, requests: 1, preservedFields: important, reopened: true };
    }
  });
}, script);
