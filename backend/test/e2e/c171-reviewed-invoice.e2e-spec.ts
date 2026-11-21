import { createHash, randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Types } from 'mongoose';
import request from 'supertest';
import { PhotoIntakeService } from '../../src/modules/photos/photo-intake.service';
import * as storage from '../../src/modules/supply/supply-intake-storage';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

const endpoint = '/api/supply/invoices/intake';
describe('C171 — версии и подтверждённая отправка', () => {
  let ctx: TestContext, folder: string, before: string | undefined, manager: string, admin: string, supplierId: string, payerCompanyId: string;
  const http = () => request(ctx.app.getHttpServer());
  const post = (path: string, body: object, actor = manager) => http().post(endpoint + path).set('Host','c171.test').set(authHeader(actor)).send(body);
  const read = (id: string, actor = manager) => http().get(endpoint + '/review/' + id).set(authHeader(actor));
  const commit = (id: string, ticket: string, bytes: Buffer) => http().post(endpoint + '/commit').query({ draftId: id })
    .set('Host','c171.test').set(authHeader(manager)).set('X-Review-Ticket', ticket).attach('file', bytes, { filename: 'fixture.pdf', contentType: 'application/pdf' });
  const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
  const fixture = () => {
    const draftId = randomUUID(), bytes = Buffer.from('%PDF-1.4\nСинтетический счёт ' + draftId + '\n%%EOF');
    const input = { draftId, requestId: randomUUID(), batchId: randomUUID(), expectedRevision: 0, sourceSha256: sha(bytes),
      sourceSize: bytes.length, evidenceSummary: sha(Buffer.from('Цитата')), facts: { supplierId, payerCompanyId, supplierInn: '0107020521',
        payerInn: '2312308098', no: draftId, date: '2026-11-20', gross: 100, currency: 'RUB', vatMode: 'none',
        lines: [{ rowKey: '1', title: 'Образец', qty: 2, unit: 'шт', unitPrice: 50, amount: 100 }] } };
    return { input, bytes, uid: 'c169-' + input.sourceSha256 };
  };
  const version = (reply: { draftId: string; revision: number; payloadHash: string }) => ({ draftId: reply.draftId, revision: reply.revision, payloadHash: reply.payloadHash });
  const prepared = async () => {
    const sample = fixture();
    const reviewed = (await post('/review', sample.input).expect(200)).body;
    expect(reviewed.state).toBe('validated');
    const { ticket } = (await post('/prepare', version(reviewed)).expect(200)).body;
    return { ...sample, reviewed, ticket };
  };
  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'c171-e2e-')); before = process.env.UPLOAD_DIR; process.env.UPLOAD_DIR = folder;
    ctx = await createTestApp({ strictValidation: true });
    admin = (await loginAsAdmin(ctx.app)).access;
    const user = { username: 'c171-fixture-manager', password: 'local-fixture-password' };
    await http().post('/api/admin/users').set(authHeader(admin)).send({ ...user, role: 'manager' }).expect(201);
    manager = (await http().post('/api/auth/login').send(user).expect(200)).body.access;
    const parties = await ctx.connection.collection('organizations').insertMany([
      { name: 'Поставщик C171', type: ['supplier'], inn: '0107020521', deletedAt: null },
      { name: 'Плательщик C171', isOurCompany: true, inn: '2312308098', deletedAt: null }]);
    supplierId = String(parties.insertedIds[0]); payerCompanyId = String(parties.insertedIds[1]);
    for (const name of ['Photo', 'SupplyInvoice', 'SupplyRequest', 'Counter', 'SupplyIntakeReview']) await ctx.connection.models[name].createIndexes();
  });
  afterAll(async () => {
    await ctx?.cleanup();
    if (before === undefined) delete process.env.UPLOAD_DIR; else process.env.UPLOAD_DIR = before;
    if (folder?.startsWith(join(tmpdir(), 'c171-e2e-'))) await rm(folder, { recursive: true, force: true });
  });

  it('CAS, повтор requestId, отзыв после правки и доступ только владельца', async () => {
    const { input, bytes, reviewed, ticket } = await prepared();
    await post('/review', { ...input, sourceSize: 15 * 1024 * 1024 + 1 }).expect(400);
    expect((await post('/review', input).expect(200)).body).toMatchObject(reviewed);
    await post('/review', { ...input, evidenceSummary: 'b'.repeat(64) }).expect(409);
    await read(input.draftId, admin).expect(404);
    await post('/prepare', version(reviewed), admin).expect(404);
    await commit(input.draftId, ticket, bytes).set('Host','another.test').expect(409);
    await http().get(endpoint + '/review/' + input.draftId).expect(401);
    const changed = (await post('/review', { ...input, expectedRevision: 1, requestId: randomUUID(), withdraw: true }).expect(200)).body;
    expect(changed).toMatchObject({ revision: 2, state: 'question' });
    await commit(input.draftId, ticket, bytes).expect(409);
    await post('/prepare', version(reviewed)).expect(409);
    expect((await post('/review', input).expect(200)).body.revision).toBe(1);
    expect(await ctx.connection.collection('photos').countDocuments({ sha256: input.sourceSha256 })).toBe(0);
  });
  it('две независимые пачки одновременно получают одну квитанцию, чужой владелец и изменённые реквизиты отклоняются', async () => {
    const { input, bytes, uid, ticket } = await prepared();
    const another = () => ({ ...input, draftId: randomUUID(), batchId: randomUUID(), requestId: randomUUID() });
    const second = (await post('/review', another()).expect(200)).body;
    const confirmation = (await post('/prepare', version(second)).expect(200)).body;
    const [firstReceipt, secondReceipt] = await Promise.all([
      commit(input.draftId, ticket, bytes).expect(200), commit(second.draftId, confirmation.ticket, bytes).expect(200),
    ]);
    expect(firstReceipt.body).toEqual(secondReceipt.body);
    expect((await read(second.draftId).expect(200)).body.state).toBe('committed');
    expect(await ctx.connection.collection('supplyinvoices').countDocuments({ intakeUid: uid })).toBe(1);
    expect(await ctx.connection.collection('photos').countDocuments({ intakeUid: uid })).toBe(1);
    const after = (await post('/review', another()).expect(200)).body;
    await post('/prepare', version(after)).expect(200);
    expect((await read(after.draftId).expect(200)).body.state).toBe('committed');
    expect((await post('/review', { ...another(), facts: { ...input.facts, no: 'Иной номер' } }).expect(200)).body.state).toBe('question');
    expect((await post('/review', another(), admin).expect(200)).body.state).toBe('question');
  });
  it('истёкший тикет не создаёт файл, новая подготовка той же версии разрешена', async () => {
    const { input, bytes, ticket, reviewed } = await prepared();
    const drafts = ctx.connection.models.SupplyIntakeReview;
    await drafts.updateOne({ _id: input.draftId }, { $set: { expiresAt: new Date(0) } });
    await commit(input.draftId, ticket, bytes).expect(409);
    const fresh = (await post('/prepare', version(reviewed)).expect(200)).body;
    expect(fresh.ticket).not.toBe(ticket);
    await commit(input.draftId, ticket, bytes).expect(409);
    expect(await ctx.connection.collection('photos').countDocuments({ sha256: input.sourceSha256 })).toBe(0);
  });

  it('отказ на изменённом ИНН и неверных байтах сохраняет ноль бизнес-записей и PDF', async () => {
    const { input, bytes, ticket, uid } = await prepared();
    await commit(input.draftId, ticket, Buffer.from(bytes).fill(0)).expect(400);
    const supplier = { _id: new Types.ObjectId(supplierId) };
    await ctx.connection.collection('organizations').updateOne(supplier, { $set: { inn: '7707083893' } });
    try { await commit(input.draftId, ticket, bytes).expect(409); }
    finally { await ctx.connection.collection('organizations').updateOne(supplier, { $set: { inn: input.facts.supplierInn } }); }
    expect((await read(input.draftId).expect(200)).body.state).toBe('question');
    expect(await ctx.connection.collection('supplyinvoices').countDocuments({ intakeUid: uid })).toBe(0);
    expect(await ctx.connection.collection('photos').countDocuments({ sha256: input.sourceSha256 })).toBe(0);
  });
  it.each(['до rename', 'после rename'])('сбой %s и перед commit Mongo восстанавливает одну квитанцию при конкурентном повторе', async stage => {
    const { input, bytes, ticket, uid, reviewed } = await prepared();
    const original = storage.stageReviewedPdf;
    let physicalId = '';
    const crash = jest.spyOn(storage, 'stageReviewedPdf').mockImplementationOnce(async (id, content, hash) => {
      physicalId = id;
      if (stage === 'после rename') await original(id, content, hash);
      else {
        const privateDir = join(folder, '.reviewed-invoices');
        await mkdir(privateDir, { recursive: true });
        await writeFile(join(privateDir, id + '.pdf.' + randomUUID() + '.tmp'), content);
      }
      throw Error('искусственный обрыв процесса');
    });
    try { await commit(input.draftId, ticket, bytes).expect(503); } finally { crash.mockRestore(); }
    const photos = ctx.module.get(PhotoIntakeService);
    expect(await photos.reviewedPath(physicalId)).toBeNull();
    expect(await ctx.connection.collection('supplyinvoices').countDocuments({ intakeUid: uid })).toBe(0);
    expect((await read(input.draftId).expect(200)).body.state).toBe('committing');
    const [a,b] = await Promise.all([commit(input.draftId, ticket, bytes), commit(input.draftId, ticket, bytes)]);
    expect([a.status,b.status]).toEqual([200,200]); expect(a.body).toEqual(b.body);
    const receipt = (await http().get(endpoint + '/' + uid).set(authHeader(manager)).expect(200)).body;
    expect(receipt).toMatchObject({ uid, payloadHash: reviewed.payloadHash, invoiceId: a.body.invoiceId });
    expect(await photos.reviewedPath(physicalId)).toBeTruthy();
    expect((await readdir(join(folder,'.reviewed-invoices'))).filter(f => f.startsWith(physicalId))).toEqual([physicalId + '.pdf']);
    expect(await ctx.connection.collection('photos').countDocuments({ sha256: input.sourceSha256 })).toBe(1);
    expect(await ctx.connection.collection('supplyrequests').countDocuments({ invoiceId: new Types.ObjectId(receipt.invoiceId) })).toBe(1);
    expect((await read(input.draftId).expect(200)).body.state).toBe('committed');
  });

  it('Пульт → Nest → Mongo → ссылка PDF, правка версии и восстановление после потери ответа', async () => {
    await ctx.app.listen(0,'127.0.0.1');
    const api = await ctx.app.getUrl() + '/api';
    const { stdout } = await promisify(execFile)(process.execPath, [join(__dirname,'../../../tools/document-intake/review-roundtrip.fixture.mjs'), api, folder], { timeout: 45_000 });
    expect(stdout).toContain('PASS');
    expect(await ctx.connection.collection('supplyinvoices').countDocuments({ no: 'В-83' })).toBe(1);
  }, 55_000);
});
