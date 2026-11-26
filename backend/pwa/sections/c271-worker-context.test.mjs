import assert from 'node:assert/strict';
import test from 'node:test';
import { workerStockContext } from './stock-worker-context.js';

const item = { id: 'm/one', unit: 'м' };
const key = '74d95afe-17c6-4055-88b7-d065489aeec3';
const emptyPage = query => ({ ...query, items: [], total: 0 });
const settle = () => new Promise(resolve => setImmediate(resolve));
const failure = (status, message) => Object.assign(new Error(message), { status });

test('локальная очередь без запросов при построении, максимум два GET, кэш и отмена оставшихся при перерисовке', async () => {
  const calls = [], complete = [];
  const ctx = workerStockContext((path, { query }) => {
    calls.push(path);
    return new Promise(resolve => complete.push(() => resolve(emptyPage(query))));
  });
  const material = ctx.material(item), other = ctx.material({ id: 'other' });
  assert.equal(calls.length, 0);
  const requests = material.requests(), reserves = material.reservations();
  assert.equal(material.requests(), requests);
  const cancelled = assert.rejects(other.requests(), /Подстрока закрыта/);
  await settle();
  assert.deepEqual(calls, ['/stock/items/m%2Fone/requests', '/stock/items/m%2Fone/reservations']);
  ctx.cancelQueued(); await cancelled;
  const repeated = other.requests();
  complete.shift()(); await requests; await settle();
  assert.equal(calls.at(-1), '/stock/items/other/requests');
  complete.splice(0).forEach(done => done());
  await Promise.all([reserves, repeated]);
  await material.requests(); assert.equal(calls.length, 3);
  ctx.destroy(); await assert.rejects(material.requests(), /Подстрока закрыта/);
});

test('страницы без потолка 100 и 2000; сбой страницы остаётся ошибкой до явного повтора', async () => {
  let fail = true, calls = [];
  const ctx = workerStockContext(async (path, { query }) => {
    calls.push([path, query.page]);
    const total = path.endsWith('reservations') ? 2021 : 101;
    if (total === 101 && query.page === 2 && fail) throw failure(503, 'Страница недоступна');
    const offset = (query.page - 1) * query.limit;
    return { ...query, total, items: Array.from({ length: Math.min(query.limit, total - offset) }, (_, n) => ({ id: String(offset + n), qty: 7, unit: n % 2 ? 'шт' : 'м' })) };
  });
  const material = ctx.material(item);
  assert.equal((await material.requests()).items.length, 20);
  await assert.rejects(material.requests({ more: true }), /недоступна/);
  await assert.rejects(material.requests(), /недоступна/);
  assert.equal(calls.length, 2);
  fail = false;
  let requests = await material.requests({ retry: true }), reserves = await material.reservations();
  while (requests.more) requests = await material.requests({ more: true });
  while (reserves.more) reserves = await material.reservations({ more: true });
  assert.equal(requests.items.length, 101); assert.equal(requests.items.at(-1).id, '100');
  assert.equal(reserves.items.length, 2021); assert.equal(reserves.items.at(-1).id, '2020');
});

test('заказ проверяет право, единицу, число, успешное чтение и подтверждение доппотребности; после успеха обновляет только ожидания позиции', async () => {
  const calls = [];
  const ctx = workerStockContext(async (path, options) => {
    calls.push(path);
    if (options.method === 'POST') {
      assert.deepEqual(options.body, { qty: 2, clientUid: key });
      return { id: 'r1', materialId: item.id, num: '1-26' };
    }
    const items = path.endsWith('requests') ? [{ id: 'existing' }] : [];
    return { ...options.query, items, total: items.length };
  }, { uuid: () => key });
  const a = ctx.material(item), b = ctx.material({ id: 'other', unit: 'шт' });
  await assert.rejects(a.order(2), /загрузите/);
  await assert.rejects(a.order(2, { readOnly: true }), /недоступно/);
  await assert.rejects(a.order(0), /положительное/);
  await assert.rejects(ctx.material({ ...item, unit: '' }).order(2), /единица/);
  await Promise.all([a.requests(), a.reservations(), b.requests()]);
  await assert.rejects(a.order(2), /дополнительную/);
  const saving = a.order(2, { additional: true });
  await assert.rejects(a.order(2, { additional: true }), /отправляется/);
  assert.equal((await saving).num, '1-26');
  await Promise.all([a.requests(), a.reservations(), b.requests()]);
  assert.deepEqual(calls, ['/stock/items/m%2Fone/requests', '/stock/items/m%2Fone/reservations', '/stock/items/other/requests',
    '/stock/items/m%2Fone/request', '/stock/items/m%2Fone/requests']);
});

test('ответ queued и потерянный ответ сохраняют UUID между рендерами и повторным экраном', async () => {
  const entries = new Map(), posts = [];
  const storage = { getItem: name => entries.get(name), setItem: (name, value) => entries.set(name, value), removeItem: name => entries.delete(name) };
  const api = async (path, opts) => {
    if (!opts.body) return emptyPage(opts.query);
    posts.push(opts.body);
    if (posts.length === 1) return { queued: true };
    if (posts.length === 2) throw failure(0, 'Нет связи');
    return { id: 'confirmed', materialId: item.id, num: '2-26' };
  };
  const first = workerStockContext(api, { uuid: () => key, storage, actorId: 'a' });
  let material = first.material(item);
  await material.requests();
  await assert.rejects(material.order(3), /не подтверждено/);
  assert.equal(material.orderState.pendingQty, 3); assert.equal(material.orderState.result, null);
  await assert.rejects(material.order(4), /тем же количеством/);
  first.destroy();
  const second = workerStockContext(api, { uuid: () => assert.fail('Новый UUID при повторе'), storage, actorId: 'a' });
  material = second.material(item);
  assert.equal(material.orderState.pendingQty, 3);
  await material.requests(); await assert.rejects(material.order(3), /Нет связи/);
  assert.equal((await material.order(3)).id, 'confirmed');
  assert.deepEqual(posts, Array(3).fill({ qty: 3, clientUid: key }));
  assert.equal(entries.size, 0);
});
