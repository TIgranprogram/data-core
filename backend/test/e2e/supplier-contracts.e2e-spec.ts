import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { Types } from 'mongoose';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** /api/supply/contracts — договоры поставщиков и привязка к счёту. */
describe('Supplier contracts', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let token: AuthTokens;
  let viewer = '';
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const auth = () => authHeader(token.access);

  let supA = '', supB = '', contractA = '', contractB = '', invId = '';

  beforeAll(async () => {
    ctx = await createTestApp(); app = ctx.app; token = await loginAsAdmin(app);
    for (const c of ['supplyrequests', 'supplyinvoices', 'organizations', 'suppliercontracts']) await db().collection(c).deleteMany({});
    await db().collection('suppliercontracts').createIndex({ supplierId: 1, no: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
    const username = `viewer-${Date.now()}`;
    await http().post('/api/admin/users').set(auth()).send({ username, password: 'role-pass-123', role: 'user' }).expect(201);
    viewer = (await http().post('/api/auth/login').send({ username, password: 'role-pass-123' }).expect(200)).body.access;
    const mk = async (body: object) => (await http().post('/api/supply/requests').set(auth()).send({ unit: 'шт', qty: 1, priceHint: 100, ...body }).expect(201)).body.id as string;
    const a = await mk({ title: 'Болт', supplierName: 'Крепёж' });
    await mk({ title: 'Лист', supplierName: 'Металл' });
    supA = String((await db().collection('organizations').findOne({ name: 'Крепёж' }))!._id);
    supB = String((await db().collection('organizations').findOne({ name: 'Металл' }))!._id);
    invId = (await http().post('/api/supply/invoices').set(auth()).send({ requestIds: [a] }).expect(201)).body.items[0].id;
  });
  afterAll(async () => { await ctx?.cleanup(); });

  it('создание: без № или даты — 400; нормальное — 201; повтор у того же поставщика — 409, у другого можно', async () => {
    await http().post('/api/supply/contracts').set(auth()).send({ supplierId: supA, date: '2026-10-01' }).expect(400);
    await http().post('/api/supply/contracts').set(auth()).send({ supplierId: supA, no: '5' }).expect(400);
    const r = await http().post('/api/supply/contracts').set(auth()).send({ supplierId: supA, no: '5', date: '2026-10-01', subject: 'Крепёж', amount: 1000 }).expect(201);
    expect(r.body).toMatchObject({ no: '5', status: 'active', supplierName: 'Крепёж', invoicesCount: 0 });
    contractA = r.body.id;
    const dup = await http().post('/api/supply/contracts').set(auth()).send({ supplierId: supA, no: '5', date: '2026-10-02' }).expect(409);
    expect(dup.body.message).toContain('У этого поставщика уже есть договор № 5');
    contractB = (await http().post('/api/supply/contracts').set(auth()).send({ supplierId: supB, no: '5', date: '2026-10-02' }).expect(201)).body.id;
  });

  it('список: только договоры поставщика, формат {items,total,page,limit}, фильтр по статусу', async () => {
    const r = await http().get(`/api/supply/contracts?supplierId=${supA}&status=active&limit=100`).set(auth()).expect(200);
    expect(r.body).toMatchObject({ total: 1, page: 1, limit: 100 });
    expect(r.body.items.map((i: { id: string }) => i.id)).toEqual([contractA]);
    expect((await http().get(`/api/supply/contracts?supplierId=${supA}&status=closed`).set(auth()).expect(200)).body.total).toBe(0);
    await http().get(`/api/supply/contracts/${contractA}`).set(auth()).expect(200);
  });

  it('роль без прав: читать можно, создать/удалить — 403', async () => {
    const v = authHeader(viewer);
    await http().get('/api/supply/contracts').set(v).expect(200);
    await http().post('/api/supply/contracts').set(v).send({ supplierId: supA, no: '9', date: '2026-10-01' }).expect(403);
    await http().delete(`/api/supply/contracts/${contractA}`).set(v).expect(403);
  });

  it('счёт: чужой договор — 400, свой — сохраняется с contractNo, "" снимает', async () => {
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ contractId: contractB }).expect(400);
    const r = await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ contractId: contractA }).expect(200);
    expect(r.body).toMatchObject({ contractNo: '5' });
    expect(r.body.contractDate).toBeTruthy();
    const list = (await http().get('/api/supply/invoices').set(auth()).expect(200)).body.items.find((i: { id: string }) => i.id === invId);
    expect(list).toMatchObject({ contractId: contractA, contractNo: '5' });
    expect((await http().get(`/api/supply/contracts/${contractA}`).set(auth()).expect(200)).body.invoicesCount).toBe(1);
    const off = await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ contractId: '' }).expect(200);
    expect(off.body.contractNo).toBeNull();
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ contractId: contractA }).expect(200);
  });

  it('фильтр счетов contract=has/none', async () => {
    const ids = async (c: string) => (await http().get(`/api/supply/invoices?contract=${c}`).set(auth()).expect(200)).body.items.map((i: { id: string }) => i.id);
    expect(await ids('has')).toEqual([invId]);
    expect(await ids('none')).not.toContain(invId);
    await http().get('/api/supply/invoices?contract=x').set(auth()).expect(400);
  });

  it('удаление договора со счётом — 409 с номерами; закрытый нельзя выбрать', async () => {
    await db().collection('supplyinvoices').updateOne({ _id: new Types.ObjectId(invId) }, { $set: { no: '17' } });
    const r = await http().delete(`/api/supply/contracts/${contractA}`).set(auth()).expect(409);
    expect(r.body.message).toContain('№ 17');
    await http().patch(`/api/supply/contracts/${contractA}`).set(auth()).send({ status: 'closed' }).expect(200);
    await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ no: '17' }).expect(200); // у счёта уже выбран — не мешает
  });

  it('смена поставщика счёта сбрасывает договор и предупреждает', async () => {
    const r = await http().patch(`/api/supply/invoices/${invId}`).set(auth()).send({ supplierId: supB }).expect(200);
    expect(r.body.contractNo).toBeNull();
    expect(r.body.warnings[0]).toContain('Договор снят');
  });

  it('удаление без счетов — soft, из списка пропадает; номер освобождается', async () => {
    await http().delete(`/api/supply/contracts/${contractA}`).set(auth()).expect(200);
    expect((await http().get(`/api/supply/contracts?supplierId=${supA}`).set(auth()).expect(200)).body.total).toBe(0);
    await http().get(`/api/supply/contracts/${contractA}`).set(auth()).expect(404);
    await http().post('/api/supply/contracts').set(auth()).send({ supplierId: supA, no: '5', date: '2026-10-03' }).expect(201);
  });

  it('журнал: действия по-русски', async () => {
    const r = await http().get('/api/audit-logs?entityType=SupplierContract&limit=50').set(auth()).expect(200);
    const rows = (r.body.items ?? r.body) as Array<{ action: string; actionRu?: string }>;
    const mine = rows.filter((x) => x.action?.startsWith('supply.contract.'));
    expect(mine.map((x) => x.actionRu)).toEqual(expect.arrayContaining(['Договор поставщика: создано', 'Договор поставщика: изменено', 'Договор поставщика: удалено']));
  });
});
