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
    ctx = await createTestApp();
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
    expect(body).toMatchObject({ ready: 1, canHandover: false, history: [], rows: [
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
    expect(changed.history[0].rows[0].document.revision).toBe(1);
    await post({ ...payload, clientUid: randomUUID() }).expect(409);
    await post({ ...payload, clientUid: randomUUID(), fingerprint: changed.fingerprint }).expect(200);
    expect((await read()).body.history.map((receipt: { rows: Array<{ document: { revision: number } }> }) => receipt.rows[0].document.revision)).toEqual([2, 1]);
  });

  it('архив запрещает менять передачу, реестр остаётся доступным для чтения', async () => {
    await db().collection('salesorders').updateOne({ _id: contract }, { $set: { activeArchiveVersion: 1 } });
    const { body } = await read();
    expect(body.canHandover).toBe(false);
    await post({ recipient: 'Покупатель', handedOn: '2026-01-01', fingerprint: body.fingerprint, clientUid: randomUUID() }).expect(409);
    await http().get(url).expect(401);
  });
});
