import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./salesorders.js', import.meta.url), 'utf8');
const pdf = readFileSync(new URL('./order-attachments-zip.js', import.meta.url), 'utf8');
const options = readFileSync(new URL('./order-options.js', import.meta.url), 'utf8');
const hasProductionNumber = vm.runInNewContext(options.match(/^export const hasProductionNumber = (.*);$/m)[1]);
const named = name => (source + '\n' + options).match(new RegExp(`^(?:export )?const ${name} = .*;$`, 'm'))[0].replace(/^export /, '');
const sandbox = vm.createContext({ badge: () => '', STAGE: {}, hasProductionNumber });
const labels = vm.runInContext(['prodNo', 'documentKind', 'heading', 'orderCrumb', 'orderLabel'].map(named).join('\n')
  + '\n({ documentKind, heading, orderCrumb, orderLabel });', sandbox);
const search = source.slice(source.indexOf('  searchRow:'), source.indexOf('  open:', source.indexOf('  searchRow:')));
const { searchRow } = vm.runInContext('({' + search + '})', sandbox);
const contract = { id: '6b03d159b607f46540f3aa94', orderNo: '18/11/45', customer: 'ДОРТРАНС', lineCount: 8 };

test('неназначенный договор сохраняет свой номер в заголовке, типе, крошке и поиске', () => {
  for (const row of [contract, { ...contract, productionNo: null, orderNos: ['18/11/45'] }, { ...contract, orderNos: [] }]) {
    assert.equal(labels.documentKind(row), 'Договор');
    assert.equal(labels.heading(row), 'Договор № 18/11/45');
    assert.equal(labels.orderCrumb(row), 'Договор № 18/11/45');
    assert.equal(searchRow(row).title, 'Договор № 18/11/45 · ДОРТРАНС');
    assert.equal(labels.orderLabel(row), 'Договор № 18/11/45 · ДОРТРАНС');
  }
  assert.match(source, /id: 'salesorders',\s+kind: documentKind,/);
  assert.match(source, /title: \(r\) => `\$\{heading\(r\)\} · \$\{names\(r.customers\)\}/);
});

test('производственный заказ использует свой номер, не номер одного из договоров', () => {
  const row = { ...contract, productionNo: '257-26', orderNos: ['18/11/45', '18/11/46'] };
  assert.equal(labels.documentKind(row), 'Заказ');
  assert.equal(labels.heading(row), 'Заказ № 257-26');
  assert.equal(labels.orderCrumb(row), 'Заказ № 257-26');
  assert.equal(searchRow(row).title, 'Заказ № 257-26 · ДОРТРАНС');
  assert.equal(labels.orderLabel(row), '№ 257-26 · договор 18/11/45 · ДОРТРАНС');
});

test('PDF сохраняет маршрут печати и различает резервные имена договора и заказа', async () => {
  const calls = [];
  const context = vm.createContext({
    apiFile: async (path, options) => { calls.push({ path, ...options }); return options.fallback; },
    hasProductionNumber, toast: () => {}, toastError: error => { throw error; },
  });
  const action = vm.runInContext(pdf.slice(pdf.indexOf('export const orderPdfAction =')).replace('export const', 'const') + '\norderPdfAction;', context);
  await action.run(contract);
  await action.run({ ...contract, productionNo: '257-26', key: '257-26' });
  assert.equal(calls[0].path, `/production-orders/${contract.id}/pdf`);
  assert.equal(calls[0].fallback, 'Договор_18/11/45.pdf');
  assert.equal(calls[1].path, '/production-orders/257-26/pdf');
  assert.equal(calls[1].fallback, 'Заказ_257-26.pdf');
  assert.equal(action.label, 'PDF позиций');
});

// Подблок той же карточки должен сохранять различие и после загрузки позиций.
test('подблок выполнения называет договор договором и заказ заказом', () => {
  const expression = source.match(/parts\.run = lazySec\((.+), 'run',/)[1];
  assert.equal(vm.runInNewContext(expression, { r: contract, hasProductionNumber }), 'Выполнение договора');
  assert.equal(vm.runInNewContext(expression, { r: { ...contract, productionNo: '257-26' }, hasProductionNumber }), 'Выполнение заказа');
});

test('пробельный и null номер производства не превращают договор в заказ', async () => {
  const calls = [];
  const context = vm.createContext({
    hasProductionNumber,
    apiFile: async (path, options) => { calls.push({ path, ...options }); return options.fallback; },
    toast: () => {}, toastError: error => { throw error; },
  });
  const action = vm.runInContext(pdf.slice(pdf.indexOf('export const orderPdfAction =')).replace('export const', 'const') + '\norderPdfAction;', context);
  const expression = source.match(/parts\.run = lazySec\((.+), 'run',/)[1];
  for (const productionNo of ['   ', null]) {
    const row = { ...contract, productionNo };
    assert.equal(labels.documentKind(row), 'Договор');
    assert.equal(labels.heading(row), 'Договор № 18/11/45');
    assert.equal(labels.orderCrumb(row), 'Договор № 18/11/45');
    assert.equal(labels.orderLabel(row), 'Договор № 18/11/45 · ДОРТРАНС');
    assert.equal(searchRow(row).title, 'Договор № 18/11/45 · ДОРТРАНС');
    assert.equal(vm.runInNewContext(expression, { r: row, hasProductionNumber }), 'Выполнение договора');
    await action.run(row);
  }
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.path, `/production-orders/${contract.id}/pdf`);
    assert.equal(call.fallback, 'Договор_18/11/45.pdf');
  }
});

test('подвал передаёт эталону подпись всего договора или производственного заказа', () => {
  const footer = readFileSync(new URL('./order-footer.js', import.meta.url), 'utf8');
  const options = [];
  const context = vm.createContext({
    hasProductionNumber, ACTIONS: [],
    footerBar: value => { options.push(value); return { el: {}, update() {} }; },
  });
  const mount = vm.runInContext(footer.slice(footer.indexOf('export function orderFooter(')).replace('export function', 'function') + '\norderFooter;', context);
  for (const productionNo of [undefined, null, '   ', '257-26']) {
    mount({ ...contract, productionNo }, { orders: [] }, new Map(), {});
  }
  assert.deepEqual(options.map(value => value.title), ['Весь договор', 'Весь договор', 'Весь договор', 'Весь заказ']);
});
