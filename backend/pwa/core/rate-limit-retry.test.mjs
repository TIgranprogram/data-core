import assert from 'node:assert/strict';
import test from 'node:test';
import { rateLimitDeadline, retryRateLimitedRead } from './rate-limit-retry.js';

const blocked = retryAt => Object.assign(new Error('Ограничение частоты'), { status: 429, retryAt });
const settle = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

test('срок 429: обычное, именованные окна и HTTP-date; выбирается самое позднее', () => {
  const now = Date.UTC(2026, 10, 24, 12);
  assert.equal(rateLimitDeadline(new Headers({ 'Retry-After': '3' }), now), now + 3000);
  assert.equal(rateLimitDeadline(new Headers({ 'Retry-After-short': '1', 'Retry-After-long': '60' }), now), now + 60000);
  assert.equal(rateLimitDeadline(new Headers({ 'Retry-After': new Date(now + 5000).toUTCString() }), now), now + 5000);
  assert.equal(rateLimitDeadline(new Headers({ 'Retry-After': '0' }), now), now);
  for (const value of ['bad', '-1', 'Infinity', '']) assert.equal(rateLimitDeadline(new Headers({ 'Retry-After': value }), now), undefined);
  assert.equal(rateLimitDeadline(new Headers({ 'X-RateLimit-Reset-long': '60' }), now), undefined);
});

test('минутное окно не заменяется секундой: один повтор только после срока', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let calls = 0;
  const result = retryRateLimitedRead(async () => { if (++calls === 1) throw blocked(61000); return 'loaded'; });
  await settle();
  t.mock.timers.tick(59000); await settle(); assert.equal(calls, 1);
  t.mock.timers.tick(1000); assert.equal(await result, 'loaded'); assert.equal(calls, 2);
});

test('повторный 429 заканчивает попытку; нет срока/долгий срок/другая ошибка не запускают повтор', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let calls = 0;
  const second = blocked(3000);
  const result = retryRateLimitedRead(async () => { calls++; throw calls === 1 ? blocked(2000) : second; });
  const rejected = assert.rejects(result, error => error === second);
  await settle(); t.mock.timers.tick(1000); await rejected; assert.equal(calls, 2);
  for (const error of [blocked(undefined), blocked(200000), Object.assign(new Error('сбой'), { status: 503, retryAt: 3000 })]) {
    calls = 0;
    await assert.rejects(retryRateLimitedRead(async () => { calls++; throw error; }), e => e === error);
    assert.equal(calls, 1);
  }
});

test('уход с экрана отменяет таймер и не отправляет отложенный запрос', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  const controller = new AbortController(); let calls = 0;
  const result = retryRateLimitedRead(async () => { calls++; throw blocked(61000); }, { signal: controller.signal });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await settle(); controller.abort(); await rejected;
  t.mock.timers.tick(120000); await settle(); assert.equal(calls, 1);
});

test('смена фильтра во время ожидания не отправляет запрос старого фильтра', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let current = true, calls = 0;
  const result = retryRateLimitedRead(async () => { calls++; throw blocked(2000); }, { current: () => current });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await settle(); current = false; t.mock.timers.tick(1000); await rejected;
  assert.equal(calls, 1);
});
