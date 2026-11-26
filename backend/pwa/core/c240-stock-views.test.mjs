import assert from 'node:assert/strict';
import test from 'node:test';
import { canFollow, canViewStock, stockScreenAccess } from './route-access.js';
import { fieldsOf, rememberRoles, setViewAs, applyView, syncViewAsRoles, clearViewAsStore } from './view-as.js';

globalThis.location = { pathname: '/app/' };
const { session } = await import('./api.js');
const account = (role, extra = {}) => Object.create(session, { user: { value: { role, ...extra } } });

for (const [title, who, views, readOnly] of [
  ['директор старого профиля', account('director', { sections: ['stock'] }), ['pipe', 'sheet'], true],
  ['своя директорская роль', account('r-chief', { baseRole: 'director', sections: ['stock'] }), ['pipe', 'sheet'], true],
  ['явно отключённые дополнительные экраны', account('director', { sections: ['stock'], stockViews: [] }), [], true],
  ['только трубы', account('director', { sections: ['stock'], stockViews: ['pipe'] }), ['pipe'], true],
  ['только листы', account('manager', { sections: ['stock'], stockViews: ['sheet'] }), ['sheet'], true],
  ['менеджер без настройки', account('manager', { sections: ['stock'] }), [], true],
  ['наблюдатель без настройки', account('user', { sections: ['stock'] }), [], true],
  ['нет раздела склада', account('director', { sections: ['products'], stockViews: ['pipe', 'sheet'] }), [], true],
  ['недопустимая null настройка', account('director', { sections: ['stock'], stockViews: null }), [], true],
  ['администратор', account('admin', { sections: [], stockViews: [] }), ['pipe', 'sheet', 'wood'], false],
  ['владелец', account('user', { isOwner: true, sections: ['stock-mobile'], stockViews: [] }), ['pipe', 'sheet', 'wood'], false],
  ['труборез со списком чужих экранов', account('r-pipe', { baseRole: 'manager', roleLabel: 'Труборез', sections: ['stock'], stockViews: ['sheet'] }), ['pipe'], false],
  ['лазер лист со списком чужих экранов', account('r-sheet', { baseRole: 'manager', roleLabel: 'Лазер лист', sections: ['stock'], stockViews: ['pipe'] }), ['sheet'], false],
  ['деревообработка', account('r-wood', { baseRole: 'manager', roleLabel: 'Деревообработка', sections: ['stock'], stockViews: ['pipe', 'sheet'] }), ['wood'], false],
  ['только мобильный склад', account('r-mobile', { baseRole: 'director', sections: ['stock-mobile'], stockViews: ['pipe', 'sheet'] }), [], true],
]) {
  test(title + ': меню, URL и выбор grid согласованы', () => {
    for (const view of ['pipe', 'sheet', 'wood']) {
      assert.equal(canViewStock(who, view), views.includes(view), view);
      assert.equal(canFollow(who, '#stock?view=' + view), views.includes(view), view);
      const screen = stockScreenAccess(who, view);
      assert.equal(screen.allowed, views.includes(view));
      if (screen.allowed) assert.equal(screen.readOnly, readOnly, view);
    }
  });
}

test('рабочий открывает родной grid без view, дополнительный список не меняет базовую роль и разделы', () => {
  const who = account('r-pipe', { baseRole: 'manager', roleLabel: 'Труборез', sections: ['stock'], stockViews: ['sheet'] });
  assert.deepEqual(stockScreenAccess(who), { allowed: true, view: 'pipe', readOnly: false });
  assert.equal(who.role, 'manager');
  assert.equal(who.canMoney, true);
  assert.equal(who.sees('salesorders'), false);
});

test('просмотр роли сохраняет отличие наследования от пустого списка и не наследует настройку admin', async () => {
  const memory = new Map();
  globalThis.sessionStorage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  const real = { role: 'admin', stockViews: [] };
  assert.equal(Object.hasOwn(fieldsOf({ name: 'director' }), 'stockViews'), false);
  assert.deepEqual(fieldsOf({ name: 'director', stockViews: [] }).stockViews, []);
  rememberRoles([{ name: 'director' }]); setViewAs('director');
  const inherited = applyView(real);
  assert.equal(Object.hasOwn(inherited, 'stockViews'), false);
  assert.equal(canViewStock(account(inherited.role, inherited), 'pipe'), true);
  assert.equal(await syncViewAsRoles(async () => [{ name: 'director', stockViews: [] }]), true);
  const disabled = applyView(real);
  assert.deepEqual(disabled.stockViews, []);
  assert.equal(canViewStock(account(disabled.role, disabled), 'pipe'), false);
  assert.equal(disabled.isOwner, false);
  clearViewAsStore(); delete globalThis.sessionStorage;
});

test('дополнительный readOnly экран не открывает write-панели по прямой ссылке', () => {
  const director = account('director', { sections: ['stock'] });
  for (const href of ['#stock?view=pipe&of=stockop&new=1', '#stock?view=sheet&of=stock&open=fixture', '#stock?view=sheet&open=fixture', '#stock?view=pipe&of=profile&open=fixture', '#stock?view=sheet&of=profile&new=1', '#stock?view=pipe&of=bulkedit&new=1']) assert.equal(canFollow(director, href), false, href);
  assert.equal(canFollow(director, '#stock?view=pipe&of=profile'), true);
  assert.equal(canFollow(director, '#stock?of=stockop&new=1'), true);
  assert.equal(canFollow(account('admin'), '#stock?view=pipe&of=stockop&new=1'), true);
});

test('native stock-only разрешает только приёмку в контексте своего рабочего экрана', () => {
  const context = { baseRole: 'manager', roleLabel: 'Труборез', sections: ['stock'] };
  const worker = account('r-pipe', context);
  const receipt = '#stock?view=pipe&of=stockop&new=1&op=in&workerKind=pipe&workerZone=pipe-zone';
  assert.equal(canFollow(worker, receipt), true);
  for (const href of [receipt.replace('op=in', 'op=out'), receipt.replace('workerKind=pipe', 'workerKind=sheet'),
    receipt.replace('view=pipe', 'view=sheet'), receipt.replace('&workerZone=pipe-zone', ''), receipt + '&open=material',
    receipt.replace('new=1', 'new=0'), '#stock?of=stockop&new=1&op=in']) assert.equal(canFollow(worker, href), false, href);
  assert.equal(canFollow(account('r-pipe', { ...context, baseRole: 'user' }), receipt), false);
  assert.equal(canFollow(account('r-pipe', { ...context, sections: ['products'] }), receipt), false);
});
