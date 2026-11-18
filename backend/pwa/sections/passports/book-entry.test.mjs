import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function load({ canEdit = true, result = { id: 'draft-1' } } = {}) {
  const books = [];
  let route = { section: 'products', params: { bookFor: 'product-1' } };
  const context = vm.createContext({

    session: { canEdit, seesDocs: () => true },
    current: () => route,
    patch: (p) => { route = { ...route, params: { ...route.params, ...p } }; },
    toast() {}, toastError() {},
    openBookForProduct: async (id, opts) => { books.push({ id, opts }); return result; },

  });
  const source = readFileSync(new URL('./book-entry.js', import.meta.url), 'utf8')
    .replace(/^import .+;\s*$/gm, '').replace('export async function', 'async function');
  vm.runInContext(source + '\nglobalThis.open = openProductBookLink;', context);
  return { open: () => context.open('product-1'), books, route: () => route };
}

test('ссылка зовёт общий вход книжки по изделию один раз, закрытие убирает параметр', async () => {
  const t = load();
  await t.open(); await t.open();
  assert.equal(t.books.length, 1);
  assert.equal(t.books[0].id, 'product-1');
  assert.equal(t.books[0].opts.draftOnly, true);
  assert.equal(t.books[0].opts.isCurrent(), true);
  t.books[0].opts.onClose();
  assert.equal(t.route().params.bookFor, undefined);
});
test('неудавшееся открытие снимает параметр', async () => {
  const t = load({ result: null });
  await t.open();
  assert.equal(t.route().params.bookFor, undefined);
});
test('вход по ссылке учитывает право редактирования документов', async () => {
  const t = load({ canEdit: false });
  await t.open();
  assert.equal(t.books.length, 0);
});

test('общий вход сообщает о неудачной загрузке книжки вместо успешного открытия', async () => {
  const context = vm.createContext({
    api: async () => ({ items: [{ id: 'draft-1', status: 'draft' }] }),
    toast() {}, toastError() {},
    openBookEditor: async () => false,
  });
  const source = readFileSync(new URL('./open-book.js', import.meta.url), 'utf8')
    .replace(/^import .+;\s*$/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\nglobalThis.open = openBookForProduct;', context);
  assert.equal(await context.open('product-1'), null);
});

test('существующий черновик открывается без выбора фирмы или создания нового', async () => {
  let opened = 0;
  const context = vm.createContext({
    api: async (_path, options) => { assert.equal(options?.method, undefined); return { items: [{ id: 'draft-1', status: 'draft' }] }; },
    toast() {}, toastError(e) { throw e; },
    createBookDraft() { assert.fail('Нельзя создавать второй паспорт'); },
    openBookEditor: async () => { opened++; },
  });
  const source = readFileSync(new URL('./open-book.js', import.meta.url), 'utf8')
    .replace(/^import .+;\s*$/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\nglobalThis.open = openBookForProduct;', context);
  assert.equal((await context.open('product-1')).id, 'draft-1');
  assert.equal(opened, 1);
});


for (const draftOnly of [false, true]) test(`issued без draft: draftOnly=${draftOnly} сохраняет правильный контекст`, async () => {
  const queries = [], creates = [], books = [];
  const context = vm.createContext({
    api: async (_path, options) => { queries.push(options.query); return { items: [{ id: 'old-issued', status: 'issued' }] }; },
    createBookDraft: async (body, isCurrent) => { assert.equal(isCurrent(), true); creates.push(body); return { id: 'fresh-draft', status: 'draft', effectiveImages: [{ photoId: 'new-png' }] }; },
    openBookEditor: async (row) => { books.push(row); }, toast() {}, toastError(e) { throw e; },
  });
  const source = readFileSync(new URL('./open-book.js', import.meta.url), 'utf8').replace(/^import .+;\s*$/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\nglobalThis.open = openBookForProduct;', context);
  const row = await context.open('product-1', { draftOnly });
  assert.equal(row.id, draftOnly ? 'fresh-draft' : 'old-issued');
  assert.equal(creates.length, draftOnly ? 1 : 0);
  assert.equal(queries[0].status, draftOnly ? 'draft' : undefined);
  assert.equal(books[0].id, row.id);
});

test('draftOnly переиспользует существующий draft и не создаёт копию', async () => {
  const context = vm.createContext({
    api: async () => ({ items: [{ id: 'issued', status: 'issued' }, { id: 'draft', status: 'draft' }] }),
    createBookDraft: () => assert.fail('Лишнее создание'), openBookEditor: async () => true, toast() {}, toastError(e) { throw e; },
  });
  const source = readFileSync(new URL('./open-book.js', import.meta.url), 'utf8').replace(/^import .+;\s*$/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\nglobalThis.open = openBookForProduct;', context);
  assert.equal((await context.open('product-1', { draftOnly: true })).id, 'draft');
});


test('правило подтверждает три новых связи после targeted удаления и до сообщения об успехе', () => {
  const source = readFileSync(new URL('../../ilogic/passport-images.iLogicVb', import.meta.url), 'utf8');
  const body = source.slice(source.indexOf('Dim newLinks As New'), source.indexOf('Function ReadPassportSlots'));
  assert.ok(body.indexOf('For Each linkId As String In previous.Keys') < body.indexOf('VerifyReadSlots(client, photosPath, newLinks)'));
  assert.ok(body.indexOf('VerifyReadSlots(client, photosPath, newLinks)') < body.indexOf('If Not writeDepth Then Return productId'));
  const verify = source.slice(source.indexOf('Sub VerifyReadSlots'), source.indexOf('Function UploadPng'));
  assert.match(verify, /saved.Count <> 3/);
  assert.match(verify, /newLinks.Count <> 3/);
  assert.match(verify, /saved.ContainsKey\(newLinks\(i\)\)/);
  assert.match(verify, /saved\(newLinks\(i\)\) <> expectedKinds\(i\)/);
  assert.match(verify, /Count\(saved.Values, Function\(kind\) kind = expectedKinds\(i\)\) <> 1/);
  assert.match(source, /Ранее выданный паспорт сохранит прежний снимок/);
});
