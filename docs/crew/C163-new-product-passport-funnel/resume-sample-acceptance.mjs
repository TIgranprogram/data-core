import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual as same } from 'node:util';

const file = fileURLToPath(import.meta.url);
const guards = path.basename(path.dirname(file)) === 'logs'
  ? '../../docs/crew/C155-passport-owner-queue/acceptance.test.mjs' : '../C155-passport-owner-queue/acceptance.test.mjs';
const { runFocusedAcceptance } = await import(guards);
const id = '6aff3ba30929d7d70f4b2451';
const coverId = '6aff3ba70929d7d70f4b245b';
const kind = '6af707fdc451d4c05df6a045';
const facets = ['6aeea9373b8b9255839ab433', '6aff3bf00929d7d70f4b24ea'];
const partIds = ['6adceeeb3ca001b9b3b0e574', '6adceeeb3ca001b9b3b0e575', '6adceeeb3ca001b9b3b0e57a', '6aff3bec0929d7d70f4b24e3'];
const text = 'Изделие состоит из несущей рамы, ручки, сиденья и педали.';
const product = '/api/showcase/' + id;
const template = product + '/passport-template';
const photos = '/api/products/' + id + '/photos?purpose=passport';
const rows = '/api/passports?productId=' + id + '&limit=5';
const preview = '/api/passports/preview';
const issued = [['611', '6afefa546402b642a6610a8b'], ['612', '6aff0bf134de43c56e5ac63f'], ['613', '6aff2b122d9e948b326339c6']];
const fingerprint = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const unchangedFields = t => ({ kind: t.defaults.kindId, facets: t.product.facetValueIds, defaults: Object.fromEntries(Object
  .entries(t.defaults).filter(([key]) => key !== 'joints')), pictures: t.effectiveImages, text: t.simpleDescriptionSource });

await runFocusedAcceptance('c163', async ({
  page, book, button, check, at, read, openTemplate, expect, listen, grant, json, inspectPdf, lastNumbers, cardPath, statusOf, numberOf, screenshot,
}) => {
  const oldState = async () => {
    const records = [];
    for (const [number, key] of issued) {
      const row = await read(cardPath(key) + '?readOnly=1');
      expect(numberOf(row) === number && statusOf(row) === 'issued', 'Прежний паспорт недоступен.');
      records.push({ number, sha256: fingerprint({ text: row.textSnapshot, revision: row.revision,
        issuedAt: row.issuedAt, pdfIssuedAt: row.pdfIssuedAt, images: row.effectiveImages, standard: row.standardImages }) });
    }
    const t = await read('/api/showcase/6ae1269ae36900370537a2f3/passport-template?variant=short');
    return { records, source1066: fingerprint(unchangedFields(t)) };
  };
  await check('resume-only-joints-and-sample', async result => {
    const card = await read(product);
    const t = await at(result, 'Сверить точное состояние продолжения', () => openTemplate(id, 'bookFor'));
    const links = await read(photos);
    expect(card.id === id && card.sku === 'QA-C163-VELO' && card.name === 'QA C163 — Вело' && card.photo?.id === coverId
      && same(card.photos?.map(p => p.id), [coverId]) && t.defaults.kindId === kind && same(t.product.facetValueIds, facets)
      && same(t.defaults.simpleDescription, { mode: 'parts', partIds }) && t.simpleDescriptionSource?.text === text
      && t.defaults.maxUsers === 1 && t.defaults.joints == null
      && same(t.readiness.missing?.map(r => r.key), ['joints'])
      && links.length === 3 && (await read(rows)).total === 0, 'Текущее состояние отличается. Продолжение не разрешено.');
    const initial = await oldState();
    const numbers = await lastNumbers();
    const side = book.locator('.bk-side-slot');
    await at(result, 'Отметить болты как тестовое значение', async () => {
      await book.locator('.bk-toc-focus button.bk-focus-btn').filter({ hasText: /Как соединены части/ }).click();
      const tags = side.getByRole('group', { name: 'Как соединено', exact: true });
      const bolt = tags.locator('button[data-v="bolts"]');
      await bolt.waitFor({ state: 'visible' });
      expect(await bolt.getAttribute('aria-pressed') === 'false', 'Болты уже отмечены.');
      await bolt.click();
      expect(await bolt.getAttribute('aria-pressed') === 'true', 'Нажатие не изменило состояние кнопки.');
      const body = { changes: { joints: ['bolts'] }, expected: { joints: null } };
      grant('PATCH', template, (b, url) => url.search === '?variant=short' && same(b, body));
      const wait = listen('PATCH', template, { variant: 'short' });
      await button(side, 'Сохранить в шаблон').click();
      const reply = await json(wait, 'Сохранение соединений');
      expect(same(reply.defaults.joints, ['bolts']) && reply.readiness.ready
        && same(unchangedFields(reply), unchangedFields(t)), 'Изменились другие сведения или шаблон по-прежнему не готов.');
      result.ready = true;
    });
    await at(result, 'Открыть образец без выпуска', async () => {
      const options = { productId: id, presentationVersion: 1, variant: 'short', mode: 'pages', pack: 'passport' };
      grant('POST', preview, (b, url) => !url.search && same(b, options));
      const pending = listen('POST', preview, {}, 75_000);
      await button(book, 'Образец').click();
      const response = await pending;
      expect(response, 'Образец не получил ответ.');
      result.pdf = await inspectPdf(response, text);
      expect(result.pdf.hasDescription && result.pdf.hasDraftMark && !result.pdf.hasAnyPassportNumber
        && result.pdf.imageCount >= 3 && !result.pdf.hasTechnicalComposition, 'PDF не подтвердил описание или рисунки.');
      const dialog = page.getByRole('dialog').filter({ has: page.locator('iframe[title="Образец паспорта без номера"]') });
      await dialog.locator('iframe[src^="blob:"]').waitFor();
      await button(dialog, 'Вернуться к правке').click();
      await screenshot('c163-ready-after-sample');
    });
    await at(result, 'Сверить шаблон, номера и исторические выпуски', async () => {
      const end = await read(template + '?variant=short');
      expect(end.readiness.ready && same(end.defaults.joints, ['bolts']) && same(unchangedFields(end), unchangedFields(t))
        && same(await read(photos), links) && (await read(product)).photo?.id === coverId
        && (await read(rows)).total === 0 && same(await lastNumbers(), numbers) && same(await oldState(), initial),
      'Изменились фотографии, прежние выпуски или номера паспортов.');
      result.zeroPassports = true;
      result.historical = initial;
    });
  });
}, file);
