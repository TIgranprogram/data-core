import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

function load(file, globals, expose) {
  const context = vm.createContext(globals);
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
    .replace(/^import .+;\s*$/gm, '').replace(/export /g, '');
  vm.runInContext(source + '\nglobalThis.subject = ' + expose, context);
  return context.subject;
}

for (const param of ['templateFor', 'bookFor']) {
  test(`ссылка ${param} открывает шаблон один раз и оставляет открытую карточку изделия`, async () => {
    const books = [];
    let route = { section: 'products', params: { [param]: 'product-1', open: 'product-1' } };
    const open = load('./book-entry.js', {
      session: { canEdit: true, sees: () => true, seesDocs: () => false },
      current: () => route,
      patch: (p) => { route = { ...route, params: { ...route.params, ...p } }; },
      openBookForProduct: async (id, opts) => { books.push({ id, opts }); return { mode: 'template' }; },
    }, 'openProductBookLink');
    await open('product-1');
    await open('product-1');
    assert.equal(books.length, 1);
    assert.equal(books[0].id, 'product-1');
    assert.equal(books[0].opts.isCurrent(), true);
    books[0].opts.onClose();
    assert.equal(route.params[param], undefined);
    assert.equal(route.params.open, 'product-1');
  });
}

test('неудавшееся открытие освобождает адрес и разрешает повтор', async () => {
  let route = { section: 'products', params: { templateFor: 'product-1' } };
  let calls = 0;
  const open = load('./book-entry.js', {
    session: { canEdit: true, sees: () => true },
    current: () => route,
    patch: (p) => { route = { ...route, params: { ...route.params, ...p } }; },
    openBookForProduct: async () => { calls++; return null; },
  }, 'openProductBookLink');
  await open('product-1');
  assert.equal(route.params.templateFor, undefined);
  route.params.templateFor = 'product-1';
  await open('product-1');
  assert.equal(calls, 2);
});

test('открытие шаблона читает проекцию изделия без поиска и создания паспортов', async () => {
  const template = { mode: 'template', productId: 'product-1', document: {} };
  const open = load('./open-book.js', {
    loadBookTemplate: async (productId, variant) => {
      assert.equal(productId, 'product-1');
      assert.equal(variant, 'short');
      return template;
    },
    createBookDraft: () => assert.fail('Открытие шаблона не создаёт паспорт'),
    toastError: (e) => { throw e; },
    openBookEditor: async (instance, options) => {
      assert.equal(instance, null);
      assert.equal(options.template, template);
    },
  }, 'openBookForProduct');
  assert.equal(await open('product-1'), template);
  assert.equal(await open('product-1', { isCurrent: () => false }), null);
});

test('позиции одного изделия передают свои заказы и открывают возвращённые id', async () => {
  const posts = [];
  const opened = [];
  const open = load('./open-book.js', {
    statusOf: (r) => r.status,
    createBookDraft: async (body) => {
      posts.push(body);
      return { id: 'passport-' + body.incomeId, status: 'draft', variant: body.variant };
    },
    toastError: (e) => { throw e; },
    openBookEditor: async (id) => opened.push(id),
  }, 'openBookForLine');
  await open({ productId: 'p', salesOrderId: 'a', incomeId: '1' });
  await open({ productId: 'p', salesOrderId: 'b', incomeId: '2', supplierOrgId: 'org-b', variant: 'full' });
  assert.deepEqual(JSON.parse(JSON.stringify(posts)), [
    { presentationVersion: 1, variant: 'short', productId: 'p', salesOrderId: 'a', incomeId: '1' },
    { presentationVersion: 1, variant: 'full', productId: 'p', salesOrderId: 'b', incomeId: '2', supplierOrgId: 'org-b' },
  ]);
  assert.deepEqual(opened, ['passport-1', 'passport-2']);
});

test('PATCH сравнивает только изменённые собственные ключи и корни', () => {
  const patch = load('./book-template.js', {}, 'templatePatch');
  const previous = { manualPurpose: 'Свой текст', textChoices: { x: 'old', y: 'other' }, width: 800 };
  const changes = { textChoices: { x: 'new', z: 'fresh' }, simpleDescription: { text: 'Каркас', partIds: [] } };
  assert.deepEqual(JSON.parse(JSON.stringify(patch(previous, changes))), {
    expected: { textChoices: { x: 'old', z: null }, simpleDescription: null },
    changes,
  });
});

test('после потери ответов повтор удерживает ключ создания и затем тот же id выпуска', async () => {
  const create = [];
  const issue = [];
  let choices = 0;
  let issued = false;
  const open = load('./book-issue.js', {
    session: { user: { id: 'a' } },
    crypto: { randomUUID: () => 'stable-key' },
    chooseStandaloneFirm: async () => { choices++; return 'firm'; },
    createBookDraft: async (body) => {
      create.push(body);
      if (create.length === 1) throw new Error('Нет связи');
      return { id: 'same-instance', status: 'draft', presentationVersion: 1, variant: 'short' };
    },
    api: async (path, options) => {
      issue.push({ path, options });
      if (issue.length === 1) throw new Error('Ответ потерян');
      issued = true;
      return { id: 'same-instance', passportNumber: '26' };
    },
    statusOf: (row) => row.status,
    toast() {},
  }, 'issueBookTemplate');
  const tpl = { productId: 'p', variant: 'short' };
  await assert.rejects(open(tpl, undefined, () => true), /Нет связи/);
  await assert.rejects(open(tpl, undefined, () => true), /Ответ потерян/);
  const result = await open(tpl, undefined, () => true);
  assert.equal(choices, 1);
  assert.equal(create.length, 2);
  assert.equal(create[0], create[1]);
  assert.equal(create[0].creationKey, 'stable-key');
  assert.equal(create[0].supplierOrgId, 'firm');
  assert.equal(create[0].salesOrderId, undefined);
  assert.equal(issue[0].path, '/passports/same-instance/issue');
  assert.equal(issue[1].path, issue[0].path);
  assert.equal(result.passportNumber, '26');
  assert.equal(issued, true);
});
