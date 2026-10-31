// Очередь неотправленных ошибок: node --test backend/pwa/core/errors.test.mjs
import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';

const KEY = 'dc-client-errors';
const stored = new Map([['dca_access', 'токен']]);
const storage = {
  getItem: (k) => (stored.has(k) ? stored.get(k) : null),
  setItem: (k, v) => stored.set(k, String(v)),
  removeItem: (k) => stored.delete(k),
};
const listeners = {};
const on = (type, fn) => { (listeners[type] ||= []).push(fn); };
const nav = { onLine: true, userAgent: 'test' };
const stub = (name, value) => Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
stub('localStorage', storage);
stub('sessionStorage', { getItem: () => null, setItem() {}, removeItem() {} });
stub('navigator', nav);
stub('location', { pathname: '/app/', hash: '#stock', origin: 'http://x' });
stub('window', { addEventListener: on });
stub('Element', class {});
stub('DocumentFragment', class {});
stub('document', { addEventListener: on, visibilityState: 'visible' });
stub('setInterval', () => 0); // минутный повтор вызывается в тесте через событие online

let reply; // что отвечает сервер: код или сбой связи
const sent = [];
stub('fetch', async (url, opts) => {
  sent.push(JSON.parse(opts.body).message);
  if (reply === 'down') throw new TypeError('Failed to fetch');
  return { status: reply };
});

let n = 0;
const failure = () => new TypeError('сбой ' + String(n++).replace(/\d/g, (d) => 'абвгдежзик'[d])); // цифры сборщик считает одной подписью
const tick = () => new Promise((r) => setTimeout(r, 0));
const queued = () => JSON.parse(stored.get(KEY) || '[]');
/** Новая копия модуля — как новое открытие вкладки. */
const open = async () => {
  listeners.online = [];
  listeners.visibilitychange = [];
  const m = await import(`./errors.js?${Math.random()}`);
  return { ...m, online: async () => { listeners.online.forEach((f) => f()); await tick(); await tick(); } };
};

beforeEach(() => { stored.delete(KEY); sent.length = 0; reply = 204; nav.onLine = true; });

test('без сети: ошибка не падает и ложится в очередь, с сетью уходит и очередь пуста', async () => {
  const { reportError, online } = await open();
  nav.onLine = false;
  reportError(failure());
  assert.equal(sent.length, 0);
  assert.equal(queued().length, 1);
  nav.onLine = true;
  await online();
  assert.equal(sent.length, 1);
  assert.equal(stored.has(KEY), false);
});

test('обрыв при отправке: запись в очереди одна и после повторной неудачи', async () => {
  const { reportError, online } = await open();
  reply = 'down';
  reportError(failure());
  await tick(); await tick();
  assert.equal(queued().length, 1);
  await online();
  await online();
  assert.equal(sent.length, 3, 'первая отправка и две попытки');
  assert.equal(queued().length, 1, 'запись не задвоилась');
  reply = 204;
  await online();
  assert.equal(sent.length, 4);
  assert.equal(stored.has(KEY), false);
  await online();
  assert.equal(sent.length, 4, 'отправленное не уходит повторно');
});

test('очередь не больше 20, лишние отбрасываются', async () => {
  const { reportError } = await open();
  nav.onLine = false;
  for (let i = 0; i < 25; i++) reportError(failure());
  assert.equal(queued().length, 20);
});

test('очередь переживает закрытие вкладки', async () => {
  const first = await open();
  nav.onLine = false;
  first.reportError(failure());
  const [saved] = queued();
  nav.onLine = true;
  const second = await open();
  await second.online();
  assert.deepEqual(sent, [saved.message]);
  assert.equal(stored.has(KEY), false);
});

test('испорченная запись в хранилище не ломает запуск', async () => {
  stored.set(KEY, '{не json');
  const { online } = await open();
  await online();
  assert.equal(sent.length, 0);
});

test('старый сервер (404): очередь очищена, больше не шлём', async () => {
  const { reportError, online } = await open();
  nav.onLine = false;
  reportError(failure());
  nav.onLine = true;
  reply = 404;
  await online();
  assert.equal(stored.has(KEY), false);
  reportError(failure());
  assert.equal(sent.length, 1);
});
