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

  it('СП.1: новый поставщик и заказчик с реквизитами, проверка полей, корзина и восстановление', async () => {
    const sup = (await http().post('/api/partners').set(auth()).send({ kind: 'supplier', name: 'ООО Сталь-Трейд', inn: '7701234567', kpp: '770101001', bankBik: '044525225', bankAccount: '40702810900000000001', contactName: 'Ольга', phone: '+7 495 000-00-00' }).expect(201)).body;
    expect(sup).toMatchObject({ kind: 'supplier', inn: '7701234567', kpp: '770101001', bankBik: '044525225', contactName: 'Ольга', requests: 0 });
    await http().post('/api/partners').set(auth()).send({ kind: 'supplier', name: 'ооо сталь-трейд' }).expect(409);
    expect((await http().patch(`/api/partners/${sup.id}`).set(auth()).send({ kpp: '12' }).expect(400)).body.message).toContain('КПП');
    await http().patch(`/api/partners/${sup.id}`).set(auth()).send({ legalAddress: 'Москва, ул. Литейная, 1', bankAccount: '' }).expect(200);
    expect((await http().get(`/api/partners/${sup.id}`).set(auth())).body).toMatchObject({ legalAddress: 'Москва, ул. Литейная, 1', bankAccount: null });
    // заказчик без заказов — виден в списке заказчиков, не в поставщиках
    const cust = (await http().post('/api/partners').set(auth()).send({ kind: 'customer', name: 'ГБУ Жилищник', email: 'zh@example.ru' }).expect(201)).body;
    expect(cust).toMatchObject({ id: 'c:ГБУ Жилищник', kind: 'customer', orders: 0, email: 'zh@example.ru' });
    expect((await http().get('/api/partners').set(auth())).body.items.some((x: { name: string }) => x.name === 'ГБУ Жилищник')).toBe(false);
    // заказчик из заказов (только текст) — реквизиты заводятся при первой правке
    await http().post('/api/salesorders').set(auth()).send({ orderNo: 'SP1', customer: 'ИП Смирнов', clientUid: 'sp1-so' }).expect(201);
    const sm = (await http().patch(`/api/partners/${encodeURIComponent('c:ИП Смирнов')}`).set(auth()).send({ inn: '772345678901', phone: '+7 900 1' }).expect(200)).body;
    expect(sm).toMatchObject({ orders: 1, inn: '772345678901', phone: '+7 900 1' });
    // занятого не удалить: заказчик с заказом
    await http().delete(`/api/partners/${encodeURIComponent('c:ИП Смирнов')}`).set(auth()).expect(409);
    // в корзину и обратно
    const del = (await http().delete(`/api/partners/${sup.id}`).set(auth()).expect(200)).body;
    expect((await http().get('/api/partners').query({ deleted: 1 }).set(auth())).body.items.map((x: { id: string }) => x.id)).toContain(del.orgId);
    await http().post(`/api/partners/${sup.id}/restore`).set(auth()).expect(200);
    const cdel = (await http().delete(`/api/partners/${encodeURIComponent(cust.id)}`).set(auth()).expect(200)).body;
    const back = (await http().post(`/api/partners/${cdel.orgId}/restore`).set(auth()).expect(200)).body;
    expect(back).toMatchObject({ id: 'c:ГБУ Жилищник', email: 'zh@example.ru' });
  });
});
