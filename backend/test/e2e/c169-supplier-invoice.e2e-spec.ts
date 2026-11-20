import { createHash } from 'crypto';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { Types } from 'mongoose';
import request from 'supertest';
import { SUPPLY_INTAKE_INDEXES } from '../../src/modules/supply/supply-invoice.schema';
import type { SupplyInvoiceIntakeDto } from '../../src/modules/supply/dto-invoice-intake';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

const intake = '/api/supply/invoices/intake';
const invoicePath = '/api/supply/invoices/';
const date = '2026-11-20';

describe('C169 — атомарный импорт нового счёта поставщика', () => {
  let ctx: TestContext | undefined;
  let folder = '';
  let oldUpload: string | undefined;
  let admin = '';
  let manager = '';
  let supplierId = '';
  let payerCompanyId = '';
  const db = () => ctx!.connection.db!;
  const http = () => request(ctx!.app.getHttpServer());
  const post = (data: SupplyInvoiceIntakeDto | object, token = manager) => http().post(intake).set(authHeader(token)).send(data);
  const read = (uid: string, token = manager) => http().get(intake + '/' + uid).set(authHeader(token));
  const pdfOf = (uid: string) => Buffer.from(`%PDF-1.4\nПервичка ${uid}\n%%EOF`);
  const payloadOf = async (uid: string) => {
    const pdf = pdfOf(uid);
    const sourceSha256 = createHash('sha256').update(pdf).digest('hex');
    const source = (await http().post('/api/photos/intake/source-' + uid).set(authHeader(manager))
      .query({ sha256: sourceSha256 }).attach('file', pdf, { filename: 'invoice.pdf', contentType: 'application/pdf' }).expect(200)).body;
    const data: SupplyInvoiceIntakeDto = {
      uid, sourceSha256, fileId: source.fileId, supplierId, payerCompanyId, no: uid + '/Б', date,
      currency: 'RUB', gross: 120, vatMode: 'excluded', vatRate: 20, vatAmount: 20,
      lines: [
        { rowKey: 'a', title: 'Первый лист из счёта', qty: 2, unit: 'м²', unitPrice: 40, amount: 80 },
        { rowKey: 'b', title: 'Упаковка из счёта', qty: 1, unit: 'шт', unitPrice: 20, amount: 20 },
      ],
    };
    return { data, source, pdf };
  };

  beforeAll(async () => {
    oldUpload = process.env.UPLOAD_DIR;
    folder = await mkdtemp(join(tmpdir(), 'c169-supplier-e2e-'));
    process.env.UPLOAD_DIR = folder;
    ctx = await createTestApp({ strictValidation: true });
    admin = (await loginAsAdmin(ctx.app)).access;
    const user = { username: 'c169-supplier-manager', password: 'c169-local-test-password' };
    await http().post('/api/admin/users').set(authHeader(admin)).send({ ...user, role: 'manager' }).expect(201);
    manager = (await http().post('/api/auth/login').send(user).expect(200)).body.access;
    const parties = await db().collection('organizations').insertMany([
      { name: 'Склад поставщика QA', shortName: 'Поставщик QA', type: ['supplier'], inn: '0107020521', deletedAt: null },
      { name: 'Наша компания QA', isOurCompany: true, inn: '2312308098', deletedAt: null },
    ]);
    supplierId = String(parties.insertedIds[0]);
    payerCompanyId = String(parties.insertedIds[1]);
    for (const name of ['Photo', 'SupplyInvoice', 'SupplyRequest', 'Counter']) await ctx.connection.models[name].createIndexes();
  });

  afterAll(async () => {
    await ctx?.cleanup();
    if (oldUpload === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = oldUpload;
    if (folder.startsWith(join(tmpdir(), 'c169-supplier-e2e-'))) await rm(folder, { recursive: true, force: true });
  });

  it('параллельный POST и GET дают одну квитанцию, исходные цены и суммы видны в действующей карточке', async () => {
    const { data } = await payloadOf('qa-atomic');
    const { data: unrelated } = await payloadOf('qa-atomic-unrelated');
    const results = await Promise.all([post(data), post(data), post(unrelated)]);
    expect(results.map(result => [result.status, result.body.message])).toEqual([[200, undefined], [200, undefined], [200, undefined]]);
    const receipt = (await read(data.uid).expect(200)).body;
    expect(receipt).toEqual(results[0].body);
    expect(receipt).toEqual(results[1].body);
    expect(receipt).toEqual({ uid: data.uid, sourceSha256: data.sourceSha256, invoiceId: expect.any(String), payloadHash: expect.any(String), requestIds: [expect.any(String), expect.any(String)] });
    const view = (await http().get(invoicePath + receipt.invoiceId).set(authHeader(manager)).expect(200)).body;
    expect(view).toMatchObject({ no: data.no, date: date + 'T00:00:00.000Z', status: 'draft', amount: 120, sourceAmount: 120, calculatedVatAmount: 20, paymentState: 'unpaid' });
    expect(view.requests).toMatchObject([
      { id: receipt.requestIds[0], qty: 2, sourceUnitPrice: 40, sourceLineAmount: 80, accountingLineAmountRub: 96, status: 'ordered', paid: false },
      { id: receipt.requestIds[1], qty: 1, sourceUnitPrice: 20, sourceLineAmount: 20, accountingLineAmountRub: 24, status: 'ordered', paid: false },
    ]);
    expect(await db().collection('supplyinvoices').countDocuments({ intakeUid: data.uid })).toBe(1);
    expect(await db().collection('supplyrequests').countDocuments({ invoiceId: new Types.ObjectId(receipt.invoiceId) })).toBe(2);
    expect(await db().collection('photos').countDocuments({ sha256: data.sourceSha256 })).toBe(1);
    expect(await db().collection('stockmovements').countDocuments({})).toBe(0);
    expect(await db().collection('supplyinvoicepayments').countDocuments({})).toBe(0);
  });

  it('отклоняет изменённый payload, другой UID для оригинала и чужой аккаунт даже с тем же HTTP-ключом', async () => {
    const { data } = await payloadOf('qa-owned');
    const key = 'c169-supplier-cache-key';
    await post(data).set('Idempotency-Key', key).expect(200);
    await http().post(intake).set('Idempotency-Key', key).send(data).expect(401);
    await post(data, admin).set('Idempotency-Key', key).expect(409);
    await post({ ...data, no: data.no + '-edit' }).set('Idempotency-Key', key).expect(409);
    await post({ ...data, uid: data.uid + '-other', no: data.no + '-other' }).expect(409);
    await read(data.uid, admin).expect(409);
  });

  it('строгий контракт отклоняет пропуск строк, несогласованные итоги и дату, неподтверждённые стороны и поля оплаты', async () => {
    const { data } = await payloadOf('qa-invalid');
    for (const invalid of [
      { ...data, lines: [] }, { ...data, vatAmount: 4 }, { ...data, gross: 121 }, { ...data, date: '2026-02-30' },
      { ...data, supplierId: payerCompanyId }, { ...data, payerCompanyId: String(new Types.ObjectId()) },
      { ...data, currency: 'USD' }, { ...data, vatMode: 'mixed' }, { ...data, issue: true },
      { ...data, lines: [{ ...data.lines[0], materialId: String(new Types.ObjectId()) }] },
    ]) await post(invalid).expect(400);
    const wrongParty = await db().collection('organizations').insertOne({ name: 'Нет роли', inn: '7707083893', deletedAt: null });
    await post({ ...data, supplierId: String(wrongParty.insertedId) }).expect(400);
    expect(await db().collection('supplyinvoices').countDocuments({ intakeUid: data.uid })).toBe(0);
  });

  it('видит мягко удалённый старый счёт, счёт в отдельных заявках и настоящий SHA старого файла без хеша в Mongo', async () => {
    const { data, pdf } = await payloadOf('qa-legacy');
    const supplier = new Types.ObjectId(supplierId);
    const payer = new Types.ObjectId(payerCompanyId);
    const sample = { supplierId: supplier, payerCompanyId: payer, date: new Date(date), status: 'draft', deletedAt: new Date() };
    const old = await db().collection('supplyinvoices').insertOne({ ...sample, no: '№ ' + data.no.toUpperCase() });
    await post(data).expect(409);
    await db().collection('supplyinvoices').deleteOne({ _id: old.insertedId });
    const oldLine = await db().collection('supplyrequests').insertOne({ supplierId: supplier, companyId: payer, invoiceDate: new Date(date), invoiceNo: data.no, deletedAt: new Date() });
    await post(data).expect(409);
    await db().collection('supplyrequests').deleteOne({ _id: oldLine.insertedId });

    await writeFile(join(folder, 'legacy-same.pdf'), pdf);
    const photo = await db().collection('photos').insertOne({ storageUrl: '/uploads/legacy-same.pdf', mimeType: 'application/pdf', sizeBytes: pdf.length });
    await db().collection('supplyinvoices').insertOne({ ...sample, no: 'Другой старый номер', fileIds: [photo.insertedId] });
    await post(data).expect(409);
  });

  it('обычная правка номера и импорт не создают два счёта; ручной дубль требует явной причины', async () => {
    const { data } = await payloadOf('qa-race-key');
    const old = await db().collection('supplyinvoices').insertOne({
      no: 'Прежний номер', supplierId: new Types.ObjectId(supplierId), payerCompanyId: new Types.ObjectId(payerCompanyId),
      date: new Date(date), status: 'draft', version: 0, deletedAt: null, fileIds: [],
    });
    const patch = (body: object) => http().patch(invoicePath + old.insertedId).set(authHeader(manager)).send(body);
    const responses = await Promise.all([post(data), patch({ no: data.no })]);
    expect(responses.map(res => res.status).sort()).toEqual([200, 409]);
    expect(await db().collection('supplyinvoices').countDocuments({ no: data.no })).toBe(1);

    const { data: alreadyImported } = await payloadOf('qa-reason-key');
    const receipt = (await post(alreadyImported).expect(200)).body;
    await patch({ no: alreadyImported.no }).expect(409);
    const changed = await patch({ no: alreadyImported.no, duplicateReason: 'Отдельная поставка' }).expect(200);
    expect(changed.body.duplicateOf).toBe(receipt.invoiceId);
  });

  it('правка файла в счёте после приёмки и импорт сверяются по физическому SHA', async () => {
    const { data, pdf } = await payloadOf('qa-race-file');
    await writeFile(join(folder, 'legacy-race.pdf'), pdf);
    const legacyFile = await db().collection('photos').insertOne({
      mimeType: 'application/pdf', sizeBytes: pdf.length, storageUrl: '/uploads/legacy-race.pdf',
    });
    const old = await db().collection('supplyinvoices').insertOne({
      no: 'Отдельный старый номер', supplierId: new Types.ObjectId(supplierId),
      payerCompanyId: new Types.ObjectId(payerCompanyId), date: new Date(date),
      status: 'issued', version: 0, deletedAt: null, fileIds: [], receiptBoundaryAt: new Date(),
    });
    const patch = http().patch(invoicePath + old.insertedId).set(authHeader(manager)).send({ fileIds: [String(legacyFile.insertedId)] });
    const responses = await Promise.all([post(data), patch]);
    expect(responses.map(res => [res.status, res.body.message]).sort((a, b) => Number(a[0]) - Number(b[0]))).toEqual([
      [200, undefined], [409, expect.anything()],
    ]);
    const oldNow = await db().collection('supplyinvoices').findOne({ _id: old.insertedId });
    const newNow = await db().collection('supplyinvoices').findOne({ intakeUid: data.uid });
    expect(Number(Boolean(oldNow?.fileIds.length)) + Number(Boolean(newNow))).toBe(1);
  });

  it('повтор проверяет живой состав и фактический PDF, удалённая карточка оставляет ключ занятым', async () => {
    const { data, source, pdf } = await payloadOf('qa-tamper');
    const receipt = (await post(data).expect(200)).body;
    const id = new Types.ObjectId(receipt.invoiceId);
    const rowId = new Types.ObjectId(receipt.requestIds[0]);
    const file = join(folder, 'document-intake', basename(source.storageUrl));
    const different = Buffer.from(pdf);
    different[different.length - 3] = 0;
    await writeFile(file, different);
    await read(data.uid).expect(409);
    await writeFile(file, pdf);
    await db().collection('supplyrequests').updateOne({ _id: rowId }, { $set: { qty: 99 } });
    await read(data.uid).expect(409);
    await db().collection('supplyrequests').updateOne({ _id: rowId }, { $set: { qty: data.lines[0].qty } });
    await read(data.uid).expect(200);
    await db().collection('supplyinvoices').updateOne({ _id: id }, { $set: { deletedAt: new Date() } });
    await read(data.uid).expect(409);
    await post(data).expect(409);
  });

  it('закрытый раздел, денежная маска и ограниченный склад блокируют импорт и квитанцию', async () => {
    const { data } = await payloadOf('qa-scope');
    const { data: existing } = await payloadOf('qa-scope-existing');
    await post(existing).expect(200);
    const roles = db().collection('roles');
    const filter = { name: 'manager' };
    const before = await roles.findOne(filter);
    try {
      await roles.updateOne(filter, { $set: { appSections: ['home'] } });
      await post(data).expect(403);
      await read(existing.uid).expect(403);
      await roles.updateOne(filter, { $set: { appSections: before?.appSections ?? [], money: false } });
      await post(data).expect(403);
      await read(existing.uid).expect(403);
      await roles.updateOne(filter, { $set: { money: true, warehouseIds: [], stockCategoryIds: [String(new Types.ObjectId())] } });
      await post(data).expect(403);
      await read(existing.uid).expect(403);
    } finally {
      await roles.replaceOne(filter, before!);
    }
  });

  it('сбой записи строки откатывает шапку, номера и заявки; повтор завершает этот импорт', async () => {
    const { data } = await payloadOf('qa-rollback');
    const count = await db().collection('supplyrequests').countDocuments({});
    const counter = () => db().collection('counters').findOne({ entity: 'SupplyRequest', prefix: 'N', year: 0 });
    const originalCounter = await counter();
    const stub = jest.spyOn(ctx!.connection.models.SupplyRequest, 'insertMany').mockRejectedValueOnce(new Error('Тестовый сбой вставки строк'));
    try {
      await post(data).expect(500);
      await read(data.uid).expect(404);
      expect(await db().collection('supplyrequests').countDocuments({})).toBe(count);
      expect((await counter())?.seq).toBe(originalCounter?.seq);
    } finally {
      stub.mockRestore();
    }
    await post(data).expect(200);
  });

  it('без уникального индекса ответ 503 приходит до записи счёта или строк', async () => {
    const { data } = await payloadOf('qa-no-index');
    const count = await db().collection('supplyrequests').countDocuments();
    await db().collection('supplyinvoices').dropIndex(SUPPLY_INTAKE_INDEXES.intakeBusinessKey);
    try {
      await post(data).expect(503);
      await read(data.uid).expect(503);
      expect(await db().collection('supplyinvoices').countDocuments({ intakeUid: data.uid })).toBe(0);
      expect(await db().collection('supplyrequests').countDocuments()).toBe(count);
    } finally {
      await ctx!.connection.models.SupplyInvoice.createIndexes();
    }
  });
});
