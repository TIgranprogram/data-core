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
