import assert from 'node:assert/strict';
import test from 'node:test';

const values = new Map([['dca_access', 'test-access']]);
const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
const stub = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
stub('localStorage', storage);
stub('sessionStorage', { getItem: () => null, setItem() {}, removeItem() {} });
stub('navigator', { onLine: true, userAgent: 'test' });
stub('location', { pathname: '/app/', hash: '#partners?open=undefined&search=PRIVATE-SEARCH', origin: 'http://local.test' });
const listeners = {};
stub('window', { addEventListener(name, callback) { (listeners[name] ||= []).push(callback); } });
stub('document', { addEventListener() {}, visibilityState: 'visible' });
stub('Element', class {});
stub('DocumentFragment', class {});
stub('setInterval', () => 0);

const reports = [];
let message = 'Некорректный id контрагента';
let delayReport = false;
let rejectReport;
stub('fetch', async (url, options) => {
  if (url.endsWith('/client-errors')) {
    reports.push(JSON.parse(options.body));
    if (delayReport) await new Promise((_, reject) => { rejectReport = reject; });
    return new Response(null, { status: 204 });
  }
  return new Response(JSON.stringify({ message }), { status: 400, headers: { 'Content-Type': 'application/json' } });
});

const { api, events, session } = await import('./api.js');
const { reportError } = await import('./errors.js');
const { errorContext } = await import('./error-context.js');
events.onFail = (err, { url, method }) => reportError(err, { url, action: method === 'GET' ? 'загрузка' : 'запись', kind: 'action' });

test('реальная цепочка api→events→reportError сохраняет HTTP400 с контекстом один раз, без формы и секрета', async () => {
  errorContext.add('Отмена', '#partners?of=orders&open=111111111111111111111111');
  for (let i = 0; i < 2; i++) await assert.rejects(api('/partners/undefined'), { status: 400 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].status, 400);
  assert.equal(reports[0].url, '/partners/undefined');
  assert.match(reports[0].stack, /Отмена · partners of=orders/);
  assert.match(reports[0].stack, /сбой · partners open=undefined/);
  assert.equal(JSON.stringify(reports[0]).includes('test-access'), false);
  assert.equal(JSON.stringify(reports[0]).includes('PRIVATE-SEARCH'), false);
  assert.equal(Object.hasOwn(reports[0], 'body'), false);
  session.clear();
  assert.equal(errorContext.text('#home'), 'сбой · home');
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
test('HTTP400 не повторяет значение поля ни в сообщении, ни в многострочном stack/пути заказчика', async () => {
  session.access = 'test-access';
  message = 'Товар PRIVATE-FORM-VALUE уже существует\n    at PRIVATE-FORM-VALUE';
  await assert.rejects(api('/partners/c%3APRIVATE-FORM-VALUE'), (error) => error.message === message);
  await tick();
  const body = reports.at(-1);
  assert.equal(body.message, 'Запрос отклонён: HTTP 400');
  assert.equal(body.url, '/partners/customer-name-hidden');
  assert.equal(JSON.stringify(body).includes('PRIVATE-FORM-VALUE'), false);
});

test('logout и поздний отказ отправки не переносят траекторию предыдущего пользователя', async () => {
  session.access = 'test-access';
  errorContext.add('Выбрать изделие', '#orders?open=111111111111111111111111');
  delayReport = true;
  reportError(Object.assign(new Error('400'), { status: 400 }), { url: '/incomes/111111111111111111111111' });
  await tick();
  session.clear();
  delayReport = false;
  rejectReport(new TypeError('offline'));
  await tick(); await tick();
  const persisted = values.get('dc-client-errors');
  assert.ok(persisted);
  assert.equal(persisted.includes('Контекст действий'), false);
  assert.equal(persisted.includes('Выбрать изделие'), false);
  session.access = 'test-access-new-user';
  for (const callback of listeners.online || []) callback();
  await tick(); await tick();
  assert.equal(JSON.stringify(reports.at(-1)).includes('Выбрать изделие'), false);
  assert.equal(values.has('dc-client-errors'), false);
});
