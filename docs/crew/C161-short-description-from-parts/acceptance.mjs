// C161. Только обычный менеджер изолированной копии и api.sh stand BROWSER.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const script = fileURLToPath(import.meta.url);
const shared = path.basename(path.dirname(script)) === 'logs'
  ? '../../docs/crew/C155-passport-owner-queue/acceptance.test.mjs'
  : '../C155-passport-owner-queue/acceptance.test.mjs';
const { runFocusedAcceptance } = await import(shared);
const manualOnly = process.env.C161_VISUAL_ONLY === 'manual';
const visualOnly = manualOnly || process.env.C161_VISUAL_ONLY === '1';
const visualProductId = '6aff2a4c2d9e948b326337fc';
const visualIssuedId = '6aff2b122d9e948b326339c6';
const sourceId = '6ae1269ae36900370537a2f3';
const productId = visualOnly ? visualProductId : process.env.C161_QA_PRODUCT_ID;
const sku = visualOnly ? '1037' : process.env.C161_QA_SKU;
const firm = process.env.C161_QA_FIRM;
const partIds = visualOnly ? ['6af81f883389de160b2c97d9', '6adceeeb3ca001b9b3b0e575', '6ae32682a3f6de10abf0365b']
  : (process.env.C161_QA_PART_IDS || '').split(',').filter(Boolean);
const target = '/api/showcase/' + productId + '/passport-template';
const rowsPath = '/api/passports?productId=' + productId + '&limit=10';
const mode = { presentationVersion: 1, variant: 'short' };
const auto = { mode: 'parts', partIds };
const manual = { text: 'Контрольная ручная формулировка C161.', partIds };
const normalize = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const canon = (value) => Array.isArray(value) ? value.map(canon) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])])) : value;
const sha = (value) => createHash('sha256').update(JSON.stringify(canon(value))).digest('hex');
const baseline = [
  { number: '611', id: '6afefa546402b642a6610a8b', hash: '0fe843d976947965cae9c2634042d2b0b88677add015d19043e8664b07402a62' },
  { number: '612', id: '6aff0bf134de43c56e5ac63f', hash: '98200456603e8e7ff00becf21390477cac581647eb4395911fabe474bce7b98b' },
];
const fields = ['id', 'status', 'passportNumber', 'issueOrigin', 'presentationVersion', 'variant', 'revision',
  'issuedAt', 'pdfIssuedAt', 'productId', 'salesOrderId', 'incomeId', 'supplierOrgId', 'textSnapshot', 'images',
  'effectiveImages', 'standardImages', 'height', 'width', 'length', 'weight', 'installationTypeId',
  'compositionPresentation', 'renderSnapshot'];
// GET карточки скрывает сырой printSnapshot, возвращая эти поля сохранённой печати.
const visiblePrintFields = ['revision', 'revisionList', 'readiness', 'supplierOrg', 'effectiveImages', 'standardImages'];

const phase = manualOnly ? 'c161-visual-manual' : visualOnly ? 'c161-visual' : 'c161';
await runFocusedAcceptance(phase, async ({
  page, book, button, read, listen, json, openTemplate, painted, closeBook, screenshot,
  check, at, expect, need, objectId, exactBody, grant, cardPath, numberOf, statusOf,
  inspectPdf, download, lastNumbers,
}) => {
  let parts, text, issued, numbersBefore, sourceBefore, issuedBefore;
  const side = book.locator('.bk-side-slot');
  const combo = () => side.getByRole('combobox', { name: 'Добавить часть', exact: true });
  const preview = () => side.getByRole('status', { name: 'Предпросмотр краткого описания' });
  const textarea = () => side.locator('textarea[name="text"]');
  const home = () => button(side, 'Краткое описание');
  const getTemplate = () => read(target + '?variant=short');
  async function sourceHash() {
    const source = await read('/api/showcase/' + sourceId + '/passport-template?variant=short');
    return sha({ defaults: source.defaults, effectiveImages: source.effectiveImages, standardImages: source.standardImages,
      physical: ['length', 'width', 'height', 'weight', 'installationTypeId'].map((key) => source.document?.[key]) });
  }

  async function previousIssued() {
    const rows = [];
    for (const item of baseline) {
      const row = await read(cardPath(item.id) + '?readOnly=1');
      const hash = sha(Object.fromEntries(fields.map((key) => [key, row[key] ?? null])));
      expect(row.id === item.id && String(numberOf(row)) === item.number && statusOf(row) === 'issued' && hash === item.hash,
        'Контрольный снимок прежнего выпуска №' + item.number + ' отличается от C155.');
      expect(row.readiness && row.supplierOrg && Array.isArray(row.effectiveImages) && Array.isArray(row.standardImages),
        'Карточка не вернула сохранённые данные печати выпуска №' + item.number + '.');
      const printSha256 = sha(Object.fromEntries(visiblePrintFields.map((key) => [key, row[key] ?? null])));
      rows.push({ number: item.number, sha256: hash, printSha256 });
    }
    return rows;
  }

  async function edit() {
    await home().click();
    await combo().waitFor();
  }
  async function cancel(dirty = false) {
    await button(side, 'Отмена').click();
    if (dirty) {
      const dialog = page.getByRole('dialog').filter({ has: page.getByText('Выйти без сохранения?', { exact: true }) }).last();
      await button(dialog, 'Выйти').click();
    }
    await home().waitFor();
  }
  async function pick(part) {
    const name = normalize(part.name);
    await combo().fill(name);
    // Выпадающий список может отрисовываться вне боковой панели.
    await page.locator('.combo-list:visible').getByRole('option')
      .filter({ has: page.getByText(name, { exact: true }) }).click();
    await side.locator('[title=' + JSON.stringify('Убрать «' + name + '»') + ']').waitFor();
  }
  async function save(next, previous) {
    const body = { changes: { simpleDescription: next }, expected: { simpleDescription: previous } };
    grant('PATCH', target, (received, url) => isDeepStrictEqual(received, body)
      && [...url.searchParams.entries()].every(([key, value]) => key === 'variant' && value === 'short'));
    const pending = listen('PATCH', target);
    await button(side, 'Сохранить в шаблон').click();
    const response = await json(pending, 'Сохранение краткого описания');
    expect(isDeepStrictEqual(response.defaults?.simpleDescription, next), 'PATCH вернул другое собственное значение.');
    await home().waitFor();
    return response;
  }
  async function checkServerAuto() {
    const projection = await getTemplate();
    expect(isDeepStrictEqual(projection.defaults?.simpleDescription, auto) && projection.simpleDescriptionSource?.kind === 'parts'
      && isDeepStrictEqual(projection.simpleDescriptionSource?.partIds, partIds)
      && projection.simpleDescriptionSource?.text === text && projection.textSnapshot?.description === text
      && projection.readiness?.ready, 'GET не подтвердил режим, выбранные части, текст и готовность.');
  }
  async function showTheme(theme) {
    await page.evaluate((value) => {
      localStorage.setItem('dc-theme', value);
      document.documentElement.setAttribute('data-theme', value);
    }, theme);
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
  }

  if (visualOnly) {
    const getIssued = () => read(cardPath(visualIssuedId) + '?readOnly=1');
    const printHash = (value) => sha(Object.fromEntries(
      [...new Set([...fields, ...visiblePrintFields])].map((key) => [key, value[key] ?? null]),
    ));
    let beforeIssue, beforeDefaults, description, chosen;
    const selected = side.locator('[title^="Убрать «"]');
    const unchanged = async () => sha((await getTemplate()).defaults) === beforeDefaults
      && printHash(await getIssued()) === beforeIssue && (await read(rowsPath)).total === 1;
    const openSavedEditor = async () => {
      await openTemplate(visualProductId, 'bookFor');
      await edit();
      expect(await selected.count() === partIds.length, 'Редактор не открыл три сохранённые части.');
    };
    const removeAndCheck = async (result) => {
      while (await selected.count()) await selected.first().click();
      expect(normalize(await preview().textContent()) === 'Выберите части изделия.' && !await textarea().isVisible(),
        'У пустого автоописания ожидалась подсказка и отсутствие ручного поля.');
      const saveButton = button(side, 'Сохранить в шаблон');
      result.saveDisabledWhenEmpty = await saveButton.isDisabled();
      if (!result.saveDisabledWhenEmpty) {
        await saveButton.click();
        expect(await combo().evaluate((input) => input === document.activeElement),
          'Пустое сохранение должно вернуть фокус к выбору части.');
        expect(normalize(await preview().textContent()) === 'Выберите части изделия.', 'Исчезла подсказка для пустого выбора.');
        result.emptySaveReturnsFocus = true;
      }
    };
    async function repick(result) {
      for (const part of chosen) await at(result, 'Заново выбрать «' + part.name + '»', () => pick(part));
      expect(await selected.count() === partIds.length && normalize(await preview().textContent()) === description,
        'После повторного выбора ожидались три части и прежний текст.');
    }
    const manualPassed = await check(manualOnly ? 'prefilled-and-cancel' : 'empty-and-prefilled', async (result) => {
      const template = await getTemplate();
      const row = await getIssued();
      beforeIssue = printHash(row);
      beforeDefaults = sha(template.defaults);
      description = template.simpleDescriptionSource?.text;
      expect(template.productId === visualProductId && isDeepStrictEqual(template.defaults?.simpleDescription, auto)
        && template.readiness?.ready && description && row.id === visualIssuedId && row.productId === visualProductId
        && statusOf(row) === 'issued' && numberOf(row) === '613' && row.textSnapshot?.description === description
        && (await read(rowsPath)).total === 1, 'Исходное готовое значение или выпуск C161 не совпали с фактической приёмкой.');
      const dict = await read('/api/dicts/passportParts');
      chosen = partIds.map((id) => dict.items.find((part) => part.id === id));
      expect(chosen.every((part) => normalize(part?.name)), 'Сохранённые части отсутствуют в словаре.');
      const capture = async (stage) => {
        const files = [];
        for (const theme of ['light', 'dark']) {
          await showTheme(theme);
          await screenshot('visual-' + stage + '-' + theme);
          files.push('acceptance-visual-' + stage + '-' + theme + '.png');
        }
        return files;
      };
      await at(result, 'Открыть автоописание из сохранённых частей', openSavedEditor);
      if (!manualOnly) {
        await at(result, 'Очистить выбор и проверить пустое сохранение', async () => {
          await removeAndCheck(result);
          result.empty = await capture('empty');
        });
        await repick(result);
      }
      await at(result, 'Открыть предзаполненную ручную формулировку', async () => {
        expect(normalize(await preview().textContent()) === description, 'Выбранные части дали другой текст.');
        await button(side, 'Изменить текст').click();
        await textarea().waitFor();
        expect(await textarea().inputValue() === description, 'Ручное поле не предзаполнено автоописанием.');
        result.manualPrefilled = await capture('manual');
      });
      await at(result, 'Отменить правку и сверить шаблон и выпуск', async () => {
        await cancel(true);
        await closeBook();
        expect(await unchanged(), 'Визуальный прогон изменил настройки шаблона или выпуск №613.');
      });
      Object.assign(result, { productId: visualProductId, number: '613', defaultsSha256: beforeDefaults, issuedPrintSha256: beforeIssue });
    });
    if (manualOnly) await check('repick-after-empty-save', async (result) => {
      need(manualPassed, 'Ручная форма и исходные снимки не подтверждены.');
      try {
        await at(result, 'Переоткрыть сохранённое автоописание', openSavedEditor);
        await at(result, 'Удалить части и проверить пустое сохранение', () => removeAndCheck(result));
        await repick(result);
        result.selectedCount = await selected.count();
        await at(result, 'Отменить правку и сверить шаблон и выпуск', async () => {
          await cancel();
          await closeBook();
          expect(await unchanged(), 'После повторного выбора изменилась сохранённая карточка шаблона или выпуска.');
        });
      } catch (error) {
        result.diagnostics = {
          inputValue: (await combo().isVisible()) ? await combo().inputValue() : null,
          visibleOptionLabels: (await page.locator('.combo-list:visible .opt-l').allTextContents()).slice(0, 12).map(normalize),
          selectedCount: await selected.count(),
          manualButtonCount: await button(side, 'Изменить текст').count(),
        };
        if (await side.isVisible()) {
          await screenshot('visual-repick-failure', side).catch(() => null);
          result.diagnostics.image = 'acceptance-visual-repick-failure.png';
        }
        result.unchanged = await unchanged().catch(() => null);
        throw error;
      }
    });
    return;
  }

  const fixture = await check('fixture', async (result) => {
    need(objectId(productId) && productId !== sourceId && sku && objectId(firm) && partIds.length === 3
      && new Set(partIds).size === 3 && partIds.every(objectId), 'Нужны согласованные QA id изделия, фирмы и трёх частей.');
    const product = await read('/api/showcase/' + productId);
    expect(product.id === productId && String(product.sku) === sku && /^QA C161(?:\s|$)/.test(product.name),
      'Маркировка или идентификатор изделия не совпали с согласованной QA копией.');
    const template = await getTemplate();
    const entries = await read(rowsPath);
    expect(template.mode === 'template' && template.variant === 'short' && template.productId === productId
      && !template.defaults?.simpleDescription && entries.total === 0, 'На QA изделии уже есть своё описание или паспорт.');
    const rows = await read('/api/dicts/passportParts');
    parts = partIds.map((id) => rows.items.find((item) => item.id === id));
    expect(parts.every((item) => normalize(item?.name) && normalize(item?.genSingular))
      && new Set(parts.map((item) => normalize(item.name).toLowerCase())).size === 3,
    'Выберите три части с различными названиями и заполненным родительным падежом.');
    const images = new Set((template.effectiveImages || []).filter((item) => item.url).map((item) => item.kind));
    expect(['overview', 'dimensions', 'holes'].every((kind) => images.has(kind)), 'Не назначены три реальные паспортные картинки.');
    const forms = parts.map((item) => normalize(item.genSingular));
    text = 'Изделие состоит из ' + forms.slice(0, 2).join(', ') + ' и ' + forms[2] + '.';
    numbersBefore = await lastNumbers();
    sourceBefore = await sourceHash();
    issuedBefore = await previousIssued();
    Object.assign(result, { productId, sku, parts: parts.map(({ id, name }) => ({ id, name })), imageKinds: [...images],
      initialMissing: template.readiness?.missing?.map((item) => item.key), sourceSha256: sourceBefore, previous: issuedBefore });
  });

  const edited = await check('parts-manual-roundtrip', async (result) => {
    need(fixture, 'Отдельная QA копия не прошла входные проверки.');
    await at(result, 'Открыть редактор частей и проверить отмену', async () => {
      await openTemplate(productId, 'bookFor');
      await edit();
      expect(!await textarea().isVisible(), 'До явного действия показано поле ручного текста.');
      const selected = side.locator('[title^="Убрать «"]');
      while (await selected.count()) await selected.first().click();
      await pick(parts[0]);
      expect(normalize(await preview().textContent()) === 'Изделие состоит из ' + normalize(parts[0].genSingular) + '.',
        'Некорректный предпросмотр одной части.');
      await cancel(true);
      expect(!(await getTemplate()).defaults?.simpleDescription, 'Отмена сохранила выбор.');
    });

    await at(result, 'Выбрать три части и сохранить автоописание', async () => {
      await edit();
      const selected = side.locator('[title^="Убрать «"]');
      while (await selected.count()) await selected.first().click();
      for (const part of parts) await pick(part);
      expect(normalize(await preview().textContent()) === text && !await textarea().isVisible(),
        'Предпросмотр трёх частей не совпал с ожидаемой фразой или запросил ручной текст.');
      result.partsScreens = [];
      for (const theme of ['light', 'dark']) {
        await showTheme(theme);
        await screenshot('parts-' + theme);
        result.partsScreens.push('acceptance-parts-' + theme + '.png');
      }
      await save(auto, null);
      await checkServerAuto();
    });

    await at(result, 'Переоткрыть шаблон и сохранить свою формулировку', async () => {
      await closeBook();
      await openTemplate(productId, 'bookFor');
      await edit();
      expect(normalize(await preview().textContent()) === text && !await textarea().isVisible(),
        'При переоткрытии автоописание или режим не сохранились.');
      await button(side, 'Изменить текст').click();
      await textarea().waitFor();
      expect(await textarea().inputValue() === text, 'Ручное редактирование не предзаполнилось автоописанием.');
      await textarea().fill(manual.text);
      await save(manual, auto);
      const projection = await getTemplate();
      expect(isDeepStrictEqual(projection.defaults?.simpleDescription, manual)
        && projection.simpleDescriptionSource?.kind === 'own' && projection.textSnapshot?.description === manual.text,
      'GET не подтвердил ручной текст и выбранные части.');
    });

    await at(result, 'Переоткрыть ручной режим и вернуться к выбору частей', async () => {
      await closeBook();
      await openTemplate(productId, 'bookFor');
      await edit();
      expect(normalize(await preview().textContent()) === manual.text && !await textarea().isVisible(),
        'Ручной текст изменился после переоткрытия.');
      await button(side, 'Собрать из частей').click();
      expect(normalize(await preview().textContent()) === text, 'Возврат в авто потерял состав или текст.');
      await save(auto, manual);
      await checkServerAuto();
    });
    result.text = text;
    result.patches = 3;
  });

  const sampled = await check('sample-pdf', async (result) => {
    need(edited, 'Редактор частей не прошёл проверку сохранения.');
    const url = '/api/passports/preview';
    const body = { ...mode, productId, mode: 'pages', pack: 'passport' };
    grant('POST', url, (received) => exactBody(received, body));
    const dialog = page.getByRole('dialog').filter({ has: page.locator('iframe[title="Образец паспорта без номера"]') });
    const pending = listen('POST', url, {}, 75_000);
    try {
      await at(result, 'Сформировать образец обычными страницами', () => button(book, 'Образец').click());
      const response = await pending;
      expect(response, 'Предпросмотр не получил ответа.');
      result.pdf = await inspectPdf(response, text);
      expect(result.pdf.hasDescription && result.pdf.hasDraftMark && !result.pdf.hasAnyPassportNumber
        && result.pdf.pages > 1 && result.pdf.imageCount > 0 && !result.pdf.hasTechnicalComposition,
      'Образец не подтвердил текст, рисунки и отсутствие номера.');
      await dialog.locator('iframe[src^="blob:"]').waitFor();
    } finally {
      if (await dialog.isVisible()) await button(dialog, 'Вернуться к правке').click();
    }
    expect((await read(rowsPath)).total === 0 && isDeepStrictEqual(await lastNumbers(), numbersBefore),
      'Образец изменил список паспортов или статистику номеров.');
    result.passports = 0;
  });

  const issuePassed = await check('single-issue-and-download', async (result) => {
    need(sampled, 'Образец PDF не прошёл проверку.');
    const url = '/api/passports';
    const dialog = page.getByRole('dialog').filter({ hasText: 'Выпустить паспорт без заказа?' });
    await button(book, 'Выпустить паспорт').click();
    const select = dialog.locator('select');
    await select.waitFor();
    const firmExists = await select.evaluate((node, id) => [...node.options].some((option) => option.value === id), firm);
    need(firmExists, 'Согласованная наша фирма недоступна в диалоге выпуска.');
    await select.selectOption(firm);
    let createdId;
    grant('POST', url, (body) => /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(body?.creationKey)
      && exactBody(body, { ...mode, productId, supplierOrgId: firm, creationKey: body.creationKey }), 1, (row) => {
      if (!objectId(row.id) || row.productId !== productId || row.supplierOrgId !== firm || row.salesOrderId || row.incomeId
        || numberOf(row) || statusOf(row) !== 'draft' || row.variant !== 'short' || row.presentationVersion !== 1) return;
      createdId = row.id;
      grant('POST', cardPath(createdId) + '/issue', (body) => exactBody(body, mode));
    });
    const creating = listen('POST', url);
    const issuing = page.waitForResponse((response) => response.request().method() === 'POST'
      && new URL(response.url()).pathname === cardPath(createdId) + '/issue').catch(() => null);
    await at(result, 'Подтвердить выпуск один раз', () => button(dialog, 'Выпустить паспорт').click());
    const draft = await json(creating, 'Создание QA экземпляра');
    expect(draft.id === createdId, 'Ответ создания не подтвердил согласованный контекст.');
    issued = await json(issuing, 'Выпуск QA экземпляра');
    const number = numberOf(issued);
    Object.assign(result, { id: issued.id, number });
    expect(issued.id === createdId && statusOf(issued) === 'issued' && number, 'QA паспорт не выдан с одним номером.');
    await painted('.bk-head h2', '№ ' + number);
    const saved = await read(cardPath(issued.id) + '?readOnly=1');
    expect(saved.textSnapshot?.description === text && saved.supplierOrgId === firm && !saved.salesOrderId && !saved.incomeId
      && (await read(rowsPath)).total === 1, 'Выданный экземпляр не сохранил точный текст или появился лишний паспорт.');
    const pdfPath = cardPath(issued.id) + '/pdf';
    grant('GET', pdfPath, (candidate) => !candidate.searchParams.has('mode') && candidate.searchParams.get('stamp') !== '1');
    const response = await at(result, 'Скачать обычный PDF выданного паспорта',
      () => download(pdfPath, { onStep: (value) => { result.pdfAction = value; } }));
    result.pdf = await inspectPdf(response, text, number);
    expect(result.pdf.hasDescription && result.pdf.hasNumber && !result.pdf.hasDraftMark
      && result.pdf.pages > 1 && result.pdf.imageCount > 0 && !result.pdf.hasTechnicalComposition,
    'Выданный PDF не подтвердил сохранённое описание, номер и рисунки.');
    await showTheme('light');
    await screenshot('issued');
    result.image = 'acceptance-issued.png';
  });

  await check('historical-integrity', async (result) => {
    need(fixture, 'Контрольные снимки до сценария не подтверждены.');
    result.previous = await previousIssued();
    expect(isDeepStrictEqual(result.previous, issuedBefore), 'Доступная менеджеру проекция печати или редакция №611/612 изменилась.');
    result.sourceSha256 = await sourceHash();
    expect(result.sourceSha256 === sourceBefore, 'Настройки, размеры или рисунки исходного 1066 изменились.');
    result.issued = !!issuePassed;
  });
}, script);
