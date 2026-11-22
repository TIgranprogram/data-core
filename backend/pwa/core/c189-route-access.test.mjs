import assert from 'node:assert/strict';
import test from 'node:test';
import { canOpen, canFollow, mobileOnly, stockView } from './route-access.js';
import { buildAtlasModel, visibleAtlas } from '../sections/atlas-model.js';

globalThis.location = { pathname: '/app/' };
const { session } = await import('./api.js');
const account = (role, extra = {}) => Object.create(session, { user: { value: { role, ...extra } } });
const menu = ['stock', 'docs', 'money', 'payroll', 'staff', 'history', 'kit'];
const atlasFor = (who) => visibleAtlas(buildAtlasModel(), href => canFollow(who, href), false);

for (const [role, granted] of [
  ['user', ['stock']],
  ['manager', ['stock', 'docs', 'money']],
  ['accountant', ['stock', 'docs', 'money', 'payroll']],
  ['director', ['stock', 'docs', 'money', 'payroll', 'staff', 'history']],
  ['admin', menu],
]) {
  test('Меню и прямая ссылка встроенной роли ' + role, () => {
    const who = account(role);
    assert.deepEqual(menu.filter(id => who.sees(id)), granted);
    assert.deepEqual(menu.filter(id => canFollow(who, '#' + id)), granted);
  });
}

test('Старая галочка паспортов открывает архив и его карточку, галочка продукции открывает состав', () => {
  const docs = account('r-docs', { baseRole: 'manager', sections: ['passports'] });
  const products = account('r-products', { baseRole: 'manager', sections: ['products'] });
  for (const href of ['#docs', '#passports', '#docs?tab=archive&of=passarchive&open=fixture']) {
    assert.equal(canFollow(docs, href), true);
    assert.equal(canFollow(products, href), false);
  }
  assert.equal(canFollow(products, '#home?of=composition&open=fixture'), true);
  assert.equal(canFollow(docs, '#home?of=composition&open=fixture'), false);
});

for (const [label, view] of [['Труборез', 'pipe'], ['Трубарез', 'pipe'], ['Лазер лист', 'sheet']]) {
  test(label + ' видит склад, журнал и их часть карты', () => {
    const who = account('r-metal', { roleLabel: label, baseRole: 'manager', sections: ['stock', 'salesorders', 'money'] });
    assert.equal(stockView(who.user), view);
    assert.deepEqual(['stock', 'movements', 'atlas', 'search', 'money', 'salesorders', 'chat'].filter(id => who.sees(id)), ['stock', 'movements', 'atlas']);
    assert.equal(canFollow(who, '#stock?open=fixture'), true);
    assert.equal(canFollow(who, '#stock?of=salesorder&open=fixture'), false);
    const { nodes, edges } = atlasFor(who), ids = new Set(nodes.map(n => n.id));
    assert.ok(ids.has('stock') && ids.has('movements') && !ids.has('money') && !ids.has('salesorders'));
    assert.ok(nodes.every(n => !n.href || canFollow(who, n.href)));
    assert.ok(edges.every(e => ids.has(e.from) && ids.has(e.to)));
  });
}

test('Мобильный склад работает отдельно, владелец сохраняет доступ при старом списке разделов', () => {
  const who = account('r-mobile', { baseRole: 'user', sections: ['stock-mobile'] });
  assert.equal(mobileOnly(who.user), true);
  assert.deepEqual(['home', 'stock', 'stock-mobile', 'atlas'].filter(id => who.sees(id)), ['stock-mobile']);
  assert.equal(canFollow(who, '#stock-mobile?of=stock&open=fixture'), false);
  const owner = account('director', { isOwner: true, sections: ['stock-mobile'] });
  assert.equal(mobileOnly(owner.user), false);
  assert.equal(canFollow(owner, '#money'), true);
});

test('Индивидуальная галочка денег, базовая роль и владелец панели проверяются независимо', () => {
  const who = account('r-ops', { baseRole: 'accountant', canMoney: false, sections: ['money', 'salesorders', 'payroll', 'stock'] });
  for (const href of ['#money', '#payroll', '#home?of=expense&new=1', '#salesorders?of=payout&open=fixture']) {
    assert.equal(canFollow(who, href), false, href);
  }
  assert.equal(canFollow(who, '#salesorders?of=salesorder&open=fixture'), true);
  assert.equal(canOpen(who, 'unregistered'), false);
});
