import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { rateLimitDeadline } from '../../core/rate-limit-retry.js';

const boardSource = readFileSync(new URL('./board.js', import.meta.url), 'utf8');
const lifecycle = boardSource.slice(boardSource.indexOf('  let loadedAt ='), boardSource.lastIndexOf('\n}'));
const apiSource = readFileSync(new URL('../../core/api.js', import.meta.url), 'utf8');
const errorSource = apiSource.slice(apiSource.indexOf('async function errorOf(res)'), apiSource.indexOf('/** «Смотреть как»'));
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(reply) {
  const calls = [], totals = [], classes = new Set(); let unsubscribed = 0;
  const cols = ['requested', 'paid'].map(key => {
    const body = { children: [], replaceChildren(...children) { this.children = children; }, append(child) { this.children.push(child); } };
    const col = { children: [body], insertBefore(node, before) { this.children.splice(this.children.indexOf(before), 0, node); } };
    return { c: { key }, col, body, n: {}, sum: {}, rows: [], page: 1 };
  });
  const el = { classList: { add: name => classes.add(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } };
  const context = vm.createContext({
    query: {}, seq: 0, destroyed: false, navTimer: 0, cols, el, board: { headCount: true },
    sel: { clear() {} }, dropBar() {}, qty: String, money: String, AbortController, clearTimeout,
    unsub: () => { unsubscribed++; }, onTotal: total => totals.push(total),
    fetchCol: async (column, page, generation, signal) => { calls.push({ key: column.key, signal }); return reply(column.key, calls.filter(c => c.key === column.key).length, signal); },
    paint: (col, response) => { col.rows = response.items; col.body.replaceChildren(...response.items); },
    failBlock: (error, retry) => ({ error, retry, remove() { for (const col of cols) { col.body.children = col.body.children.filter(node => node !== this); col.col.children = col.col.children.filter(node => node !== this); } } }),
  });
  const board = vm.runInContext('(function () {\n' + lifecycle + '\n})()', context);
  return { board, cols, calls, totals, classes, unsubscribed: () => unsubscribed };
}
const rows = key => ({ items: [{ id: key }], total: 1 });

test('ApiError сохраняет именованный срок 429, но не назначает его другим ошибкам', async () => {
  const now = Date.UTC(2026, 10, 24, 12);
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  const context = vm.createContext({ ApiError, HUMAN: { 429: 'Подождите', 500: 'Сбой' }, rateLimitDeadline, Date: { now: () => now } });
  const errorOf = vm.runInContext(errorSource + '\nerrorOf;', context);
  const response = status => new Response('{}', { status, headers: { 'Retry-After-short': '1', 'Retry-After-long': '60' } });
  const error = await errorOf(response(429));
  assert.equal(error.retryAt, now + 60000); assert.equal(error.retryAfter, 60);
  assert.equal((await errorOf(response(503))).retryAt, undefined);
});

test('отказ одной колонки даёт повтор только её, успешная соседняя колонка сохраняется', async () => {
  const box = fixture(async (key, count) => { if (key === 'requested' && count === 1) throw { status: 429 }; return rows(key); });
  await settle();
  const failure = box.cols[0].failure;
  const retry = failure.retry;
  assert.equal(typeof retry, 'function');
  assert.ok(box.cols[0].col.children.includes(failure));
  assert.ok(!box.cols[0].body.children.includes(failure));
  const neighbor = box.cols[1].body.children[0];
  await retry();
  assert.deepEqual(box.calls.map(call => call.key), ['requested', 'paid', 'requested']);
  assert.equal(box.cols[1].body.children[0], neighbor);
  assert.equal(box.cols[0].rows[0].id, 'requested');
  assert.ok(!box.cols[0].col.children.includes(failure));
  assert.equal(box.totals.at(-1), 2);
});

test('повтор одной колонки не отменяет ещё загружающуюся соседнюю', async () => {
  const neighbor = deferred();
  const box = fixture(async (key, count) => { if (key === 'paid') return neighbor.promise; if (count === 1) throw { status: 429 }; return rows(key); });
  await settle();
  await box.cols[0].failure.retry();
  assert.equal(box.calls[1].signal.aborted, false);
  assert.ok(box.classes.has('loading'));
  neighbor.resolve(rows('paid')); await settle();
  assert.equal(box.cols[1].rows[0].id, 'paid');
  assert.equal(box.classes.has('loading'), false);
});

test('новый фильтр отменяет прежние колонки; поздний старый ответ не меняет новые карточки', async () => {
  const old = deferred();
  const box = fixture(async (key, count) => count === 1 ? old.promise : rows('new-' + key));
  await box.board.setQuery({ q: 'новое' }); await settle();
  assert.equal(box.calls[0].signal.aborted, true); assert.equal(box.calls[1].signal.aborted, true);
  assert.equal(box.cols[0].rows[0].id, 'new-requested');
  old.resolve(rows('old')); await settle();
  assert.equal(box.cols[0].rows[0].id, 'new-requested');
});

test('destroy отменяет ожидания всех колонок и снимает подписку один раз', async () => {
  const old = deferred(); const box = fixture(async () => old.promise);
  box.board.destroy(); box.board.destroy();
  assert.ok(box.calls.every(call => call.signal.aborted)); assert.equal(box.unsubscribed(), 1);
  old.resolve(rows('old')); await settle();
  assert.ok(box.cols.every(col => col.rows.length === 0));
  await box.board.reload(); assert.equal(box.calls.length, 2);
});
