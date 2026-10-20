import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** «Контрагенты» (TASKS фаза 4): поставщики из заявок, заказчики из заказов, правка, объединение дублей. */
describe('Partners', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    token = await loginAsAdmin(app);
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('поставщики: счётчик заявок, правка ИНН (проверка), объединение дубля — заявки переходят', async () => {
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Болт', qty: 1, supplierName: 'ПРОММЕТИЗ', clientUid: 'p-1' }).expect(201);
    await http().post('/api/supply/requests').set(auth()).send({ title: 'Гайка', qty: 1, supplierName: 'ООО Промметиз-дубль', clientUid: 'p-2' }).expect(201);
    const list = (await http().get('/api/partners').set(auth()).expect(200)).body;
    const a = list.items.find((x: { name: string }) => x.name === 'ПРОММЕТИЗ');
    const b = list.items.find((x: { name: string }) => x.name === 'ООО Промметиз-дубль');
    expect(a).toMatchObject({ kind: 'supplier', requests: 1, inn: null });
    expect((await http().patch(`/api/partners/${a.id}`).set(auth()).send({ inn: '123' }).expect(400)).body.message).toContain('ИНН');
    await http().patch(`/api/partners/${a.id}`).set(auth()).send({ inn: '2310000000', phone: '+7 900 000-00-00' }).expect(200);
    const merged = (await http().post(`/api/partners/${b.id}/merge`).set(auth()).send({ intoId: a.id }).expect(200)).body;
    expect(merged).toMatchObject({ id: a.id, requests: 2, moved: 1, inn: '2310000000' });
    const after = (await http().get('/api/partners').set(auth()).expect(200)).body;
    expect(after.items.some((x: { id: string }) => x.id === b.id)).toBe(false);
  });

  it('заказчики: два написания объединяются во всех заказах', async () => {
    await http().post('/api/salesorders').set(auth()).send({ orderNo: 'P1', customer: 'ООО Академия Благоустроиства', clientUid: 'p-so-1' }).expect(201);
    await http().post('/api/salesorders').set(auth()).send({ orderNo: 'P2', customer: 'ООО АКАДЕМИЯ БЛАГОУСТРОЙСТВА', clientUid: 'p-so-2' }).expect(201);
    const list = (await http().get('/api/partners').query({ type: 'customer' }).set(auth()).expect(200)).body;
    expect(list.items).toHaveLength(2);
    const wrong = list.items.find((x: { name: string }) => x.name.includes('Благоустроиства'));
    const right = list.items.find((x: { name: string }) => x.name.includes('БЛАГОУСТРОЙСТВА'));
    const m = (await http().post(`/api/partners/${encodeURIComponent(wrong.id)}/merge`).set(auth()).send({ intoId: right.id }).expect(200)).body;
    expect(m).toMatchObject({ orders: 2 });
    expect((await http().get('/api/partners').query({ type: 'customer' }).set(auth()).expect(200)).body.items).toHaveLength(1);
  });
});
