import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';

const script = fileURLToPath(import.meta.url);
const guard = path.basename(path.dirname(script)) === 'logs'
  ? '../../docs/crew/C155-passport-owner-queue/acceptance.test.mjs' : '../C155-passport-owner-queue/acceptance.test.mjs';
const { runFocusedAcceptance } = await import(guard);
const id = '6aff3ba30929d7d70f4b2451';
const photoId = '6aff3ba70929d7d70f4b245b';
const kindId = '6af707fdc451d4c05df6a045';
const cardioId = '6aeea9373b8b9255839ab433';
const powerId = '6aeea9373b8b9255839ab432';
const contactId = '6aff3bf00929d7d70f4b24ea';
const rootId = '6aff3bf50929d7d70f4b24f3';
const leafId = '6aff3bfa0929d7d70f4b24fa';
const partIds = ['6adceeeb3ca001b9b3b0e574', '6adceeeb3ca001b9b3b0e575', '6adceeeb3ca001b9b3b0e57a', '6aff3bec0929d7d70f4b24e3'];
const title = 'Сиденье, рукоятки и педали';
const productPath = '/api/showcase/' + id;
const target = productPath + '/passport-template';
const photoPath = '/api/products/' + id + '/photos?purpose=passport';
const listPath = '/api/passports?productId=' + id + '&limit=5';
const text = 'Изделие состоит из несущей рамы, ручки, сиденья и педали.';
const literal = 'Тренажёр состоит из рамы, рукояток, сиденья и педалей.';
const purpose = 'Предназначено для кардиотренировки и развития выносливости.';
const oid = /^[a-f0-9]{24}$/;
const norm = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const sha = v => createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const historical = [['611', '6afefa546402b642a6610a8b'], ['612', '6aff0bf134de43c56e5ac63f'], ['613', '6aff2b122d9e948b326339c6']];

await runFocusedAcceptance('c163', async ({
  page, book, button, read, json, listen, grant, expect, need, exactBody, check, at, screenshot,
  openTemplate, closeBook, inspectPdf, lastNumbers, cardPath, numberOf, statusOf,
}) => {
  const side = book.locator('.bk-side-slot');
  const setup = book.getByRole('heading', { name: 'Подготовка паспорта', exact: true }).locator('..');
  const dialog = page.getByRole('dialog');
  const tpl = () => read(target + '?variant=short');
  const focusField = label => book.locator('.bk-toc-focus button.bk-focus-btn').filter({ hasText: label });
  const status = side.getByRole('status', { name: 'Предпросмотр краткого описания' });
  const save = button(side, 'Сохранить в шаблон');
  const expand = () => side.getByText('Дополнительные критерии', { exact: true }).click();
  const snapshot = async () => {
    const items = [];
    for (const [number, doc] of historical) {
      const r = await read(cardPath(doc) + '?readOnly=1');
      expect(r.id === doc && numberOf(r) === number && statusOf(r) === 'issued', 'Не найден выпуск №' + number);
      items.push({ number, sha256: sha({ text: r.textSnapshot, issued: r.issuedAt, printed: r.pdfIssuedAt,
        revision: r.revision, image: r.effectiveImages, standards: r.standardImages }) });
    }
    const original = await read('/api/showcase/6ae1269ae36900370537a2f3/passport-template?variant=short');
    return { items, source1066: sha({ defaults: original.defaults, source: original.simpleDescriptionSource, images: original.effectiveImages }) };
  };
  const frames = async name => {
    for (const theme of ['light', 'dark']) {
      await page.evaluate(v => { localStorage.setItem('dc-theme', v); document.documentElement.dataset.theme = v; }, theme);
      await screenshot('c163-resume-' + name + '-' + theme);
    }
  };
  const choose = async (name, value, label) => {
    const selector = 'select[name="' + name + '"]';
    const field = side.locator(selector);
    await field.waitFor({ state: 'attached' });
    if (await field.isVisible()) {
      await field.selectOption(value);
    } else {
      await side.locator(selector + ' + .sel-wrap input[role="combobox"]:visible').click();
      await page.getByRole('option', { name: label, exact: true }).click();
    }
  };
  const patch = async (changes, expected, confirm) => {
    const exact = { changes, expected };
    grant('PATCH', target, (body, url) => url.search === '?variant=short' && same(body, exact));
    const pending = listen('PATCH', target, { variant: 'short' });
    await save.click();
    const r = await json(pending, 'Сохранение шаблона');
    expect(confirm(r), 'Ответ PATCH не подтвердил запрошенные данные.');
    await save.waitFor({ state: 'hidden' });
    return r;
  };

  let linksSha;
  let base;
  const fixture = await check('resume-from-saved-cover-and-kind', async (result) => {
    const row = await read(productPath);
    const r = await openTemplate(id, 'bookFor');
    const files = await read(photoPath);
    expect(row.id === id && row.name === 'QA C163 — Вело' && row.sku === 'QA-C163-VELO'
      && !row.photoSource && row.photo?.id === photoId && same(row.photos?.map(p => p.id), [photoId])
      && r.productId === id && r.product.article === 'QA-C163-VELO' && r.passportCategory === 'TRN'
      && r.defaults.kindId === kindId && r.product.facetValueIds === null && r.simpleDescriptionSource === null
      && !r.defaults.simpleDescription && r.document.purpose === purpose && r.document.elements?.length === 1
      && files.length === 3 && (await read(listPath)).total === 0, 'Исходное состояние возобновления не совпало.');
    linksSha = sha(files);
    base = await snapshot();
    result.cover = photoId;
    result.kind = kindId;
    result.facetValueIds = null;
  });
  const configured = await check('criteria-and-recommended-parts', async (result) => {
    need(fixture, 'Исходное состояние не прошло сверку.');
    const dict = await read('/api/dicts/productFacets');
    const type = dict.items.find(r => r.code === 'trn.kind');
    const contact = dict.items.find(r => r.code === 'trn.contact');
    expect(oid.test(type?.id) && oid.test(contact?.id), 'Нет действующих критериев TRN.');
    try {
      await at(result, 'Выбрать «Кардио» после загрузки формы', async () => {
        await button(setup, 'Критерии изделия').click();
        await choose(type.id, cardioId, 'Кардио');
        await patch({ facetValueIds: [cardioId] }, { facetValueIds: null }, r => same(r.product.facetValueIds, [cardioId]));
      });
      await at(result, 'Подтвердить конструкцию с сохранением «Кардио»', async () => {
        await button(setup, 'Критерии изделия').click();
        await expand();
        await choose(contact.id, contactId, title);
        await patch({ facetValueIds: [cardioId, contactId] }, { facetValueIds: [cardioId] },
          r => same(r.product.facetValueIds, [cardioId, contactId]) && r.simpleDescriptionSource?.id === leafId);
      });
      await at(result, 'Переоткрыть шаблон и проверить сохранённые критерии', async () => {
        await closeBook();
        const r = await openTemplate(id, 'bookFor');
        expect(same(r.product.facetValueIds, [cardioId, contactId]) && r.simpleDescriptionSource?.rootId === rootId
          && r.document.simpleDescription?.text === literal, 'Критерии или фраза исчезли после повторного входа.');
        await frames('setup');
      });
      await at(result, 'Изменить первый критерий и отменить', async () => {
        await button(setup, 'Критерии изделия').click();
        await choose(type.id, powerId, 'Силовой');
        await button(side, 'Отмена').click();
        const confirm = dialog.filter({ has: page.getByText('Выйти без сохранения?', { exact: true }) });
        await button(confirm, 'Выйти').click();
        await save.waitFor({ state: 'hidden' });
        expect(same((await tpl()).product.facetValueIds, [cardioId, contactId]), 'Отмена изменила критерии.');
      });
      await at(result, 'Проверить, что предлагаются только связанные части', async () => {
        await button(setup, 'Краткое описание').click();
        await status.getByText(text, { exact: true }).waitFor();
        expect(!await side.locator('textarea:visible').count(), 'Автоописание открыло ручной ввод.');
        await side.locator('[title="Убрать «Педаль»"]').click();
        await side.locator('input[placeholder="Найдите по названию"]').click();
        const list = page.locator('.combo-list:visible');
        const recommended = list.getByRole('option').filter({ hasText: /^Педаль/ });
        await recommended.waitFor();
        const labels = (await list.locator('.opt-l').allTextContents()).map(norm);
        expect(same(labels, ['Педаль']), 'В рекомендациях появились неподходящие детали ' + labels.join(', '));
        await screenshot('c163-resume-recommended-parts', list);
        await recommended.click();
        await list.waitFor({ state: 'hidden' });
        await status.getByText(text, { exact: true }).waitFor();
        result.recommended = labels;
        await frames('parts');
      });
      await at(result, 'Сохранить автоописание из четырёх частей', () =>
        patch({ simpleDescription: { mode: 'parts', partIds } }, { simpleDescription: null },
          r => r.simpleDescriptionSource?.kind === 'parts' && r.simpleDescriptionSource.text === text));
      result.facets = [cardioId, contactId];
      result.dictionaryText = literal;
      result.generatedText = text;
    } catch (e) {
      if (await side.isVisible()) await screenshot('c163-resume-criteria-failure', side).catch(() => {});
      throw e;
    }
  });

  await check('sample-and-readback', async (result) => {
    need(configured, 'Критерии и автоописание не прошли приёмку.');
    let current = await tpl();
    if (current.readiness.missing.some(r => r.key === 'maxUsers')) {
      await at(result, 'Ввести вместимость только в тестовой карточке', async () => {
        await focusField(/Пользователей одновременно/).click();
        await side.locator('input[name="maxUsers"]').fill('1');
        current = await patch({ maxUsers: 1 }, { maxUsers: null }, r => r.defaults.maxUsers === 1);
      });
    }
    if (current.readiness.missing.some(r => r.key === 'joints')) {
      await at(result, 'Выбрать соединение только в тестовой карточке', async () => {
        await focusField(/Как соединены части/).click();
        await side.locator('input[role="combobox"]:visible').fill('Болты');
        await page.locator('.combo-list:visible').getByRole('option').filter({ hasText: /^Болты/ }).click();
        current = await patch({ joints: ['bolts'] }, { joints: null }, r => same(r.defaults.joints, ['bolts']));
      });
    }
    expect(current.readiness.ready, 'Остались обязательные сведения ' + current.readiness.missing.map(r => r.key).join(', '));
    const numbers = await lastNumbers();
    const target = '/api/passports/preview';
    const payload = { productId: id, presentationVersion: 1, variant: 'short', mode: 'pages', pack: 'passport' };
    const preview = dialog.filter({ has: page.locator('iframe[title="Образец паспорта без номера"]') });
    await at(result, 'Открыть образец PDF без выпуска', async () => {
      grant('POST', target, (body, url) => !url.search && exactBody(body, payload));
      const pending = listen('POST', target, {}, 75_000);
      await button(book, 'Образец').click();
      const response = await pending;
      expect(!!response, 'Образец не получил ответ.');
      result.pdf = await inspectPdf(response, text);
      expect(result.pdf.hasDescription && result.pdf.hasDraftMark && !result.pdf.hasAnyPassportNumber
        && result.pdf.imageCount >= 3 && !result.pdf.hasTechnicalComposition, 'PDF не подтвердил краткое описание и рисунки.');
      await preview.locator('iframe[src^="blob:"]').waitFor();
      await button(preview, 'Вернуться к правке').click();
    });
    expect((await read(listPath)).total === 0 && same(await lastNumbers(), numbers), 'Образец создал паспорт или номер.');
    expect(sha(await read(photoPath)) === linksSha, 'Связи паспортных рисунков изменились.');
    result.noPassport = true;
  });
  await check('historical-integrity', async result => {
    need(base, 'Исходные выпуски не прочитаны.');
    const after = await snapshot();
    expect(same(base, after), 'Выпуски №611–613 или исходный 1066 изменились.');
    result.unchanged = after;
  });
}, script);
