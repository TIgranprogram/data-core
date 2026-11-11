import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { SESSION_STAND, sessionFromStdin } from './stand-session.mjs';

const payload = { access: 'test.access', refresh: 'test.refresh', user: { name: 'Тест' } };

test('одна сессия для параллельных и повторных входов, включая имя в UTF-8', async () => {
  let reads = 0;
  const stdin = {
    async *[Symbol.asyncIterator]() {
      reads++;
      for (const byte of Buffer.from(JSON.stringify(payload))) yield Buffer.of(byte);
    },
  };
  const login = sessionFromStdin(stdin);
  const first = login(SESSION_STAND);
  assert.equal(login(SESSION_STAND), first);
  assert.deepEqual(await first, payload);
  assert.equal(login(SESSION_STAND), first);
  assert.equal(reads, 1);
});

test('адрес стенда проверяется до чтения stdin, в том числе при повторном входе', async () => {
  const login = sessionFromStdin(Readable.from([JSON.stringify(payload)]));
  for (const base of ['https://localhost:3102', 'http://127.0.0.1:3102', 'http://localhost:3001', `${SESSION_STAND}/api`]) {
    assert.throws(() => login(base), /только на http:\/\/localhost:3102/);
  }
  assert.deepEqual(await login(SESSION_STAND), payload);
  assert.throws(() => login('http://localhost:3001'), /только на http:\/\/localhost:3102/);
});

test('отклоняет неполную, битую, избыточную сессию без вывода содержимого', async () => {
  const invalid = [
    '', 'SECRET{', JSON.stringify(payload).repeat(2), JSON.stringify({ ...payload, refresh: '' }),
    JSON.stringify({ ...payload, access: 'SECRET\r\n' }), JSON.stringify({ ...payload, user: [] }), 'x'.repeat(65537),
  ];
  for (const body of invalid) {
    const login = sessionFromStdin(Readable.from([body]));
    const first = login(SESSION_STAND);
    await assert.rejects(first, { message: 'Не удалось прочитать сессию стенда из stdin.' });
    assert.equal(login(SESSION_STAND), first);
  }
});
