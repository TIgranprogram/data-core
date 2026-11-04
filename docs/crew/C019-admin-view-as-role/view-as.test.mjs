// Смоук «Смотреть как роль»: node --test docs/crew/C019-admin-view-as-role/view-as.test.mjs
// Рабочий код не импортирует этот файл. Хранилища — подмена, сеть — счётчик fetch.
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

const local = new Map();
const sess = new Map();
const bag = (map) => ({
  getItem: (k) => (map.has(k) ? map.get(k) : null),
  setItem: (k, v) => map.set(k, String(v)),
  removeItem: (k) => map.delete(k),
});
const calls = [];
const events = [];
const stub = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
stub('localStorage', bag(local));
stub('sessionStorage', bag(sess));
stub('location', { pathname: '/app/', hash: '', origin: 'http://x' });
stub('window', { addEventListener() {}, dispatchEvent() {} });
stub('Element', class {});
stub('DocumentFragment', class {});
stub('Node', class {});
stub('document', {
  addEventListener() {},
  dispatchEvent(ev) { events.push(ev.type); return true; },
  querySelector() { throw new Error('нет документа'); },
});
stub('fetch', async (url, opts) => {
  calls.push({ url: String(url), method: String(opts?.method || 'GET').toUpperCase() });
  return { ok: true, status: 200, text: async () => 'null' };
});

const apiMod = await import('../../../backend/pwa/core/api.js');
const va = await import('../../../backend/pwa/core/view-as.js');
const { api, session } = apiMod;
const BLOCK = 'Сейчас только просмотр роли — менять данные нельзя';

const admin = {
  id: 'a1', username: 'admin', role: 'admin', roleLabel: 'Администратор',
  isOwner: true, canMoney: true, displayName: 'Админ',
};
const manager = { id: 'm1', username: 'm', role: 'manager', roleLabel: 'Менеджер', canMoney: true };

function seed(user) {
  local.clear(); sess.clear(); calls.length = 0; events.length = 0;
  local.set('dca_user', JSON.stringify(user));
  local.set('dca_access', 'jwt-real');
  local.set('dca_refresh', 'refresh-real');
  va.rememberRoles([]);
}

beforeEach(() => { seed(admin); va.setViewAs(null); events.length = 0; calls.length = 0; });

test('админ: роль подменяется, dca_user и JWT на месте', () => {
  assert.equal(session.canViewAs, true);
  assert.equal(va.setViewAs('manager'), true);
  assert.equal(session.user.role, 'manager');
  assert.equal(session.user.baseRole, 'manager');
  assert.equal(session.user.roleLabel, 'Менеджер');
  assert.equal(session.user.isOwner, false);
  assert.equal(session.canMoney, true);
  assert.equal(session.canEdit, true);
  assert.equal(session.isAdmin, false);
  assert.equal(session.role === 'admin', false);
  assert.equal(session.canViewAs, true);
  assert.equal(session.realUser.role, 'admin');
  assert.equal(session.realUser.isOwner, true);
  assert.equal(local.get('dca_user'), JSON.stringify(admin));
  assert.equal(local.get('dca_access'), 'jwt-real');
  assert.equal(sess.get('dca_viewAs'), 'manager');
  assert.ok(events.includes('dc:view-as'));
});

test('узкая роль: меню и деньги режутся, сброс возвращает админа', () => {
  va.rememberRoles([{ name: 'r-sklad', label: 'Кладовщик', baseRole: 'user', money: false, appSections: ['stock', 'чужое'] }]);
  assert.equal(va.setViewAs('r-sklad'), true);
  assert.equal(session.canMoney, false);
  assert.equal(session.canEdit, false);
  assert.equal(session.sees('stock'), true);
  assert.equal(session.sees('requests'), false);
  assert.equal(session.sees('home'), true);
  assert.equal(session.sees('staff'), false);
  assert.equal(session.role === 'admin', false);
  assert.deepEqual(session.user.sections, ['stock']);
  va.setViewAs(null);
  assert.equal(va.getViewAs(), '');
  assert.equal(session.user.role, 'admin');
  assert.equal(session.isAdmin, true);
  assert.equal(session.role === 'admin', true);
  assert.equal(session.canMoney, true);
  assert.equal(sess.has('dca_viewAs'), false);
  assert.equal(local.get('dca_access'), 'jwt-real');
  assert.equal(local.get('dca_user'), JSON.stringify(admin));
});

test('директор всегда с деньгами; пустые разделы — как раньше', () => {
  va.rememberRoles([{ name: 'director', label: 'Director', baseRole: 'director', money: false, appSections: [] }]);
  va.setViewAs('director');
  assert.equal(session.user.roleLabel, 'Директор');
  assert.equal(session.canMoney, true);
  assert.equal(session.user.sections, null);
  assert.equal(session.sees('staff'), true);
  assert.equal(session.sees('requests'), true);
});

test('не-админ: блока нет, ключ просмотра меню не меняет', () => {
  seed(manager);
  assert.equal(session.canViewAs, false);
  assert.equal(va.canViewAsUser(session.realUser), false);
  va.setViewAs('user');
  assert.equal(session.user.role, 'manager');
  assert.equal(session.canMoney, true);
  assert.equal(local.get('dca_user'), JSON.stringify(manager));
});

test('список без администратора, неизвестный код не включается', () => {
  const names = va.rolesForSelect().map((r) => r.name);
  assert.equal(names.includes('admin'), false);
  assert.ok(names.includes('manager'));
  assert.equal(va.setViewAs('admin'), false);
  assert.equal(va.getViewAs(), '');
  assert.equal(va.setViewAs('нет-такой'), false);
});

test('POST PATCH PUT DELETE не вызывают fetch; GET вызывает', async () => {
  va.setViewAs('user');
  for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
    calls.length = 0;
    await assert.rejects(() => api('/stock/items/1', { method, body: { a: 1 } }), (e) => {
      assert.equal(e.message, BLOCK);
      assert.equal(e.status, 403);
      assert.equal(e.viewAs, true);
      return true;
    });
    assert.equal(calls.length, 0, method);
  }
  calls.length = 0;
  await api('/roles');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'GET');
  assert.match(calls[0].url, /\/api\/roles$/);
  assert.equal(local.get('dca_access'), 'jwt-real');
});

test('после сброса запись снова доходит до fetch', async () => {
  va.setViewAs('manager');
  va.setViewAs(null);
  calls.length = 0;
  await api('/auth/me', { method: 'PATCH', body: { displayName: 'Админ' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'PATCH');
});

test('у менеджера запись не режется, даже если ключ просмотра лежит', async () => {
  seed(manager);
  va.setViewAs('user');
  calls.length = 0;
  await api('/x', { method: 'DELETE' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'DELETE');
});

test('снимок с сервера обновляет деньги и разделы', async () => {
  va.setViewAs('manager');
  const changed = await va.syncViewAsRoles(async () => [{
    name: 'manager', label: 'Менеджер', baseRole: 'manager', money: false, appSections: ['stock'],
  }]);
  assert.equal(changed, true);
  assert.equal(session.canMoney, false);
  assert.equal(session.sees('stock'), true);
  assert.equal(session.sees('money'), false);
  assert.equal(local.get('dca_user'), JSON.stringify(admin));
  assert.equal(local.get('dca_access'), 'jwt-real');
});
