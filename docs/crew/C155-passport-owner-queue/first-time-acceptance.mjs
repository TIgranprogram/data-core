// Обычный менеджер изолированного стенда. Запуск только через проверенный api.sh stand BROWSER.
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const fromLogs = path.basename(path.dirname(script)) === 'logs';
const guard = fromLogs ? '../../docs/crew/C155-passport-owner-queue/acceptance.test.mjs' : './acceptance.test.mjs';
const { runFocusedAcceptance } = await import(guard);
const productId = '6ae1269ae36900370537a2f3';
const kindId = '6af707fdc451d4c05df6a046';
const loadId = '6aeea9373b8b9255839ab43b';
const rootId = '6afef7893b40fac6985f62ec';
const phraseId = '6afef7ee3b40fac6985f630f';
const target = '/api/showcase/' + productId + '/passport-template';
const passportFields = ['id', 'status', 'passportNumber', 'issueOrigin', 'presentationVersion', 'variant', 'revision',
  'issuedAt', 'pdfIssuedAt', 'productId', 'salesOrderId', 'incomeId', 'supplierOrgId', 'textSnapshot', 'images',
  'effectiveImages', 'standardImages', 'height', 'width', 'length', 'weight', 'installationTypeId',
  'compositionPresentation', 'renderSnapshot'];
const baseline = [
  { number: '611', id: '6afefa546402b642a6610a8b', hash: '0fe843d976947965cae9c2634042d2b0b88677add015d19043e8664b07402a62' },
  { number: '612', id: '6aff0bf134de43c56e5ac63f', hash: '98200456603e8e7ff00becf21390477cac581647eb4395911fabe474bce7b98b' },
];
const widthOnly = process.env.C155_FIRST_TIME_WIDTH_ONLY === '1';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}
const fingerprint = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const without = (obj, ...keys) => Object.fromEntries(Object.entries(obj || {}).filter(([key]) => !keys.includes(key)));
const same = (a, b) => fingerprint(a) === fingerprint(b);
const stableTemplate = (value) => ({
  ...value,
  document: { ...value.document, textSnapshot: without(value.document.textSnapshot, 'at') },
  textSnapshot: without(value.textSnapshot, 'at'),
});

await runFocusedAcceptance(widthOnly ? 'first-time-width' : 'first-time', async ({
  page, book, button, read, listen, json, openTemplate, painted, closeBook, screenshot,
  check, at, expect, exactBody, grant, cardPath, numberOf,
}) => {
  const side = book.locator('.bk-side-slot');
  const pendingDescription = book.locator('.bk-toc-focus button.bk-focus-btn').filter({ hasText: /^Краткое описание/ });
  const controlFor = (key) => side.locator(
    `select[name="${key}"]:visible, select[name="${key}"] + .sel-wrap input[role="combobox"]:visible`,
  );
  const snapshot = async (name) => {
    const images = [];
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        localStorage.setItem('dc-theme', value);
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
      await screenshot('first-time-' + name + '-' + theme);
      images.push('acceptance-first-time-' + name + '-' + theme + '.png');
    }
    return images;
  };
  const checkIssued = async () => {
    const witnesses = [];
    for (const item of baseline) {
      const row = await read(cardPath(item.id) + '?readOnly=1');
      const actual = fingerprint(Object.fromEntries(passportFields.map((key) => [key, row[key] ?? null])));
      expect(row.id === item.id && numberOf(row) === item.number && row.status === 'issued' && actual === item.hash,
        'Контрольный хеш выпуска №' + item.number + ' отличается от хеша до сброса шаблона.');
      witnesses.push({ number: item.number, sha256: actual, textSha256: fingerprint(row.textSnapshot) });
    }
    return witnesses;
  };

  async function choose(key, value, name) {
    const control = controlFor(key);
    await control.waitFor({ state: 'visible', timeout: 12_000 });
    if (await control.evaluate((node) => node.tagName === 'SELECT')) {
      await control.selectOption(value);
      return;
    }
    await control.click();
    await side.getByRole('option', { name, exact: true }).click();
  }

  if (widthOnly) {
    await check('first-time-field-width', async (r) => {
      const url = target + '?variant=short';
      const actual = await read(url);
      expect(actual.document.kindId === kindId && actual.simpleDescriptionSource?.id === phraseId && actual.readiness.ready,
        'Настройки реально заполненного 1066 отличаются от последней приёмки.');
      // Одна проекция для снимка; сохранённый шаблон остаётся доступен по обычному GET.
      const visual = {
        ...actual,
        defaults: without(actual.defaults, 'kindId', 'textChoices'),
        document: { ...actual.document, kindId: null },
        simpleDescriptionSource: null,
        textSnapshot: { ...actual.textSnapshot, description: '' },
        readiness: { ...actual.readiness, ready: false,
          missing: [{ key: 'simpleDescription', label: 'Краткое описание не определено', hint: '' }] },
      };
      const exactUrl = new URL(url, page.url()).href;
      await page.route(exactUrl, (route) => {
        if (route.request().method() !== 'GET') return route.abort();
        return route.fulfill({ json: visual });
      }, { times: 1 });
      await openTemplate(productId);
      await at(r, 'Открыть поле вида на визуальной проекции', () => pendingDescription.click());
      await choose('kindId', kindId, 'Тренажёр для ног');
      const control = controlFor('kindId');
      r.geometry = await control.evaluate((node) => {
        const controlWidth = node.getBoundingClientRect().width;
        const field = node.closest('label.field');
        const panel = node.closest('.bk-side-slot');
        const style = getComputedStyle(node);
        const ctx = document.createElement('canvas').getContext('2d');
        ctx.font = style.font;
        const text = node.tagName === 'SELECT' ? node.selectedOptions[0]?.textContent : node.value;
        const textWidth = Math.ceil(ctx.measureText(text || '').width);
        const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
        return { controlWidth, fieldWidth: field.getBoundingClientRect().width, panelWidth: panel.getBoundingClientRect().width,
          wide: field.classList.contains('wide'), textWidth, availableTextWidth: Math.floor(controlWidth - padding),
          shownSelectedText: text === 'Тренажёр для ног' };
      });
      expect(r.geometry.wide && r.geometry.shownSelectedText && r.geometry.controlWidth >= r.geometry.fieldWidth - 4
        && r.geometry.availableTextWidth >= r.geometry.textWidth, 'Видимое поле не вмещает полное название выбранного вида.');
      r.images = await snapshot('width');
      await button(side, 'Отмена').click();
      const confirm = page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Выйти без сохранения?', exact: true }) });
      await button(confirm, 'Выйти').click();
      await closeBook();
      const after = await read(url);
      expect(same(stableTemplate(actual), stableTemplate(after)), 'Данные шаблона изменились после проверки вида.');
      r.synthetic = true;
      r.templateUnchanged = true;
    });
    return;
  }

  function permit(body) {
    grant('PATCH', target, (actual, url) => url.search === '?variant=short' && exactBody(actual, body));
    return listen('PATCH', target, { variant: 'short' });
  }

  const before = await check('issued-before-reset-proof', async (r) => { r.issued = await checkIssued(); });
  if (before) await check('first-time-description', async (r) => {
    const product = await read('/api/showcase/' + productId);
    const initial = await at(r, 'Открыть короткий шаблон 1066 после сброса', () => openTemplate(productId));
    expect(String(product.sku) === '1066' && same(product.facetValueIds, [loadId])
      && initial.passportCategory === 'TRN' && !initial.document.kindId
      && !initial.defaults.simpleDescription && !initial.defaults.textChoices?.[rootId] && !initial.simpleDescriptionSource
      && initial.readiness.missing.some((item) => item.key === 'simpleDescription'), '1066 ещё не в согласованном исходном состоянии первого заполнения.');
    r.initial = { kind: false, own: false, source: null, expectedFacet: true };
    const kind = controlFor('kindId');
    try {
      r.action = 'Найти обязательное «Краткое описание»';
      await pendingDescription.waitFor({ state: 'visible', timeout: 12_000 });
      r.focusMatches = await pendingDescription.count();
      await at(r, 'Нажать обязательное «Краткое описание»', () => pendingDescription.click());
      await at(r, 'Дождаться поля «Вид изделия»', () => kind.waitFor({ state: 'visible', timeout: 12_000 }));
    } catch (error) {
      r.diagnostic = await book.evaluate((el) => ({
        focusButtons: [...el.querySelectorAll('.bk-toc-focus button.bk-focus-btn')].map((node) => node.textContent.trim()),
        sideHeadings: [...el.querySelectorAll('.bk-side-slot h2,.bk-side-slot h3')].map((node) => node.textContent.trim()),
        ownTextarea: !!el.querySelector('.bk-side-slot textarea'),
        kindSelect: !!el.querySelector('.bk-side-slot select[name=kindId]'),
      }));
      await screenshot('first-time-failure').then(() => { r.image = 'acceptance-first-time-failure.png'; }, () => {});
      throw error;
    }
    expect(await side.locator('textarea:visible').count() === 0, 'Первый шаг снова открыл ручную формулировку.');
    await at(r, 'Выбрать из справочника «Тренажёр для ног»', () => choose('kindId', kindId, 'Тренажёр для ног'));
    r.kindImages = await snapshot('kind');
    const kindSave = permit({ expected: { kindId: null }, changes: { kindId } });
    await at(r, 'Сохранить выбранный вид', () => button(side, 'Сохранить в шаблон').click());
    let saved = await json(kindSave, 'Сохранение вида изделия');
    expect(saved.defaults.kindId === kindId && !saved.defaults.simpleDescription, 'PATCH не сохранил вид изделия или записал ручной текст.');
    if (!saved.simpleDescriptionSource) {
      const candidates = saved.simpleDescriptionSuggestions || [];
      const expected = candidates.find((item) => item.id === phraseId && item.rootId === rootId);
      expect(expected?.text && saved.readiness.missing.some((item) => item.key === 'choice:' + rootId),
        'После сохранения вида справочник не дал ожидаемый конструктивный вариант.');
      const label = expected.name === expected.text ? expected.text : `${expected.name} · ${expected.text}`;
      const one = candidates.length === 1;
      const apply = button(side, one ? 'Подтвердить вариант' : 'Применить вариант');
      await at(r, 'Дождаться следующего словарного шага', () => apply.waitFor({ state: 'visible', timeout: 12_000 }));
      expect(await side.locator('textarea:visible').count() === 0, 'Второй шаг снова открыл ручную формулировку.');
      if (one) await side.getByText(expected.text, { exact: true }).waitFor();
      else await choose('simpleChoice', phraseId, label);
      r.candidateImages = await snapshot('candidate');
      const choiceSave = permit({ expected: { textChoices: { [rootId]: null } }, changes: { textChoices: { [rootId]: phraseId } } });
      await at(r, 'Принять предложенную словарную фразу', () => apply.click());
      saved = await json(choiceSave, 'Сохранение словарного варианта');
      expect(saved.defaults.textChoices?.[rootId] === phraseId, 'Шаблон не запомнил принятый вариант.');
      r.descriptionStep = one ? 'confirmed' : 'selected';
    } else r.descriptionStep = 'automatic';

    const ready = (value) => value.readiness?.ready && value.defaults.kindId === kindId && !value.defaults.simpleDescription
      && value.simpleDescriptionSource?.kind === 'dictionary' && value.simpleDescriptionSource.id === phraseId
      && !!value.textSnapshot?.description;
    expect(ready(saved), 'После заполнения нет готовности, ожидаемой словарной фразы или сохранённого вида.');
    await painted('.bk-page .bk-p', saved.textSnapshot.description);
    await closeBook();
    const reopened = await at(r, 'Открыть шаблон заново', () => openTemplate(productId, 'bookFor'));
    expect(ready(reopened) && same(saved.textSnapshot.description, reopened.textSnapshot.description), 'Готовая фраза не пережила закрытие и повторное открытие.');
    await painted('.bk-page .bk-p', reopened.textSnapshot.description);
    expect(await pendingDescription.count() === 0 && await controlFor('kindId').count() === 0
      && await controlFor('simpleChoice').count() === 0, 'Книжка снова задаёт уже решённый вопрос.');
    const afterProduct = await read('/api/showcase/' + productId);
    expect(same(afterProduct.facetValueIds, product.facetValueIds) && same(initial.effectiveImages, reopened.effectiveImages)
      && same(initial.product, reopened.product)
      && same(without(initial.defaults, 'kindId', 'textChoices'), without(reopened.defaults, 'kindId', 'textChoices'))
      && same(without(initial.defaults.textChoices, rootId), without(reopened.defaults.textChoices, rootId)),
    'Заполнение изменило физические данные, рисунки, признаки или другой ключ шаблона.');
    const toc = book.locator('.bk-toc-pages').getByRole('button', { name: /Описание и назначение/ });
    await toc.first().click();
    await page.waitForFunction(() => {
      const viewport = document.querySelector('.bk-scroll')?.getBoundingClientRect();
      const heading = [...document.querySelectorAll('.bk-page .bk-h')].find((node) => node.textContent.includes('Описание и назначение'));
      const rect = heading?.getBoundingClientRect();
      return rect && viewport && rect.top >= viewport.top && rect.bottom < viewport.bottom;
    });
    r.readyImages = await snapshot('ready');
    await at(r, 'Явно открыть необязательную «Свою формулировку»', () => button(side, 'Своя формулировка').click());
    const own = side.locator('textarea[name="text"]');
    await own.waitFor({ state: 'visible', timeout: 12_000 });
    expect(await own.inputValue() === reopened.textSnapshot.description, 'Своя формулировка не предлагает уже найденный словарный текст.');
    const partSearch = side.getByRole('combobox', { name: 'Добавить часть', exact: true });
    await partSearch.waitFor({ state: 'visible', timeout: 12_000 });
    const shownParts = await side.getByRole('button', { name: /×$/ }).count();
    expect(shownParts <= reopened.simpleDescriptionSource.partIds.length && shownParts < 10,
      'Необязательный редактор снова показывает длинный список частей без поиска.');
    await button(side, 'Отмена').click();
    await own.waitFor({ state: 'detached' });
    await closeBook();
    r.final = { ready: true, kindId, source: 'dictionary', phraseId, own: false, questionRepeated: false, shownParts };
  });
  await check('issued-after-first-time', async (r) => { r.issued = await checkIssued(); });
}, script);
