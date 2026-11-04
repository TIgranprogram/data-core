// Проверка контракта Windows cancellation без настоящего taskkill.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { terminateProcess } from '../process.mjs';

test('Windows: taskkill.exe /PID /T /F, успешный callback', async () => {
  let seen;
  const result = await terminateProcess(123, { platform: 'win32', execFileFn: (file, args, options, callback) => { seen = { file, args, options }; callback(null, Buffer.from('ok'), Buffer.alloc(0)); } });
  assert.deepEqual(result, { ok: true });
  assert.equal(seen.file, 'taskkill.exe'); assert.deepEqual(seen.args, ['/PID', '123', '/T', '/F']);
  assert.equal(seen.options.windowsHide, true); assert.equal(seen.options.timeout, 10000);
  assert.equal(seen.options.encoding, 'buffer');
});

test('Windows: Access denied/ENOENT не объявляются остановкой', async () => {
  for (const message of ['Access denied', 'spawn taskkill.exe ENOENT']) {
    const result = await terminateProcess(123, { platform: 'win32', execFileFn: (f, a, o, cb) => cb(new Error(message), Buffer.alloc(0), Buffer.alloc(0)) });
    assert.equal(result.ok, false); assert.match(result.error, new RegExp(message.replace('.', '\\.')));
  }
});

test('Windows: процесс уже нет — считаем остановленным', async () => {
  const ru = Buffer.from('Ошибка: Не удается найти процесс "40616".', 'utf8');
  const byStatus = await terminateProcess(40616, {
    platform: 'win32',
    execFileFn: (f, a, o, cb) => { const e = new Error('Command failed'); e.status = 128; cb(e, Buffer.alloc(0), Buffer.alloc(0)); },
  });
  assert.equal(byStatus.ok, true);
  const byMsg = await terminateProcess(40616, {
    platform: 'win32',
    execFileFn: (f, a, o, cb) => { const e = new Error('fail'); e.status = 1; cb(e, Buffer.alloc(0), ru); },
  });
  assert.equal(byMsg.ok, true);
});

test('PID неизвестен — отказ до системного вызова; POSIX сигнал адресован только child PID', async () => {
  assert.equal((await terminateProcess(undefined, { execFileFn() { throw new Error('не вызывать'); } })).ok, false);
  let seen;
  assert.deepEqual(await terminateProcess(123, { platform: 'linux', killFn: (...args) => { seen = args; } }), { ok: true });
  assert.deepEqual(seen, [123, 'SIGTERM']);
  assert.equal((await terminateProcess(123, { platform: 'linux', killFn: () => { const e = new Error('kill ESRCH'); e.code = 'ESRCH'; throw e; } })).ok, true);
});
