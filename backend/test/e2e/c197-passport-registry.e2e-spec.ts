import { randomUUID } from 'crypto';
import request from 'supertest';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';

describe('C197 — реестр паспортов и подтверждённая передача', () => {
  let ctx: TestContext;
  let auth: ReturnType<typeof authHeader>;
  const db = () => ctx.connection.db!;
  const http = () => request(ctx.app.getHttpServer());
  const root = '/api/passports/registry';
  const contract = new Types.ObjectId(), first = new Types.ObjectId(), second = new Types.ObjectId();
  const passport = new Types.ObjectId();
  const url = root + '/' + contract;
  const read = () => http().get(url).set(auth).expect(200);
  const post = (body: object) => http().post(url + '/handover').set(auth).send(body);

  beforeAll(async () => {
    ctx = await createTestApp({ strictValidation: true });
    auth = authHeader((await loginAsAdmin(ctx.app)).access);
    await db().collection('salesorders').insertOne({ _id: contract, orderNo: 'Тест C197', productionNo: 'C197', customer: 'Покупатель', stage: 'ready' });
    await db().collection('incomes').insertMany([
      { _id: first, orderId: contract, title: 'Скамья', lineNo: 1, qty: 2 },
      { _id: second, orderId: contract, title: 'Урна', lineNo: 2, qty: 1 },
      { orderId: contract, title: 'Выполнить доставку', lineType: 'service' },
      { orderId: contract, title: 'Отменённая строка', cancelledAt: new Date() },
    ]);
    await db().collection('productpassports').insertOne({
      _id: passport, incomeId: first, salesOrderId: contract, passportNumber: 'TEST-C197-1', revision: 1, status: 'issued',
    });
  });

  afterAll(async () => { await ctx?.cleanup(); });

  it('показывает выпущенные и недостающие документы; PDF не отмечает передачу', async () => {
    const { body } = await read();
    expect(body).toMatchObject({ ready: 1, handed: 0, canHandover: true, history: [], rows: [
      { title: 'Скамья', state: 'issued', document: { number: 'TEST-C197-1', revision: 1 } },
      { title: 'Урна', state: 'missing' },
    ] });
    const pdf = await http().get(url + '/pdf').set(auth).expect(200).expect('Content-Type', /application\/pdf/);
    expect(Buffer.isBuffer(pdf.body) && pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(await db().collection('passporthandovers').countDocuments({ orderId: contract })).toBe(0);
    await post({ recipient: 'Покупатель', handedOn: '2026-01-01', fingerprint: body.fingerprint, clientUid: randomUUID() }).expect(409);
  });

  it('снимает полный комплект с очереди, сохраняет получателя и старые редакции', async () => {
    await db().collection('productpassports').insertOne({ incomeId: second, salesOrderId: contract, passportNumber: 'TEST-C197-2', revision: 1, status: 'issued' });
    const open = (await read()).body;
    expect(open.canHandover).toBe(true);
    const list = (state: string) => http().get(root).set(auth).query({ state, search: 'C197' }).expect(200);
    expect((await list('handover')).body.total).toBe(1);
    const payload = { recipient: 'Иван Иванов', handedOn: '2026-01-01', fingerprint: open.fingerprint, clientUid: randomUUID() };
    await post({ ...payload, handedOn: '2026-02-30' }).expect(400);
    const { body } = await post(payload).expect(200);
    expect(body.current).toMatchObject({ recipient: payload.recipient, handedOn: payload.handedOn, rows: open.rows });
    expect((await post(payload).expect(200)).body.history).toHaveLength(1);
    expect((await list('work')).body.total).toBe(0);
    expect((await list('history')).body.total).toBe(1);

    await db().collection('productpassports').updateOne({ _id: passport }, { $set: { revision: 2 } });
    const changed = (await read()).body;
    expect(changed.current).toBeNull();
    expect(changed.handed).toBe(1);
    expect(changed.rows[0].handedOn).toBeUndefined();
    expect(changed.rows[1].handedOn).toBe(payload.handedOn);
    expect(changed.history[0].rows[0].document.revision).toBe(1);
    await post({ ...payload, clientUid: randomUUID() }).expect(409);
    await post({ ...payload, clientUid: randomUUID(), fingerprint: changed.fingerprint }).expect(200);
    expect((await read()).body.history.map((receipt: { rows: Array<{ document: { revision: number } }> }) => receipt.rows[0].document.revision)).toEqual([2, 1]);
  });

  it('суммирует выбранные строки из разных ведомостей и защищает состав при конкурентном повторе', async () => {
    const orderId = new Types.ObjectId();
    const otherOrder = new Types.ObjectId();
    const otherLine = new Types.ObjectId();
    const lines = Array.from({ length: 3 }, () => new Types.ObjectId());
    const base = root + '/' + orderId;
    const get = async () => (await http().get(base).set(auth).expect(200)).body;
    const list = async (state: string) => (await http().get(root).set(auth).query({ state, search: 'C201' }).expect(200)).body;
    const send = (body: object) => http().post(base + '/handover').set(auth).send(body);
    await db().collection('salesorders').insertMany([
      { _id: orderId, orderNo: 'C201-1' }, { _id: otherOrder, orderNo: 'C201-2' }, { orderNo: 'C201-пустой' },
    ]);
    await db().collection('incomes').insertMany([
      ...lines.map((_id, i) => ({ _id, orderId, lineNo: i + 1, title: 'Изделие ' + i, qty: 1 })),
      { _id: otherLine, orderId: otherOrder, title: 'Позиция другого договора' },
    ]);
    const issue = (index: number) => db().collection('productpassports').insertOne({
      incomeId: lines[index], salesOrderId: orderId, passportNumber: 'C201-' + index, status: 'issued', revision: 1,
    });
    await issue(0);
    await issue(1);
    const before = await get();
    const firstId = String(lines[0]);
    const secondId = String(lines[1]);
    const thirdId = String(lines[2]);
    const receipt = { clientUid: randomUUID(), recipient: 'Первый получатель', handedOn: '2026-01-01', fingerprint: before.fingerprint, incomeIds: [firstId] };
    expect((await list('')).total).toBe(2);
    expect((await list('history')).total).toBe(0);
    await send({ ...receipt, incomeIds: [] }).expect(400);
    await send({ ...receipt, incomeIds: [firstId, firstId] }).expect(400);
    await send({ ...receipt, incomeIds: null }).expect(400);
    await send({ ...receipt, incomeIds: [firstId, String(otherLine)] }).expect(409);
    await send({ ...receipt, incomeIds: [firstId, thirdId] }).expect(409);
    expect((await get()).history).toHaveLength(0);

    await Promise.all([send(receipt).expect(200), send(receipt).expect(200)]);
    const partial = await get();
    expect(partial).toMatchObject({ ready: 2, handed: 1, canHandover: true, current: null });
    expect(partial.history).toHaveLength(1);
    expect(partial.history[0].rows).toHaveLength(1);
    expect(partial.rows.map((row: { handedOn?: string }) => row.handedOn)).toEqual([receipt.handedOn, undefined, undefined]);
    expect((await list('handover')).items).toMatchObject([{ id: String(orderId), handed: 1, positions: 3 }]);
    expect((await list('history')).items).toMatchObject([{ id: String(orderId), handed: 1 }]);
    await send({ ...receipt, incomeIds: [secondId] }).expect(409);
    await send({ ...receipt, clientUid: randomUUID(), incomeIds: [firstId, secondId] }).expect(409);
    await send({ ...receipt, clientUid: randomUUID(), incomeIds: undefined }).expect(409);

    const next = { ...receipt, recipient: 'Второй получатель', handedOn: '2026-01-02', incomeIds: [secondId] };
    const racing = await Promise.all([send({ ...next, clientUid: randomUUID() }), send({ ...next, clientUid: randomUUID() })]);
    expect(racing.map(result => result.status).sort()).toEqual([200, 409]);
    expect(await get()).toMatchObject({ handed: 2, current: null, canHandover: false });
    expect((await list('handover')).total).toBe(0);
    expect((await list('work')).total).toBe(2);
    await issue(2);
    const complete = await get();
    await send({ ...receipt, clientUid: randomUUID(), incomeIds: [thirdId] }).expect(409);
    const closed = (await send({ ...next, clientUid: randomUUID(), fingerprint: complete.fingerprint, incomeIds: undefined }).expect(200)).body;
    expect(closed).toMatchObject({ handed: 3, ready: 3, canHandover: false, current: { rows: [{ incomeId: thirdId }] } });
    expect(closed.history.map((entry: { rows: unknown[] }) => entry.rows.length)).toEqual([1, 1, 1]);
    expect((await list('work')).items).toMatchObject([{ id: String(otherOrder) }]);
    expect((await send(receipt).expect(200)).body.history).toHaveLength(3);

    await db().collection('productpassports').updateOne({ incomeId: lines[0] }, { $inc: { revision: 1 } });
    const revised = await get();
    expect(revised).toMatchObject({ current: null, handed: 2, canHandover: true });
    expect(revised.rows.map((row: { handedOn?: string }) => row.handedOn)).toEqual([undefined, next.handedOn, next.handedOn]);
    expect(revised.history[2].rows[0]).toMatchObject({ incomeId: firstId, document: { revision: 1 } });
    await db().collection('incomes').updateMany({ orderId }, { $set: { cancelledAt: new Date() } });
    expect((await list('history')).items).toMatchObject([{ id: String(orderId), handed: 0, positions: 0 }]);
    expect((await list('')).items).toMatchObject([{ id: String(otherOrder) }]);
    expect(await get()).toMatchObject({ current: null, handed: 0, canHandover: false });
  });

  it('архив запрещает менять передачу, реестр остаётся доступным для чтения', async () => {
    await db().collection('salesorders').updateOne({ _id: contract }, { $set: { activeArchiveVersion: 1 } });
    const { body } = await read();
    expect(body.canHandover).toBe(false);
    await post({ recipient: 'Покупатель', handedOn: '2026-01-01', fingerprint: body.fingerprint, clientUid: randomUUID() }).expect(409);
    await http().get(url).expect(401);
  });
});
