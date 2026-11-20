import { createHash } from 'crypto';
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { Types } from 'mongoose';
import request from 'supertest';
import { PDF_UPLOAD_MAX_BYTES } from '../../src/modules/photos/image-upload.options';
import { PHOTO_INTAKE_UID_INDEX } from '../../src/modules/photos/photo.schema';
import { authHeader, loginAsAdmin } from '../setup/admin.fixture';
import { createTestApp, type TestContext } from '../setup/test-db';

const pdf = Buffer.from('%PDF-1.4\nИзолированный оригинал C169\n%%EOF');
const altered = Buffer.from('%PDF-1.4\nИзменённый оригинал C169\n%%EOF');
const shaOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sha = shaOf(pdf);
const url = (uid: string) => '/api/photos/intake/' + uid;

describe('C169 — устойчивая квитанция оригинала', () => {
  let ctx: TestContext | undefined;
  let uploadDir = '';
  let originalEnv: string | undefined;
  let admin = '';
  let manager = '';
  let observer = '';
  const http = () => request(ctx!.app.getHttpServer());
  const photos = () => ctx!.connection.db!.collection('photos');
  const localPath = (storageUrl: string) => join(uploadDir, 'document-intake', basename(storageUrl));
  const upload = (uid: string, token = manager, hash = sha, bytes = pdf, key?: string) => {
    const req = http().post(url(uid)).query({ sha256: hash });
    if (token) req.set(authHeader(token));
    if (key) req.set('Idempotency-Key', key);
    return req.attach('file', bytes, { filename: 'original.pdf', contentType: 'application/pdf' });
  };

  beforeAll(async () => {
    originalEnv = process.env.UPLOAD_DIR;
    uploadDir = await mkdtemp(join(tmpdir(), 'c169-photo-e2e-'));
    process.env.UPLOAD_DIR = uploadDir;
    ctx = await createTestApp({ strictValidation: true });
    admin = (await loginAsAdmin(ctx.app)).access;
    const login = async (role: string) => {
      const username = 'c169-photo-' + role;
      const password = 'c169-isolated-test-user';
      await http().post('/api/admin/users').set(authHeader(admin)).send({ username, password, role }).expect(201);
      return (await http().post('/api/auth/login').send({ username, password }).expect(200)).body.access as string;
    };
    manager = await login('manager');
    observer = await login('user');
    await ctx.connection.models.Photo.createIndexes();
  });

  afterAll(async () => {
    await ctx?.cleanup();
    if (originalEnv === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalEnv;
    if (uploadDir.startsWith(join(tmpdir(), 'c169-photo-e2e-'))) await rm(uploadDir, { recursive: true, force: true });
  });

  it('параллельная запись, переименование и потеря ответа оставляют одну запись, файл и квитанцию', async () => {
    const uid = 'c169-race';
    const concurrent = await Promise.all([upload(uid).expect(200), upload(uid).expect(200)]);
    const receipt = (await http().get(url(uid)).set(authHeader(manager)).expect(200)).body;
    const replay = await http().post(url(uid)).set(authHeader(manager)).query({ sha256: sha })
      .attach('file', pdf, { filename: 'renamed.pdf', contentType: 'application/pdf' }).expect(200);
    expect(concurrent.map(result => result.body)).toEqual([receipt, receipt]);
    expect(replay.body).toEqual(receipt);
    expect(receipt).toEqual({ uid, sha256: sha, fileId: expect.any(String), storageUrl: `/uploads/document-intake/${receipt.fileId}.pdf` });
    expect(await photos().countDocuments({ intakeUid: uid })).toBe(1);
    expect((await readdir(join(uploadDir, 'document-intake'))).filter(name => name.endsWith('.pdf'))).toEqual([receipt.fileId + '.pdf']);
    expect(await readFile(localPath(receipt.storageUrl))).toEqual(pdf);
    const legacy = await http().get('/api/photos/' + receipt.fileId).set(authHeader(manager)).expect(200);
    expect(legacy.body).not.toHaveProperty('intakeUid');
    expect(legacy.body).not.toHaveProperty('intakeAccount');
    await http().delete('/api/photos/' + receipt.fileId).set(authHeader(manager)).expect(409);
  });

  it('заголовок общего кэша не обходит JWT, аккаунт, SHA или проверку байтов', async () => {
    const uid = 'c169-owned';
    const sharedKey = 'c169-shared-http-key';
    await upload(uid, manager, sha, pdf, sharedKey).expect(200);
    await upload(uid, '', sha, pdf, sharedKey).expect(401);
    await upload(uid, admin, sha, pdf, sharedKey).expect(409);
    await upload(uid, manager, shaOf(altered), altered, sharedKey).expect(409);
    await upload(uid, manager, sha, altered, sharedKey).expect(400);
    await http().get(url(uid)).set(authHeader(admin)).expect(409);
    await http().get(url(uid)).set(authHeader(observer)).expect(403);
    await upload(uid, observer).expect(403);
  });

  it('строгая проверка query, типа файла и байтов не резервирует UID', async () => {
    const uid = 'c169-bad-input';
    await upload(uid, manager, sha, altered).expect(400);
    await upload(uid, manager, sha.toUpperCase()).expect(400);
    await http().post(url(uid)).set(authHeader(manager)).query({ sha256: sha, extra: 'forbidden' })
      .attach('file', pdf, { filename: 'original.pdf', contentType: 'application/pdf' }).expect(400);
    await http().post(url(uid)).set(authHeader(manager)).query({ sha256: sha })
      .attach('file', pdf, { filename: 'original.xlsx', contentType: 'application/octet-stream' }).expect(400);
    expect(await photos().countDocuments({ intakeUid: uid })).toBe(0);
  });

  it('разделы документов закрыты либо скрыты деньги — роль менеджера не открывает загрузку', async () => {
    const roles = ctx!.connection.db!.collection('roles');
    const managerRole = { name: 'manager' };
    const role = await roles.findOne(managerRole);
    try {
      await roles.updateOne(managerRole, { $set: { appSections: ['home'] } });
      await upload('c169-closed-sections').expect(403);
    } finally {
      await roles.updateOne(managerRole, { $set: { appSections: role?.appSections ?? [] } });
    }
    try {
      await roles.updateOne(managerRole, { $set: { money: false } });
      await upload('c169-money-hidden').expect(403);
    } finally {
      await roles.updateOne(managerRole, role?.money === undefined ? { $unset: { money: '' } } : { $set: { money: role.money } });
    }
  });

  it('принимает PDF ровно в 20 МиБ, больший файл отклоняет до резервации', async () => {
    const limit = Buffer.alloc(PDF_UPLOAD_MAX_BYTES);
    pdf.copy(limit);
    await upload('c169-limit', manager, shaOf(limit), limit).expect(200);
    const tooLarge = Buffer.concat([limit, Buffer.alloc(1)]);
    await upload('c169-overlimit', manager, shaOf(tooLarge), tooLarge).expect(413);
    expect(await photos().countDocuments({ intakeUid: 'c169-overlimit' })).toBe(0);
  });

  it('отсутствующий физический файл не даёт квитанцию, точный повтор восстанавливает его', async () => {
    const uid = 'c169-missing';
    const receipt = (await upload(uid).expect(200)).body;
    const file = localPath(receipt.storageUrl);
    await unlink(file);
    await http().get(url(uid)).set(authHeader(manager)).expect(404);
    expect((await upload(uid).expect(200)).body).toEqual(receipt);
    expect(await readFile(file)).toEqual(pdf);
    const corrupted = Buffer.from(pdf);
    corrupted[7] = 0;
    await writeFile(file, corrupted);
    await http().get(url(uid)).set(authHeader(manager)).expect(409);
    await upload(uid).expect(409);
    expect(await readFile(file)).toEqual(corrupted);
  });

  it('удалённая запись сохраняет уникальный UID и блокирует повтор', async () => {
    const uid = 'c169-deleted';
    const receipt = (await upload(uid).expect(200)).body;
    await photos().updateOne({ _id: new Types.ObjectId(receipt.fileId) }, { $set: { deletedAt: new Date() } });
    await http().get(url(uid)).set(authHeader(manager)).expect(409);
    await upload(uid).expect(409);
    expect(await photos().countDocuments({ intakeUid: uid })).toBe(1);
  });

  it('legacy JSON не может создать резерв или ссылку на его физический файл', async () => {
    const uid = 'c169-legacy-injection';
    await http().post('/api/photos').set(authHeader(manager))
      .send({ storageUrl: '/uploads/legacy-c169.pdf', intakeUid: uid, intakeAccount: 'example', sha256: sha }).expect(201);
    await http().get(url(uid)).set(authHeader(manager)).expect(404);
    const receipt = (await upload(uid).expect(200)).body;
    await http().post('/api/photos').set(authHeader(manager)).send({ storageUrl: receipt.storageUrl }).expect(400);
    expect(await photos().countDocuments({ intakeUid: uid })).toBe(1);
  });

  it('без индекса сервис отвечает 503 и не создаёт запись', async () => {
    const uid = 'c169-no-index';
    await photos().dropIndex(PHOTO_INTAKE_UID_INDEX);
    try {
      await upload(uid).expect(503);
      await http().get(url(uid)).set(authHeader(manager)).expect(503);
      expect(await photos().countDocuments({ intakeUid: uid })).toBe(0);
    } finally {
      await ctx!.connection.models.Photo.createIndexes();
    }
  });
});
