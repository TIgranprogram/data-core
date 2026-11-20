import { createHash } from 'crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, unlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { basename, join } from 'path';
import { Types } from 'mongoose';
import { Photo, PHOTO_INTAKE_UID_INDEX } from './photo.schema';
import { PhotoIntakeService } from './photo-intake.service';

const pdf = Buffer.from('%PDF-1.4\nC169 origin\n%%EOF');
const altered = Buffer.from('%PDF-1.4\nC169 altered\n%%EOF');
const shaOf = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const sha = shaOf(pdf);
const uid = 'c169-file-unit';
const owner = 'account-a';
type PhotoRow = Photo & { _id: Types.ObjectId; intakeUid: string };

function makeStore() {
  const rows = new Map<string, PhotoRow>();
  const persist = ([entry]: [PhotoRow]) => {
    if (rows.has(entry.intakeUid)) throw Object.assign(new Error('duplicate'), { code: 11000 });
    const row = { deletedAt: null, ...entry };
    rows.set(entry.intakeUid, row);
    return [row];
  };
  const index = { name: PHOTO_INTAKE_UID_INDEX, key: { intakeUid: 1 }, unique: true, sparse: true };
  const indexes = jest.fn(async () => [index]);
  const model = {
    collection: { indexes },
    create: jest.fn(async (entries: [PhotoRow]) => persist(entries)),
    findOne: jest.fn(({ intakeUid }: { intakeUid: string }) => {
      const result = rows.get(intakeUid) ?? null;
      const query = {
        setOptions: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        readConcern: jest.fn().mockReturnThis(),
        maxTimeMS: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: async () => result,
      };
      return query;
    }),
  };
  return { service: new PhotoIntakeService(model as never), rows, model, indexes, persist };
}

describe('квитанция оригинала C169', () => {
  let root: string;
  let originalEnv: string | undefined;
  beforeEach(async () => {
    originalEnv = process.env.UPLOAD_DIR;
    root = await mkdtemp(join(tmpdir(), 'c169-photo-unit-'));
    process.env.UPLOAD_DIR = root;
    await mkdir(join(root, 'document-intake'));
  });
  afterEach(async () => {
    if (originalEnv === undefined) delete process.env.UPLOAD_DIR;
    else process.env.UPLOAD_DIR = originalEnv;
    if (root.startsWith(join(tmpdir(), 'c169-photo-unit-'))) await rm(root, { recursive: true, force: true });
  });
  const staged = async (name: string, bytes = pdf) => {
    const path = join(root, 'document-intake', name);
    await writeFile(path, bytes);
    return { path, size: bytes.length, originalname: name + '.pdf' };
  };
  const originals = async () => (await readdir(join(root, 'document-intake'))).filter(name => name.endsWith('.pdf'));
  const resolvedPath = (url: string) => join(root, 'document-intake', basename(url));

  it('параллельные повторы публикуют один оригинал, независимый GET восстанавливает потерянный ответ', async () => {
    const { service, rows, model } = makeStore();
    const a = await staged('request-a');
    const b = await staged('request-b');
    const receipts = await Promise.all([
      service.upload(uid, sha, owner, a),
      service.upload(uid, sha, owner, b),
    ]);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(await service.receipt(uid, owner)).toEqual(receipts[0]);
    expect(await service.upload(uid, sha, owner, b)).toEqual(receipts[0]);
    expect(rows.size).toBe(1);
    expect(model.create).toHaveBeenCalledWith(expect.any(Array), { w: 'majority', j: true, wtimeout: 5_000 });
    expect(rows.get(uid)).toMatchObject({ sourceProtected: true, sha256: sha, intakeAccount: owner });
    expect(await originals()).toEqual([receipts[0].fileId + '.pdf']);
    expect(await readFile(resolvedPath(receipts[0].storageUrl))).toEqual(pdf);
  });

  it('ложный SHA нового файла возвращает 400 и не занимает UID', async () => {
    const { service, rows } = makeStore();
    const file = await staged('incorrect', altered);
    await expect(service.upload(uid, sha, owner, file)).rejects.toMatchObject({ status: 400 });
    expect(rows.size).toBe(0);
    expect(await originals()).toHaveLength(0);
  });

  it('чужой аккаунт, другой SHA и запись в корзине блокируют чтение и повтор', async () => {
    const { service, rows } = makeStore();
    const file = await staged('original');
    const changed = await staged('changed', altered);
    await service.upload(uid, sha, owner, file);
    await expect(service.receipt(uid, 'account-b')).rejects.toMatchObject({ status: 409 });
    await expect(service.upload(uid, sha, 'account-b', file)).rejects.toMatchObject({ status: 409 });
    await expect(service.upload(uid, shaOf(altered), owner, changed)).rejects.toMatchObject({ status: 409 });
    await expect(service.upload(uid, sha, owner, changed)).rejects.toMatchObject({ status: 400 });
    rows.get(uid)!.deletedAt = new Date();
    await expect(service.receipt(uid, owner)).rejects.toMatchObject({ status: 409 });
    await expect(service.upload(uid, sha, owner, file)).rejects.toMatchObject({ status: 409 });
    expect(await originals()).toHaveLength(1);
  });

  it('после сбоя Mongo и отсутствия файла повтор сохраняет тот же зарезервированный ID', async () => {
    const { service, rows, model, persist } = makeStore();
    const file = await staged('resumable');
    model.create.mockImplementationOnce(async entries => {
      persist(entries);
      throw new Error('reply lost after database insert');
    });
    await expect(service.upload(uid, sha, owner, file)).rejects.toThrow('reply lost');
    const reservationId = String(rows.get(uid)!._id);
    await expect(service.receipt(uid, owner)).rejects.toMatchObject({ status: 404 });
    expect(await originals()).toHaveLength(0);
    const result = await service.upload(uid, sha, owner, file);
    expect(result.fileId).toBe(reservationId);
    await unlink(resolvedPath(result.storageUrl));
    await expect(service.receipt(uid, owner)).rejects.toMatchObject({ status: 404 });
    expect(await service.upload(uid, sha, owner, file)).toEqual(result);
    expect(model.create).toHaveBeenCalledTimes(1);
  });

  it('повреждённые байты не заменяются при повторе, даже если размер совпадает', async () => {
    const { service } = makeStore();
    const file = await staged('intact');
    const receipt = await service.upload(uid, sha, owner, file);
    const corrupt = Buffer.from(pdf);
    corrupt[10] = 0;
    await writeFile(resolvedPath(receipt.storageUrl), corrupt);
    await expect(service.receipt(uid, owner)).rejects.toMatchObject({ status: 409 });
    await expect(service.upload(uid, sha, owner, await staged('retry'))).rejects.toMatchObject({ status: 409 });
    expect(await readFile(resolvedPath(receipt.storageUrl))).toEqual(corrupt);
  });

  it('не подтверждает результат без настоящего unique sparse индекса', async () => {
    const { service, rows, indexes } = makeStore();
    indexes.mockResolvedValueOnce([{ name: PHOTO_INTAKE_UID_INDEX, key: { intakeUid: 1 }, unique: false, sparse: true }]);
    await expect(service.upload(uid, sha, owner, await staged('no-index'))).rejects.toMatchObject({ status: 503 });
    expect(rows.size).toBe(0);
    expect(await originals()).toHaveLength(0);
  });
});
