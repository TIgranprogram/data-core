import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';

const script = fileURLToPath(import.meta.url);
const shared = path.basename(path.dirname(script)) === 'logs'
  ? '../../docs/crew/C155-passport-owner-queue/acceptance.test.mjs' : '../C155-passport-owner-queue/acceptance.test.mjs';
const { runFocusedAcceptance } = await import(shared);
const phase = process.env.C163_DICTIONARY_ONLY === '1' ? 'c163-dict' : 'c163';
const id = '6aff3ba30929d7d70f4b2451';
const coverId = '6aff3ba70929d7d70f4b245b';
const kindId = '6af707fdc451d4c05df6a045';
const cardioId = '6aeea9373b8b9255839ab433';
const contactId = '6aff3bf00929d7d70f4b24ea';
const rootId = '6aff3bf50929d7d70f4b24f3';
const leafId = '6aff3bfa0929d7d70f4b24fa';
const partIds = ['6adceeeb3ca001b9b3b0e574', '6adceeeb3ca001b9b3b0e575', '6adceeeb3ca001b9b3b0e57a', '6aff3bec0929d7d70f4b24e3'];
const itemName = 'QA C163 — Вело';
const title = 'Сиденье, рукоятки и педали';
const productPath = '/api/showcase/' + id;
const templatePath = productPath + '/passport-template';
const photoPath = '/api/products/' + id + '/photos?purpose=passport';
const ownPath = '/api/products/' + id;
const listPath = '/api/passports?productId=' + id + '&limit=5';
const text = 'Изделие состоит из несущей рамы, ручки, сиденья и педали.';
const literal = 'Тренажёр состоит из рамы, рукояток, сиденья и педалей.';
const purpose = 'Предназначено для кардиотренировки и развития выносливости.';
const oid = /^[a-f0-9]{24}$/;
const norm = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sha = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const historical = [
  ['611', '6afefa546402b642a6610a8b'], ['612', '6aff0bf134de43c56e5ac63f'],
  ['613', '6aff2b122d9e948b326339c6'],
];

await runFocusedAcceptance(phase, async ({
  app, page, book, button, read, json, listen, grant, expect, need, exactBody, check, at, screenshot, openTemplate,
  closeBook, inspectPdf, lastNumbers, cardPath, numberOf, statusOf,
}) => {
  const side = book.locator('.bk-side-slot');
  const setup = book.getByRole('heading', { name: 'Подготовка паспорта', exact: true }).locator('..');
  const dialogue = page.getByRole('dialog');
  const themes = async (name, scope = book) => {
    for (const value of ['light', 'dark']) {
      await page.evaluate(v => { localStorage.setItem('dc-theme', v); document.documentElement.dataset.theme = v; }, value);
      await screenshot('c163-' + name + '-' + value, scope);
    }
  };
  async function choose(container, select, value, label) {
    const native = container.locator(select + ':visible');
    if (await native.count()) return native.selectOption(value);
    const input = container.locator(select + ' + .sel-wrap input[role="combobox"]:visible');
    await input.click();
    await page.getByRole('option', { name: label, exact: true }).click();
  }

  if (phase === 'c163-dict') {
    await check('short-dictionary-scopes', async (result) => {
      await at(result, 'Открыть полное дерево текстов', async () => {
        await page.goto(app + '#dicts?d=passportPhrases', { waitUntil: 'domcontentloaded' });
        const tree = page.locator('.pt-tree');
        await tree.getByRole('heading', { name: 'Краткое описание — Вело', exact: true }).waitFor();
        const section = tree.locator('section').filter({ has: page.getByRole('heading', { name: 'Краткое описание — Вело', exact: true }) });
        const duplicates = page.locator('.pt-filters').getByText(/^Дубли/);
        await section.getByText(title, { exact: true }).waitFor();
        await tree.getByText('Информирование — указатели и стенды', { exact: true }).waitFor();
        expect(await duplicates.count() === 0
          && await tree.getByText(/^дубль ·/).count() === 0, 'Разные условия всё ещё считаются дублями.');
        await choose(page.locator('.pt-cat-filter'), 'select', 'TRN', 'Уличный тренажёр');
        await section.getByText(title, { exact: true }).waitFor();
        expect(await duplicates.count() === 0
          && !await tree.getByRole('heading', { name: /Баскетбольная стойка|Вазон/ }).count(),
        'TRN показывает чужие корни или глобальные дубли.');
        await themes('dictionary-trn', tree);
        await choose(page.locator('.pt-cat-filter'), 'select', 'BLG', 'Благоустройство');
        await tree.getByText('Информирование', { exact: true }).waitFor();
        await tree.getByText('Информирование — указатели и стенды', { exact: true }).waitFor();
        expect(!await duplicates.count() && !await section.isVisible(),
          'BLG ошибочно скрывает различающиеся варианты или показывает TRN.');
      });
      result.trueDuplicates = 0;
      result.bikeLeafVisibleInTRN = true;
    });
    return;
  }

  const tpl = () => read(templatePath + '?variant=short');
  const focusField = key => book.locator('.bk-toc-focus button.bk-focus-btn').filter({ hasText: key });
  const status = side.getByRole('status', { name: 'Предпросмотр краткого описания' });
  const snapshots = async () => {
    const checks = [];
    for (const [number, doc] of historical) {
      const r = await read(cardPath(doc) + '?readOnly=1');
      expect(r.id === doc && numberOf(r) === number && statusOf(r) === 'issued', 'Не найден выпуск №' + number);
      checks.push({ number, hash: sha({ text: r.textSnapshot, issued: r.issuedAt, printed: r.pdfIssuedAt,
        revision: r.revision, image: r.effectiveImages, standards: r.standardImages }) });
    }
    const original = await read('/api/showcase/6ae1269ae36900370537a2f3/passport-template?variant=short');
    return { checks, original: sha({ defaults: original.defaults, source: original.simpleDescriptionSource, images: original.effectiveImages }) };
  };
  const patch = async (changes, expected, documentCheck) => {
    const body = { changes, expected };
    grant('PATCH', templatePath, (actual, url) => url.search === '?variant=short' && same(actual, body));
    const pending = listen('PATCH', templatePath, { variant: 'short' });
    await button(side, 'Сохранить в шаблон').click();
    const saved = await json(pending, 'Сохранение шаблона');
    expect(documentCheck(saved), 'GET/PATCH не подтвердил выбранные сведения.');
    return saved;
  };
  const cancel = async (dirty = false) => {
    await button(side, 'Отмена').click();
    if (dirty) await button(dialogue.filter({ has: page.getByText('Выйти без сохранения?', { exact: true }) }), 'Выйти').click();
    await button(side, 'Отмена').waitFor({ state: 'hidden' });
  };

  const before = await snapshots();
  let linksHash;
  const photo = await check('fallback-cover', async (result) => {
    await at(result, 'Проверить источник обложки и три паспортных рисунка', async () => {
      const r = await read(productPath);
      const own = await read(ownPath);
      const links = await read(photoPath);
      expect(r.id === id && r.name === itemName && r.sku === 'QA-C163-VELO' && r.photoSource === 'passport'
        && r.photo?.id === coverId && !r.photos?.length && !own.mainPhotoId && !own.photoIds?.length
        && links.length === 3 && links.some(l => l.kind === 'overview' && l.photoId?.id === coverId), 'Исходная карточка не соответствует фикстуре.');
      linksHash = sha(links);
    });
    await at(result, 'Открыть резервную обложку и увеличить рисунок', async () => {
      await page.goto(app + '#products?open=' + id, { waitUntil: 'domcontentloaded' });
      const drawer = page.locator('aside[data-k="drawer"]:visible').filter({ has: page.getByRole('heading', { name: /QA C163 — Вело/ }) });
      await drawer.getByText('Общий вид из паспорта', { exact: true }).waitFor();
      const pic = drawer.locator('.pgal-img:visible');
      await pic.click();
      const zoom = page.getByRole('dialog', { name: 'Фото', exact: true });
      await zoom.locator('img').waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll('.lightbox img')].some(img => img.complete && img.naturalWidth > 0));
      await screenshot('c163-cover-zoom', zoom, 'body > :not(.lightbox) { visibility: hidden !important; }');
      await button(zoom, 'Закрыть фото').click();
      await zoom.waitFor({ state: 'hidden' });
      await themes('cover', drawer);
      grant('PATCH', productPath, (body, url) => !url.search && same(body, { photoIds: [coverId] }));
      const pending = listen('PATCH', productPath);
      await button(drawer, 'Сделать обложкой изделия').click();
      const saved = await json(pending, 'Выбор главного фото');
      const own = await read(ownPath);
      expect(saved.photo?.id === coverId && !saved.photoSource && own.mainPhotoId === coverId
        && (own.photoIds?.[0]?.id || own.photoIds?.[0]) === coverId && sha(await read(photoPath)) === linksHash, 'Обложка или паспортные рисунки не подтверждены.');
      result.adopted = true;
    });
  });

  const edited = await check('first-time-setup', async (result) => {
    need(photo, 'Обложка не прошла приёмку.');
    const initial = await at(result, 'Открыть короткий шаблон нового изделия', () => openTemplate(id, 'bookFor'));
    expect(initial.passportCategory === 'TRN' && !initial.document.kindId && initial.product.facetValueIds == null
      && !initial.defaults.simpleDescription && !initial.simpleDescriptionSource, 'Ожидался чистый короткий шаблон.');
    await at(result, 'Открыть назначение и выбрать вид', async () => {
      await focusField(/^Назначение/).click();
      expect(await side.locator('textarea:visible').count() === 0, 'Сразу открыт ручной ввод назначения.');
      await choose(side, 'select[name="kindId"]', kindId, 'Кардиотренажёр');
      await patch({ kindId }, { kindId: null }, r => r.defaults.kindId === kindId && r.document.purpose === purpose && r.document.elements?.length > 0);
      await setup.getByText(purpose, { exact: true }).waitFor();
    });
    const fac = await read('/api/dicts/productFacets');
    const type = fac.items.find(r => r.code === 'trn.kind');
    const contact = fac.items.find(r => r.code === 'trn.contact');
    expect(oid.test(type?.id) && oid.test(contact?.id), 'Нет критериев TRN.');
    await at(result, 'Выбрать главный критерий, затем подтвердить конструкцию', async () => {
      await button(setup, 'Критерии изделия').click();
      await choose(side, 'select[name="' + type.id + '"]', cardioId, 'Кардио');
      await patch({ facetValueIds: [cardioId] }, { facetValueIds: null }, r => same(r.product.facetValueIds, [cardioId]));
      await button(setup, 'Критерии изделия').click();
      await side.getByText('Дополнительные критерии', { exact: true }).click();
      await choose(side, 'select[name="' + contact.id + '"]', contactId, title);
      await patch({ facetValueIds: [cardioId, contactId] }, { facetValueIds: [cardioId] },
        r => same(r.product.facetValueIds, [cardioId, contactId]) && r.simpleDescriptionSource?.id === leafId);
      await closeBook();
      const reopened = await openTemplate(id, 'bookFor');
      expect(same(reopened.product.facetValueIds, [cardioId, contactId]) && reopened.simpleDescriptionSource?.rootId === rootId
        && reopened.document.simpleDescription?.text === literal, 'Критерии или словарная фраза потерялись после повторного входа.');
      await themes('setup');
    });
    await at(result, 'Сменить критерий в редакторе и отменить', async () => {
      await button(setup, 'Критерии изделия').click();
      await side.getByText('Дополнительные критерии', { exact: true }).click();
      const vals = await read('/api/dicts/productFacetValues');
      const another = vals.items.find(r => r.parentId === contact.id && r.id !== contactId);
      expect(!!another, 'Нужно второе действующее значение конструкции для проверки отмены.');
      await choose(side, 'select[name="' + contact.id + '"]', another.id, another.name);
      await cancel(true);
      expect(same((await tpl()).product.facetValueIds, [cardioId, contactId]), 'Отмена изменила критерии.');
    });
    await at(result, 'Сохранить автоописание из рекомендованных частей', async () => {
      await button(setup, 'Краткое описание').click();
      await status.getByText(text, { exact: true }).waitFor();
      expect(!await side.locator('textarea:visible').count(), 'Автоописание открыло ручной ввод.');
      await side.locator('[title="Убрать «Педаль»"]').click();
      await side.locator('input[placeholder="Найдите по названию"]').click();
      const list = page.locator('.combo-list:visible');
      const recommended = list.getByRole('option').filter({ hasText: /^Педаль/ });
      await recommended.waitFor();
      const labels = (await list.locator('.opt-l').allTextContents()).map(norm);
      expect(same(labels, ['Педаль']), 'В рекомендациях появились неподходящие детали: ' + labels.join(', '));
      await screenshot('c163-recommended-parts', list);
      await recommended.click();
      await list.waitFor({ state: 'hidden' });
      await status.getByText(text, { exact: true }).waitFor();
      result.recommended = labels;
      await themes('parts');
      await patch({ simpleDescription: { mode: 'parts', partIds } }, { simpleDescription: null },
        r => r.simpleDescriptionSource?.kind === 'parts' && r.simpleDescriptionSource.text === text);
    });
    result.cardio = true;
    result.savedConstruction = contactId;
    result.savedLiteral = literal;
    result.generatedText = text;
  });

  await check('sample-and-readback', async (result) => {
    need(edited, 'Подготовка короткого шаблона не прошла приёмку.');
    let current = await tpl();
    if (current.readiness.missing.some(row => row.key === 'maxUsers')) {
      await at(result, 'Ввести вместимость только в тестовом изделии', async () => {
        await focusField(/Пользователей одновременно/).click();
        await side.locator('input[name="maxUsers"]').fill('1');
        current = await patch({ maxUsers: 1 }, { maxUsers: null }, r => r.defaults.maxUsers === 1);
      });
    }
    if (current.readiness.missing.some(row => row.key === 'joints')) {
      await at(result, 'Выбрать соединение только в тестовом изделии', async () => {
        await focusField(/Как соединены части/).click();
        const pick = side.locator('input[role="combobox"]:visible');
        await pick.fill('Болты');
        await page.locator('.combo-list:visible').getByRole('option').filter({ hasText: /^Болты/ }).click();
        current = await patch({ joints: ['bolts'] }, { joints: null }, r => same(r.defaults.joints, ['bolts']));
      });
    }
    expect(current.readiness.ready, 'Тестовый шаблон не готов: ' + current.readiness.missing.map(row => row.key).join(', '));
    const numbersBefore = await lastNumbers();
    const preview = '/api/passports/preview';
    const payload = { productId: id, presentationVersion: 1, variant: 'short', mode: 'pages', pack: 'passport' };
    const pdfDialog = dialogue.filter({ has: page.locator('iframe[title="Образец паспорта без номера"]') });
    await at(result, 'Открыть образец PDF без выпуска', async () => {
      grant('POST', preview, (body, url) => !url.search && exactBody(body, payload));
      const pending = listen('POST', preview, {}, 75_000);
      await button(book, 'Образец').click();
      const response = await pending;
      expect(!!response, 'Образец не получил ответ.');
      result.pdf = await inspectPdf(response, text);
      expect(result.pdf.hasDescription && result.pdf.hasDraftMark && !result.pdf.hasAnyPassportNumber
        && result.pdf.imageCount >= 3 && !result.pdf.hasTechnicalComposition, 'PDF не подтвердил краткое описание и рисунки.');
      await pdfDialog.locator('iframe[src^="blob:"]').waitFor();
      await button(pdfDialog, 'Вернуться к правке').click();
    });
    expect((await read(listPath)).total === 0 && same(await lastNumbers(), numbersBefore), 'Образец создал паспорт или номер.');
    expect(sha(await read(photoPath)) === linksHash, 'Паспортные связи изменились.');
    result.noPassport = true;
  });
  await check('historical-integrity', async (result) => {
    const after = await snapshots();
    expect(same(before, after), 'Выпуски №611–613 или исходный 1066 изменились.');
    result.unchanged = after;
  });
}, script);
