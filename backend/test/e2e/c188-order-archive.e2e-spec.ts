import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import PDFDocument from 'pdfkit';
import { Types } from 'mongoose';
import request from 'supertest';
import { createTestApp, type TestContext } from '../setup/test-db';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { uploadsRoot } from '../../src/common/uploads/safe-path';
import { OrderArchiveService } from '../../src/modules/salesorders/order-archive.service';

const id = () => new Types.ObjectId();
function testTarget() {
  const uri = new URL(process.env.MONGO_URI ?? 'http://invalid');
  const name = process.env.MONGO_DB_TEST ?? '';
  if (!/^datacore-test-[a-z\d-]+$/.test(name) || uri.protocol !== 'mongodb:' || !['localhost', '127.0.0.1'].includes(uri.hostname)
    || !uri.port || ['27017', '27018', '3000', '3001', '3002'].includes(uri.port) || uri.searchParams.get('directConnection') !== 'true')
    throw new Error('C188 требует отдельную тестовую БД на loopback-порту изолированной MongoDB');
}

async function samplePdf(label: string): Promise<Buffer> {
  const pdf = new PDFDocument();
  const parts: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    pdf.on('data', chunk => parts.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(parts)));
    pdf.on('error', reject);
  });
  pdf.text(label);
  pdf.end();
  return done;
}

describe('C188 — архив договора', () => {
  let ctx: TestContext, admin: string, reader: string, ordersOnly: string, manager: string;
  const db = () => ctx.connection.db!;
  const api = () => request(ctx.app.getHttpServer());
  let order: Types.ObjectId, line: Types.ObjectId, photo: Types.ObjectId;
  let filepath: string, bytes: Buffer;
  const now = new Date('2024-06-20T12:00:00Z');
  const route = () => `/api/salesorders/${order}/archive`;
  const command = (expectedStateVersion = 0) => ({ clientUid: String(id()), expectedStateVersion, evidenceDocumentUid: 'act',
    reason: 'Акт приёмки по договору', manufactureComplete: true, servicesComplete: true, installationComplete: true, documentsComplete: true });
  const post = (data: unknown) => api().post(route()).set(authHeader(admin)).send(data as object);

  beforeAll(async () => {
    testTarget();
    ctx = await createTestApp({ strictValidation: true });
    admin = (await loginAsAdmin(ctx.app)).access;
    await api().post('/api/admin/users').set(authHeader(admin)).send({ username: 'c188-reader', password: 'c188-fixture-password', role: 'user' }).expect(201);
    await api().post('/api/admin/users').set(authHeader(admin)).send({ username: 'c188-manager', password: 'c188-fixture-password', role: 'manager' }).expect(201);
    manager = (await api().post('/api/auth/login').send({ username: 'c188-manager', password: 'c188-fixture-password' }).expect(200)).body.access;
    const role = (await api().post('/api/roles').set(authHeader(admin)).send({ label: 'Договоры без документации', baseRole: 'manager', money: true, appSections: ['salesorders'] }).expect(201)).body;
    await api().post('/api/admin/users').set(authHeader(admin)).send({ username: 'c188-contracts', password: 'c188-fixture-password', role: role.name }).expect(201);
    ordersOnly = (await api().post('/api/auth/login').send({ username: 'c188-contracts', password: 'c188-fixture-password' }).expect(200)).body.access;
    reader = (await api().post('/api/auth/login').send({ username: 'c188-reader', password: 'c188-fixture-password' }).expect(200)).body.access;
  });
  beforeEach(async () => {
    order = id(); line = id(); photo = id();
    bytes = await samplePdf('C188 acceptance ' + order);
    const url = '/uploads/c188/' + photo + '.pdf';
    filepath = path.join(uploadsRoot(), 'c188', photo + '.pdf');
    await fs.mkdir(path.dirname(filepath), { recursive: true });
    await fs.writeFile(filepath, bytes);
    const hash = createHash('sha256').update(bytes).digest('hex');
    await db().collection('photos').insertOne({ _id: photo, storageUrl: url, mimeType: 'application/pdf', originalFilename: 'Акт.pdf', sha256: hash, deletedAt: null });
    await db().collection('salesorders').insertOne({ _id: order, orderNo: String(order), title: 'Первая редакция', stage: 'closed', deletedAt: null,
      legal: { currency: 'RUB', state: 'verified', documents: [{ uid: 'act', kind: 'acceptance', date: '2024-06-20', fileId: photo, sourceSha256: hash }] } });
    await db().collection('incomes').insertOne({ _id: line, orderId: order, title: 'Монтаж', lineType: 'service', serviceId: id(), amount: 100,
      qty: 1, unitPrice: 100, payments: [{ amount: 100, date: now }], deletedAt: null });
  });
  afterEach(async () => { if (filepath) await fs.rm(filepath, { force: true }); });
  afterAll(async () => { await ctx?.cleanup(); });

  it('менеджер архивирует, администратор возобновляет; обычная правка разрешена, старая печать и обе версии сохранены', async () => {
    const close = command();
    const managerClose = (data: object) => api().post(route()).set(authHeader(manager)).send(data);
    await api().get(route() + '/readiness').set(authHeader(admin)).expect(200).expect(r => expect(r.body).toMatchObject({ ready: true, stateVersion: 0 }));
    const both = await Promise.all([managerClose(close), managerClose(close)]);
    expect(both.map(r => r.status)).toEqual([200, 200]);
    expect(both[0].body).toEqual({ version: 1, stateVersion: 1 });
    await managerClose({ ...close, reason: 'Изменённое тело команды' }).expect(409);
    const detail = (await api().get(route() + '/1').set(authHeader(admin)).expect(200)).body;
    const download = route() + '/1/files/' + detail.files[0].id;
    expect((await api().get(download).set(authHeader(admin)).expect(200)).body).toEqual(bytes);
    const first = await db().collection('salesorderarchives').findOne({ orderId: order, version: 1 });
    expect(first?.paymentFacts[0].legacy).toBe(false);
    const summary = (await api().get(route() + '/1').set(authHeader(reader)).expect(200)).body;
    expect(summary.files).toEqual([]);
    expect(summary.lines[0]).not.toHaveProperty('payments');
    expect(summary.order).not.toHaveProperty('legal');
    await api().get(download).set(authHeader(reader)).expect(403);
    await api().get(download).set(authHeader(ordersOnly)).expect(403);
    const reopen = { reason: 'Исправление названия', expectedStateVersion: 1, clientUid: String(id()) };
    await api().patch('/api/salesorders/' + order).set(authHeader(admin)).send({ title: 'Нельзя до возобновления' }).expect(409);
    await api().post(route() + '/reopen').set(authHeader(manager)).send(reopen).expect(403);
    await api().post(route() + '/reopen').set(authHeader(reader)).send(reopen).expect(403);
    await api().post(route() + '/reopen').set(authHeader(admin)).send(reopen).expect(200);
    await managerClose(close).expect(200).expect({ version: 1, stateVersion: 1 });
    await api().patch('/api/salesorders/' + order).set(authHeader(admin)).send({ title: 'Вторая редакция' }).expect(200);
    expect((await api().get(download).set(authHeader(manager)).expect(200)).body).toEqual(bytes);
    await managerClose(command(2)).expect(200).expect({ version: 2, stateVersion: 3 });
    await api().post(route() + '/reopen').set(authHeader(admin)).send(reopen).expect(200).expect({ version: 1, stateVersion: 2 });
    const history = (await api().get(route()).set(authHeader(admin)).expect(200)).body;
    expect(history).toMatchObject({ activeArchiveVersion: 2, stateVersion: 3, total: 2 });
    expect(history.items[1]).toMatchObject({ archivedBy: 'c188-manager', reopenedBy: 'admin', reopenReason: reopen.reason, reason: close.reason });
    expect(await db().collection('salesorderarchives').findOne({ orderId: order, version: 1 })).toEqual(first);
    await fs.unlink(filepath);
    expect((await api().get(download).set(authHeader(admin)).expect(200)).body).toEqual(bytes);
    expect((await api().get(route() + '/2').set(authHeader(admin)).expect(200)).body.order.title).toBe('Вторая редакция');
  });

  it('отклоняет пустой договор, неясную валюту, ноль, недоплату и кэш оплаты без событий', async () => {
    const incomes = db().collection('incomes');
    await incomes.updateOne({ _id: line }, { $set: { amount: 0, amountManual: 0 } });
    await post(command()).expect(409);
    await incomes.updateOne({ _id: line }, { $set: { amount: 100, amountManual: 100, payments: [{ amount: 99.99, date: now }], paidAmount: 100, paidDate: now } });
    await incomes.insertOne({ _id: id(), orderId: order, title: 'Доставка', lineType: 'service', serviceId: id(), amountManual: 5, amount: 5, payments: [{ amount: 1000, date: now }] });
    const check = (await api().get(route() + '/readiness').set(authHeader(admin)).expect(200)).body;
    expect(check.blockers).toContainEqual(expect.objectContaining({ code: 'PAYMENT_INCOMPLETE', incomeId: String(line) }));
    await post(command()).expect(409);
    await incomes.updateOne({ _id: line }, { $unset: { payments: '' } });
    await db().collection('salesorders').updateOne({ _id: order }, { $set: { 'legal.currency': 'USD' } });
    await post(command()).expect(409);
    await db().collection('salesorders').updateOne({ _id: order }, { $set: { 'legal.currency': 'RUB' } });
    await incomes.updateMany({ orderId: order }, { $set: { cancelledAt: now } });
    await post(command()).expect(409);
    expect(await db().collection('salesorderarchives').countDocuments({ orderId: order })).toBe(0);
  });

  it('проверяет факт отгрузки и принадлежность каждой строки. Принимает legacy-оплату и сохраняет PDF отгрузки и вложения', async () => {
    const product = id(), type = id(), attachment = id();
    await db().collection('products').insertOne({ _id: product, name: 'Изделие', sku: String(product) });
    const storedPath = `attachments/${product}/${type}/${attachment}.pdf`;
    const attachmentPath = path.join(uploadsRoot(), storedPath);
    await fs.mkdir(path.dirname(attachmentPath), { recursive: true });
    await fs.writeFile(attachmentPath, bytes);
    try {
      await db().collection('productattachments').insertOne({ _id: attachment, productId: product, typeId: type, storedPath, originalName: 'Паспорт.pdf', ext: 'pdf', size: bytes.length });
      await db().collection('incomes').updateOne({ _id: line }, { $unset: { payments: '', serviceId: '' }, $set: { lineType: 'product', productId: product, paidDate: now,
        passportSelection: { mode: 'attachment', revision: 1, productIdAtSelection: product, attachmentId: attachment, attachmentGeneration: 0, confirmedAt: now } } });
      await post(command()).expect(409);
      const register = (await api().get('/api/passports/registry/' + order).set(authHeader(admin)).expect(200)).body;
      expect(register).toMatchObject({ canHandover: true, ready: 1, rows: [{ state: 'attached', document: { id: String(attachment), fileName: 'Паспорт.pdf' } }] });
      const shipment = { _id: id(), orderId: order, number: 'ОТГ-1', seq: 1, date: now, lines: [{ incomeId: line, qty: 1 }], deletedAt: null };
      await db().collection('shipments').insertOne({ ...shipment, lines: [...shipment.lines, { incomeId: id(), qty: 1 }] });
      await post(command()).expect(409);
      await db().collection('shipments').updateOne({ _id: shipment._id }, { $set: { lines: [{ incomeId: line, qty: .5 }, { incomeId: line, qty: .5 }] } });
      await post(command()).expect(409);
      await db().collection('shipments').updateOne({ _id: shipment._id }, { $set: { lines: shipment.lines } });
      await post(command()).expect(200);
      const detail = (await api().get(route() + '/1').set(authHeader(admin)).expect(200)).body;
      expect(detail.paymentFacts[0].legacy).toBe(true);
      expect(detail.files.map((x: { kind: string }) => x.kind).sort()).toEqual(['attachment', 'photo', 'shipmentPdf']);
    } finally { await fs.rm(attachmentPath, { force: true }); }
  });

  it('печатает обе редакции из их собственных снимков и исключает чтение живой карточки при скачивании', async () => {
    const passport = id(), product = id();
    const frozen = { effectiveImages: [], standardImages: [], readiness: { ready: true, requiredImages: [] }, photoUrls: {}, org: { name: 'Фирма C188' }, look: null };
    await db().collection('productpassports').insertOne({ _id: passport, salesOrderId: order, productId: product, status: 'issued',
      passportCategory: 'BLG', passportNumber: String(passport), name: 'Current revision', presentationVersion: 1, variant: 'short', revision: 2,
      textSnapshot: { category: 'BLG', description: 'Second snapshot' }, printSnapshot: frozen,
      revisions: [{ revision: 1, at: now, data: { name: 'Previous revision', textSnapshot: { category: 'BLG', description: 'First snapshot' }, printSnapshot: frozen } }] });
    await post(command()).expect(200);
    const detail = (await api().get(route() + '/1').set(authHeader(admin)).expect(200)).body;
    const pdfs = detail.files.filter((f: { kind: string }) => f.kind === 'passportPdf') as Array<{ passportRevision: number; name: string; id: string; sha256: string }>;
    expect(pdfs.map(p => [p.passportRevision, p.name.includes('Previous revision')])).toEqual([[2, false], [1, true]]);
    for (const file of pdfs) {
      const req = route() + '/1/files/' + file.id;
      await api().get(req).set(authHeader(ordersOnly)).expect(403);
      await api().get(req).set(authHeader(reader)).expect(403);
      const pdf = (await api().get(req).set(authHeader(admin)).expect(200)).body as Buffer;
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
      expect(createHash('sha256').update(pdf).digest('hex')).toBe(file.sha256);
    }
    expect((await db().collection('productpassports').findOne({ _id: passport }))?.pdfIssuedAt).toBeUndefined();
  });
  it('создание и перевод задач проектирования, фото и распределение всей группы подчиняются архиву', async () => {
    const old = id(), removed = id(), free = id();
    await db().collection('designtasks').insertMany([
      { _id: old, incomeId: line, orderId: order, title: 'Чертёж', seq: 901, status: 'done' },
      { _id: removed, incomeId: line, orderId: order, seq: 904, status: 'done', deletedAt: now },
      { _id: free, seq: 905, status: 'queue', title: 'Без позиции' },
    ]);
    await post(command()).expect(200);
    const base = '/api/design-tasks';
    const denied = (r: request.Response) => expect(r.body.code).toBe('ORDER_ARCHIVED');
    await api().post(base).set(authHeader(admin)).send({ incomeId: line }).expect(409).expect(denied);
    await api().patch(base + '/' + old).set(authHeader(admin)).send({ title: 'Другое название' }).expect(409).expect(denied);
    await api().patch(base + '/' + free).set(authHeader(admin)).send({ incomeId: line }).expect(409).expect(denied);
    await api().post(base + '/' + old + '/photos').set(authHeader(admin)).send({ photoId: photo }).expect(409).expect(denied);
    await api().post(base + '/' + removed + '/restore').set(authHeader(admin)).send({}).expect(409).expect(denied);
    await api().post(base + '/from-order').set(authHeader(admin)).send({ orderId: order }).expect(409).expect(denied);
    await api().patch(base + '/' + free).set(authHeader(admin)).send({ title: 'Переименована свободная задача' }).expect(200);
  });

  it('конкурентные создание задания и закрытие договора дают один согласованный результат', async () => {
    const [close, creation] = await Promise.all([
      post(command()), api().post('/api/design-tasks').set(authHeader(admin)).send({ incomeId: line }),
    ]);
    if (close.status === 200) {
      expect(creation.status).toBe(409);
      expect(await db().collection('designtasks').countDocuments({ incomeId: line })).toBe(0);
    } else {
      expect(close.status).toBe(409);
      expect(creation.status).toBe(201);
      expect(await db().collection('salesorderarchives').countDocuments({ orderId: order })).toBe(0);
    }
  });
  it('отклоняет потерю оригинала, подмену хеша, открытые работы и пустое основание, запрещает ключу и внутреннему вызову возобновление', async () => {
    await post({ ...command(), reason: '    ' }).expect(400);
    await post({ ...command(), evidenceDocumentUid: 'чужой_акт' }).expect(409);
    const task = await db().collection('worktasks').insertOne({ incomeId: line, orderId: order, seq: Number(Date.now()), status: 'work' });
    await post(command()).expect(409);
    await db().collection('worktasks').updateOne({ _id: task.insertedId }, { $set: { status: 'done' } });
    await fs.writeFile(filepath, 'changed');
    const check = (await api().get(route() + '/readiness').set(authHeader(admin)).expect(200)).body;
    expect(check).toMatchObject({ ready: false, blockers: [{ code: 'FILE_UNAVAILABLE' }] });
    await post(command()).expect(409);
    await fs.unlink(filepath);
    await post(command()).expect(409);
    const svc = ctx.module.get(OrderArchiveService);
    const reopen = { reason: 'Изменить версию', expectedStateVersion: 1, clientUid: String(id()) };
    await expect(svc.reopen(String(order), reopen, { id: String(id()), username: 'key', role: 'admin', keyScope: {} as never })).rejects.toMatchObject({ status: 403 });
    await expect(svc.reopen(String(order), reopen)).rejects.toMatchObject({ status: 403 });
    expect(await db().collection('salesorderarchivechunks').countDocuments({ orderId: order })).toBe(0);
  });
});
