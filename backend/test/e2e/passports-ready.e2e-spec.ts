import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin, type AuthTokens } from '../setup/admin.fixture';

/** C072: готовый паспорт (файл сделан отдельно) — создать, найти по номеру и диапазону, занятый номер — 409, последние номера. */
describe('Паспорта: готовый паспорт и номера (C072)', () => {
  let ctx: TestContext | undefined;
  let app: INestApplication;
  let admin: AuthTokens;
  let orgId = '';
  let productId = '';
  const db = () => ctx!.connection.db!;
  const http = () => request(app.getHttpServer());
  const as = () => authHeader(admin.access);
  const PDF = Buffer.from('%PDF-1.4\n% готовый\n');
  const ready = (fields: Record<string, string>, file: Buffer | null = PDF) => {
    let r = http().post('/api/passports/ready').set(as());
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    return file ? r.attach('file', file, { filename: 'Паспорт 612.pdf', contentType: 'application/pdf' }) : r;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    app = ctx.app;
    admin = await loginAsAdmin(app);
    for (const c of ['productpassports', 'counters']) await db().collection(c).deleteMany({});
    orgId = (await http().post('/api/partners').set(as()).send({ kind: 'our', name: 'ООО «СпортИН-ЮГ» Г', inn: '2310181417', kpp: '231201001' }).expect(201)).body.id;
    productId = String((await db().collection('products').insertOne({ name: 'Горка', sku: 'G-1', photoIds: [], deletedAt: null })).insertedId);
    await db().collection('productpassports').createIndex({ passportNumber: 1 }, { unique: true, name: 'passportNumber_unique' });
  });
  afterAll(async () => { await ctx?.cleanup(); });

  let readyId = '';

  it('номер из файла: паспорт выпущен, источник «файл», в карточке printFile', async () => {
    const r = await ready({ productId, supplierOrgId: orgId, number: '612' }).expect(201);
    expect(r.body).toMatchObject({ passportNumber: '612', status: 'issued', source: 'ready-file', printSource: 'file', productId });
    expect(r.body.printFile).toMatchObject({ hasFile: true });
    readyId = r.body.id;
  });

  it('занятый номер — 409, повтор не создаёт второй', async () => {
    const r = await ready({ productId, supplierOrgId: orgId, number: '612' }).expect(409);
    expect(JSON.stringify(r.body)).toContain('Номер 612 уже у паспорта');
    expect((await http().get('/api/passports').query({ numberFrom: '612', numberTo: '612' }).set(as()).expect(200)).body.total).toBe(1);
  });

  it('номер не передан — следующий после максимума; список по диапазону и источник', async () => {
    const r = await ready({ productId, supplierOrgId: orgId }).expect(201);
    expect(r.body.passportNumber).toBe('613');
    const list = (await http().get('/api/passports').query({ numberFrom: '613', numberTo: '700' }).set(as()).expect(200)).body;
    expect(list.items.map((x: { passportNumber: string }) => x.passportNumber)).toEqual(['613']);
    expect(list.items[0]).toMatchObject({ printSource: 'file', supplierOrg: { id: orgId } });
    expect((await http().get('/api/passports').query({ search: '612' }).set(as()).expect(200)).body.items.some((x: { id: string }) => x.id === readyId)).toBe(true);
  });

  it('последние номера: общий и по фирме', async () => {
    const r = (await http().get('/api/passports/last-numbers').set(as()).expect(200)).body;
    expect(r.last).toBe(613);
    expect(r.byFirm.find((f: { orgId: string }) => f.orgId === orgId)).toMatchObject({ last: 613, count: 2 });
  });

  it('не PDF и чужая фирма — 400', async () => {
    await ready({ productId, supplierOrgId: orgId }, Buffer.from('hello')).expect(400);
    await ready({ productId, supplierOrgId: productId }).expect(400);
    await ready({ productId, supplierOrgId: orgId }, null).expect(400);
  });

  it('готовый файл отдаётся при печати паспорта', async () => {
    const r = await http().get(`/api/passports/${readyId}/pdf`).set(as()).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); }).expect(200);
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });
});
