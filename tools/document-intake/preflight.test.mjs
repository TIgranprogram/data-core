import test from 'node:test';
import assert from 'node:assert/strict';
import { preflight } from './preflight.mjs';

const options = { root: 'D:/documents', modelBase: 'http://127.0.0.1:1235/v1', model: 'local-model', apiBase: 'http://127.0.0.1:3002/api' };
const response = (value = { ready: true }, finish_reason = 'stop') => ({ ok: true, json: async () => ({ choices: [{ finish_reason, message: { content: JSON.stringify(value) } }] }) });
const dependencies = (patch = {}) => ({
  platform: 'win32', now: () => 0,
  statfs: async () => ({ bavail: 1024 ** 2, bsize: 4096 }),
  exec: async () => ({ stdout: '{"ready":true}' }),
  fetchFn: async () => response(),
  connectApi: () => ({ get: async () => ({ id: 'manager-id', role: 'manager', canMoney: true }) }),
  ...patch,
});

test('все проверки реальны и публикуют этапы без записи в API', async () => {
  const events = []; const calls = [];
  const result = await preflight({ ...options, onStep: event => events.push(event) }, dependencies({
    exec: async (program, args, opts) => {
      assert.equal(program, 'python'); assert.equal(args[0], '-c'); assert.match(args[1], /get_text/); assert.equal(opts.windowsHide, true);
      return { stdout: '{"ready":true}' };
    },
    fetchFn: async (url, init) => {
      assert.equal(url.href, 'http://127.0.0.1:1235/v1/chat/completions');
      assert.equal(init.redirect, 'error'); assert.equal(JSON.parse(init.body).response_format.type, 'json_schema');
      assert.equal(init.headers.Authorization, undefined); return response();
    },
    connectApi: () => ({ get: async endpoint => { calls.push(endpoint); return { id: 'manager', baseRole: 'manager', canMoney: true }; } }),
  }));
  assert.equal(result.ready, true); assert.equal(result.checkedAt, '1970-01-01T00:00:00.000Z');
  assert.deepEqual(calls, ['/auth/me']); assert.equal(events.length, 10); assert.equal(result.actor.role, 'manager');
});

test('внешние и неоднозначные адреса модели блокируются до сети', async () => {
  for (const modelBase of ['https://example.com/v1', 'http://127.1/v1', 'http://2130706433/v1', 'http://localhost.evil/v1', 'http://user:password@localhost/v1', 'http://localhost/v1?token=secret', 'http://localhost/v1/../v1', 'file:///v1']) {
    const result = await preflight({ ...options, modelBase }, dependencies({ fetchFn: async () => { assert.fail('Сетевого запроса быть не должно'); } }));
    assert.equal(result.steps.find(s => s.id === 'model').status, 'blocked', modelBase);
  }
});

test('IPv6 loopback принимается', async () => {
  const result = await preflight({ ...options, modelBase: 'http://[::1]:1235/v1' }, dependencies());
  assert.equal(result.ready, true);
});

test('неподдерживаемая ОС, нехватка места и PDF без извлечения блокируют запуск', async () => {
  const result = await preflight(options, dependencies({ platform: 'linux', statfs: async () => ({ bavail: 1, bsize: 4096 }), exec: async () => { throw Error('secret output'); } }));
  assert.equal(result.ready, false);
  assert.deepEqual(result.steps.filter(s => s.status === 'blocked').map(s => s.id), ['windows', 'disk', 'pdf']);
  assert.doesNotMatch(JSON.stringify(result), /secret output/);
  assert.ok(result.steps.filter(s => s.status === 'blocked').every(s => s.recovery));
});

test('несоответствие схеме или незавершённый ответ не подтверждают модель', async () => {
  for (const [value, finish] of [[{ ready: false }, 'stop'], [{ ready: true, extra: true }, 'stop'], [{ ready: true }, 'length'], [null, 'stop']]) {
    const result = await preflight(options, dependencies({ fetchFn: async () => response(value, finish) }));
    assert.equal(result.steps.find(s => s.id === 'model').status, 'blocked');
  }
});

test('ошибки API и недостаточные права скрываются и не дают запуск', async () => {
  for (const user of [{ id: 'reader', role: 'viewer', canMoney: true }, { id: 'manager', role: 'manager', canMoney: false }, null]) {
    const result = await preflight(options, dependencies({ connectApi: () => ({ get: async () => user }) }));
    assert.equal(result.ready, false); assert.equal(result.actor, null);
  }
  const result = await preflight(options, dependencies({ connectApi: () => { throw Error('Bearer secret-token'); } }));
  assert.doesNotMatch(JSON.stringify(result), /secret-token/);
});

test('отмена прекращает проверку, закрытый обработчик событий ей не мешает', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(preflight({ ...options, signal: controller.signal }, dependencies()), { name: 'AbortError' });
  assert.equal((await preflight({ ...options, onStep: () => { throw Error(); } }, dependencies())).ready, true);
});
