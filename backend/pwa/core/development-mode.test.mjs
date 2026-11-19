import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { loadDevelopmentMode } from './development-mode.js';

const origin = 'http://localhost:3102';
const page = origin + '/app/#products';
const metadata = {
  mode: 'development',
  origin,
  data: {
    backup: 'datacore-2026-11-18_031040.tgz',
    snapshotAt: '2026-11-18T03:10:40',
    restoredAt: '2026-11-19T12:00:00Z',
  },
  code: { builtAt: '2026-11-20T12:00:00Z' },
};
const json = (value) => async () => Response.json(value);

test('удалённые страницы не запрашивают метаданные даже по похожему имени хоста', async () => {
  const calls = [];
  const request = (...args) => { calls.push(args); return Response.json(metadata); };
  for (const url of ['https://kppdf-crm.ru/db/app/', 'http://localhost.example.net/app/', 'http://localhost@remote.test/app/', 'http://192.168.1.2:3102/app/']) {
    assert.equal(await loadDevelopmentMode(url, request), null);
  }
  assert.deepEqual(calls, []);
});

test('loopback получает метку одним same-origin запросом без кэша, редиректа и учётных данных', async () => {
  for (const base of [origin, 'http://127.0.0.1:3102', 'http://[::1]:3102']) {
    const calls = [];
    const info = await loadDevelopmentMode(base + '/app/?x=1#home', (...args) => {
      calls.push(args);
      return Response.json({ ...metadata, origin: base });
    });
    assert.deepEqual(calls, [[base + '/app/development.json', {
      mode: 'same-origin', cache: 'no-store', redirect: 'error', credentials: 'omit',
    }]]);
    assert.equal(info.title, 'Разработка · копия данных от 18.11.2026 03:10');
    assert.match(info.sub, /Архив datacore-2026-11-18_031040\.tgz · Восстановление \d{2}\.11\.2026 .* · Сборка \d{2}\.11\.2026 /);
  }
});

test('stub, чужой origin, неподходящий режим и недоступность файла не дают ложную метку', async () => {
  const stub = JSON.parse(readFileSync(new URL('../development.json', import.meta.url), 'utf8'));
  assert.deepEqual(stub, {});
  for (const request of [
    json(stub),
    json({ ...metadata, origin: 'http://localhost:3101' }),
    json({ ...metadata, mode: 'production' }),
    async () => new Response('<html>Рабочее место</html>'),
    async () => new Response(null, { status: 404 }),
    async () => { throw new TypeError('Сеть недоступна'); },
  ]) {
    assert.equal(await loadDevelopmentMode(page, request), null);
  }
});

test('неизвестная дата снимка не подменяется восстановлением, произвольные пути и даты скрыты', async () => {
  const info = await loadDevelopmentMode(page, json({
    ...metadata,
    data: { ...metadata.data, backup: '../datacore-2026-11-18_031040.tgz', snapshotAt: '2026-02-30T03:10:40' },
    code: { builtAt: 'не дата' },
  }));
  assert.equal(info.title, 'Разработка · копия данных · дата неизвестна');
  assert.match(info.sub, /^Архив не указан · Восстановление \d{2}\.11\.2026 .* · Сборка не указана$/);
});

test('service worker пропускает запрос метаданных и продолжает обслуживать оболочку', async () => {
  const handlers = new Map();
  const worker = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  const scope = origin + '/app/';
  runInNewContext(worker, {
    URL,
    location: { origin },
    self: { registration: { scope }, addEventListener: (name, handler) => handlers.set(name, handler) },
    caches: { open: async (name) => ({
      match: async (key) => {
        if (name === 'dc-app-meta' && key === './__cur') return Response.json({ name: 'dc-shell-1', v: '1' });
        if (name === 'dc-shell-1' && key?.url === scope + 'main.js') return new Response('оболочка');
        return null;
      },
    }) },
    fetch: async () => { throw new Error('Сеть недоступна'); },
  });
  const fetchHandler = handlers.get('fetch');
  let intercepted = false;
  for (const path of ['development.json', 'development.json?fresh=1']) {
    fetchHandler({ request: new Request(scope + path), respondWith: () => { intercepted = true; } });
    assert.equal(intercepted, false);
  }
  let response;
  fetchHandler({ request: new Request(scope + 'main.js'), respondWith: (result) => { response = result; } });
  assert.equal(await (await response).text(), 'оболочка');
});
