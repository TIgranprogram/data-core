import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const code = readFileSync(new URL('./kp-cart.js', import.meta.url), 'utf8')
  .replace(/^import .*\r?\n/gm, '').replace(/^export /gm, '');
const product = { id: 'bridge', sku: 'М-1', name: 'Мостик', price: 1000 };
const edits = { qty: 2.5, price: 1234.5, unit: 'компл.', color: 'Синий', size: '3×4' };
const firms = [0, 3, 5].map((pct, i) => ({ id: `firm-${i}`, name: `Фирма ${i + 1}`, pct }));
const saved = { items: firms.map((f) => ({ id: `offer-${f.id}` })) };

function fixture(post) {
  const storage = new Map();
  const requests = [];
  const prefs = [];
  const button = (opts) => ({ ...opts, focus() {} });
  const stack = (...children) => ({ children, replaceChildren() {}, focus() {} });
  const context = vm.createContext({
    localStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    button, stack, hint: () => ({}), toast() {}, sumOf: () => 1, money: String,
    firmsStep: () => ({ el: {}, picked: () => firms, bad: () => '' }),
    createPack: (body) => { requests.push(structuredClone(body)); return post(); },
    writePrefs: (value) => prefs.push(value),
  });
  const { kpAdd, loadCart, saveCart, cartOfferItems, cartPack } = vm.runInContext(
    code + '\n({ kpAdd, loadCart, saveCart, cartOfferItems, cartPack });', context,
  );
  kpAdd(product);
  const lines = loadCart();
  Object.assign(lines[0], edits);
  saveCart(lines);
  const pack = cartPack({ companies: firms, companyId: () => firms[0].id, lines: () => lines, onMode() {} });
  const state = {};
  pack.bindSave((enabled, label) => Object.assign(state, { enabled, label }));
  pack.el.children[0].onClick();
  pack.sync();
  const body = { customer: 'Школа', terms: 'Ручные условия', items: cartOfferItems(lines) };
  return { kpAdd, loadCart, pack, body, requests, prefs, state };
}

test('один набор из корзины и три наценки отправляются одним запросом', async () => {
  const { pack, body, requests, prefs, loadCart, state } = fixture(async () => saved);
  assert.deepEqual(state, { enabled: true, label: 'Создать 3 КП' });
  assert.equal(await pack.submit(body), 'offer-firm-0');
  assert.deepEqual(requests, [{
    customer: 'Школа', terms: 'Ручные условия',
    items: [{ productId: 'bridge', productSku: 'М-1', productName: 'Мостик', quantity: 2.5, unitPrice: 1234.5, unit: 'компл.', color: 'Синий', size: '3×4' }],
    companies: firms.map(({ id, pct }) => ({ companyId: id, markupPercent: pct })),
  }]);
  assert.equal(prefs.length, 1);
  assert.equal(loadCart().length, 0);
});

test('ошибка и неполное подтверждение сохраняют корзину и ввод для повтора', async () => {
  let attempt = 0;
  const { pack, body, requests, prefs, loadCart } = fixture(async () => {
    if (++attempt === 1) throw new Error('Сервер отказал');
    if (attempt === 2) return { items: saved.items.slice(0, 1) };
    return saved;
  });
  await assert.rejects(pack.submit(body), /Сервер отказал/);
  await assert.rejects(pack.submit(body), /проверьте список КП/i);
  assert.equal(prefs.length, 0);
  assert.equal(loadCart()[0].price, edits.price);
  await pack.submit(body);
  assert.deepEqual(requests, [requests[0], requests[0], requests[0]]);
  assert.equal(loadCart().length, 0);
});

test('успешный запрос не очищает корзину, изменённую во время сохранения', async () => {
  const { pack, body, kpAdd, loadCart } = fixture(async () => {
    kpAdd({ id: 'bench', name: 'Скамья' });
    return saved;
  });
  await pack.submit(body);
  assert.equal(loadCart().map((line) => line.id).join(','), 'bridge,bench');
});
