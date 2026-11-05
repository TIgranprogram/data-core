import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { attachmentsWarning } from '../disk/disk-usage';
import { skipAttachments } from '../disk/backups';
import { OrderAttachmentsController, OrderAttachmentsZipController } from './productattachments.controller';
import { OrderAttachmentsService } from './order-attachments.service';
import { ProductAttachmentsService, PURGE_DAYS } from './productattachments.service';
import { ZipSlots, skippedText, uniqueName, zipEntryNames, zipMaxBytes } from './order-zip';

const G = 1024 ** 3;
const oid = (n: number) => n.toString(16).padStart(24, '0');
// тесты кладут файлы в uploads/attachments/<000…01>/ — убрать за собой
afterAll(async () => { const { UPLOAD_DIR } = await import('../photos/image-upload.options'); await fs.rm(path.join(path.resolve(UPLOAD_DIR), 'attachments', oid(1)), { recursive: true, force: true }); });

describe('ZIP по заказу: чистые функции', () => {
  it('имена: структура заказ/изделие/вид/файл, дубли с суффиксом, путь очищен', () => {
    const it = (name: string) => ({ productKey: 'p', productLabel: 'A-1 — Болт', typeName: 'Чертежи', originalName: name, abs: '/x' });
    expect(zipEntryNames('№12/3', [it('a.pdf'), it('A.pdf'), it('../../evil.pdf'), it('a.pdf')])).toEqual([
      '№12_3/A-1 — Болт/Чертежи/a.pdf', '№12_3/A-1 — Болт/Чертежи/A (2).pdf', '№12_3/A-1 — Болт/Чертежи/_.._evil.pdf', '№12_3/A-1 — Болт/Чертежи/a (3).pdf',
    ]);
    expect(zipEntryNames('1', [it('a.pdf')])[0]).not.toContain('..');
    expect(uniqueName('x', new Set(['x']))).toBe('x (2)');
  });
  it('не более двух сборок сразу, место освобождается один раз', () => {
    const s = new ZipSlots(2);
    const a = s.take(); const b = s.take();
    expect(a && b).toBeTruthy();
    expect(s.take()).toBeNull();
    a!(); a!();
    expect(s.busy).toBe(1);
    expect(s.take()).not.toBeNull();
  });
  it('потолок размера: 5 ГБ по умолчанию, настраивается', () => {
    expect(zipMaxBytes({})).toBe(5 * G);
    expect(zipMaxBytes({ ATTACHMENT_ZIP_MAX_BYTES: '100' } as never)).toBe(100);
    expect(zipMaxBytes({ ATTACHMENT_ZIP_MAX_BYTES: 'x' } as never)).toBe(5 * G);
  });
  it('_ПРОПУЩЕНО.txt перечисляет файлы', () => {
    expect(skippedText(['a', 'b'])).toContain('\r\na\r\nb');
  });
});

// Мини-фейк базы: коллекции — массивы, find/findOne с простым сравнением нужных полей.
function fakeConn(data: Record<string, Array<Record<string, unknown>>>) {
  const match = (row: Record<string, unknown>, q: Record<string, unknown>) => Object.entries(q).every(([k, v]) => {
    const x = row[k];
    if (v && typeof v === 'object' && '$in' in (v as object)) return ((v as { $in: unknown[] }).$in).some((y) => String(y) === String(x));
    if (v && typeof v === 'object' && '$ne' in (v as object)) return String((v as { $ne: unknown }).$ne ?? null) !== String(x ?? null);
    return String(v ?? null) === String(x ?? null);
  });
  const col = (name: string) => ({
    findOne: async (q: Record<string, unknown>) => (data[name] ?? []).find((r) => match(r, q)) ?? null,
    find: (q: Record<string, unknown>) => { const rows = (data[name] ?? []).filter((r) => match(r, q)); const c = { sort: () => c, toArray: async () => rows }; return c; },
  });
  return { db: { collection: col } } as never;
}

describe('ZIP по заказу: состав', () => {
  let dir: string;
  const prev = process.env.UPLOAD_DIR;
  beforeAll(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'zip-')); });
  afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); void prev; });

  it('цепочка заказ → позиции → изделия → вложения, услуги и удалённые пропускаются, нет файла — в «пропущено»', async () => {
    const { UPLOAD_DIR } = await import('../photos/image-upload.options');
    const rel = `attachments/${oid(1)}/${oid(9)}/t-${Date.now()}.pdf`;
    const abs = path.join(path.resolve(UPLOAD_DIR), rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, 'hello');
    try {
      const conn = fakeConn({
        salesorders: [{ _id: oid(100), orderNo: '2026-5' }],
        incomes: [
          { orderId: oid(100), productId: oid(1), lineType: 'product', deletedAt: null },
          { orderId: oid(100), productId: oid(1), lineType: 'product', deletedAt: null }, // тот же товар — один раз
          { orderId: oid(100), productId: oid(2), lineType: 'service', deletedAt: null },
        ],
        products: [{ _id: oid(1), sku: 'A-1', name: 'Болт' }],
        dict_values: [{ _id: oid(9), dict: 'attachmentTypes', name: 'Чертежи' }],
        productattachments: [
          { productId: oid(1), typeId: oid(9), storedPath: rel, originalName: 'ч.pdf', deletedAt: null },
          { productId: oid(1), typeId: oid(9), storedPath: `attachments/${oid(1)}/${oid(9)}/net.pdf`, originalName: 'нет.pdf', deletedAt: null },
          { productId: oid(1), typeId: oid(9), storedPath: '../../etc/passwd', originalName: 'x', deletedAt: null },
          { productId: oid(1), typeId: oid(9), storedPath: rel, originalName: 'убран.pdf', deletedAt: new Date() },
        ],
      });
      const svc = new OrderAttachmentsService(conn);
      const p = await svc.plan(oid(100), [oid(9)]);
      expect(p).toMatchObject({ orderNo: '2026-5', files: 1, bytes: 5 });
      expect(p.missing).toHaveLength(2);
      expect(p.items[0].productLabel).toBe('A-1 — Болт');
      await expect(svc.plan(oid(101), [oid(9)])).rejects.toThrow('Заказ не найден');
      await expect(svc.plan('bad', [oid(9)])).rejects.toThrow('Заказ не найден');
      expect(await svc.summary(oid(100), oid(9))).toMatchObject({ files: 1, bytes: 5, skipped: 2, tooBig: false });
    } finally { await fs.rm(abs, { force: true }); }
  });

  it('виды: пусто и мусор — 400; тикет одноразовый и привязан к набору видов', async () => {
    const svc = new OrderAttachmentsService(fakeConn({}));
    expect(() => svc.parseTypes('')).toThrow('хотя бы один вид');
    expect(() => svc.parseTypes('x,y')).toThrow('Неверный вид');
    expect(svc.parseTypes(`${oid(9)},${oid(9).toUpperCase()}`)).toEqual([oid(9)]);
    const res = { set: jest.fn() } as never;
    await expect(svc.stream(oid(100), oid(9), 'нет-такого', res)).rejects.toThrow('устарела');
  });
});

describe('ZIP по заказу: маршруты', () => {
  const roles = (c: object, m: string) => new Reflector().get(ROLES_KEY, (c as { prototype: Record<string, never> }).prototype[m]);
  it('роли как у чтения вложений; сам архив — публичный по тикету', () => {
    expect(roles(OrderAttachmentsController, 'summary')).toEqual(['admin', 'director', 'manager', 'user']);
    expect(roles(OrderAttachmentsController, 'zipTicket')).toEqual(['admin', 'director', 'manager', 'user']);
    expect(Reflect.getMetadata('isPublic', OrderAttachmentsZipController) ?? Reflect.getMetadataKeys(OrderAttachmentsZipController).length).toBeTruthy();
  });
});

describe('метрики диска вложений', () => {
  it('нет вложений — нет предупреждения', () => {
    expect(attachmentsWarning(0, 100 * G, 5 * G)).toBeNull();
    expect(attachmentsWarning(null, 100 * G, 5 * G)).toBeNull();
  });
  it('жёлтое: свободно < 15 % или < 10 ГБ; красное: < 10 % / < 5 ГБ / больше потолка', () => {
    expect(attachmentsWarning(G, 1000 * G, 500 * G, 50 * G)).toBeNull();
    expect(attachmentsWarning(G, 100 * G, 14 * G, 50 * G)?.level).toBe('warn');
    expect(attachmentsWarning(G, 50 * G, 9 * G, 50 * G)?.level).toBe('warn');
    expect(attachmentsWarning(G, 100 * G, 9 * G, 50 * G)?.level).toBe('danger');
    expect(attachmentsWarning(G, 1000 * G, 4 * G, 50 * G)?.level).toBe('danger');
    expect(attachmentsWarning(60 * G, 1000 * G, 500 * G, 50 * G)?.level).toBe('danger');
    expect(attachmentsWarning(G, 100 * G, 14 * G, 50 * G)?.text).toContain('Вложения изделий занимают');
  });
});

describe('копия вне дома: вложения исключены', () => {
  const f = skipAttachments('uploads-2026');
  it('по умолчанию attachments не входят, остальное — да', () => {
    expect(f({ name: 'uploads-2026/attachments' })).toBe(false);
    expect(f({ name: 'uploads-2026/attachments/a/b/c.pdf' })).toBe(false);
    expect(f({ name: 'uploads-2026\\attachments\\x.pdf' })).toBe(false);
    const keep = { name: 'uploads-2026/photos/a.jpg' };
    expect(f(keep)).toBe(keep);
    const near = { name: 'uploads-2026/attachments-old/a.jpg' };
    expect(f(near)).toBe(near);
  });
  it('BACKUP_ATTACHMENTS=1 возвращает вложения', () => {
    const keep = { name: 'uploads-2026/attachments/a.pdf' };
    expect(skipAttachments('uploads-2026', { BACKUP_ATTACHMENTS: '1' } as never)(keep)).toBe(keep);
  });
});

describe('ночная чистка убранных вложений', () => {
  it('стирает файлы старше 14 дней, запись помечает, свежие и чужие пути не трогает', async () => {
    const { UPLOAD_DIR } = await import('../photos/image-upload.options');
    const root = path.resolve(UPLOAD_DIR);
    const rel = `attachments/${oid(1)}/${oid(9)}/purge-${Date.now()}.pdf`;
    const abs = path.join(root, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, 'x');
    const now = new Date('2026-11-30T03:00:00Z');
    const old = { _id: 'a', storedPath: rel };
    const evil = { _id: 'b', storedPath: '../../outside.txt' };
    const updated: string[] = [];
    let query: { deletedAt: { $lt: Date } } | undefined;
    const model = {
      find: (q: typeof query) => { query = q; return { limit: () => ({ exec: async () => [old, evil] }) }; },
      updateOne: async (f: { _id: string }) => { updated.push(f._id); },
    };
    const svc = new ProductAttachmentsService(model as never, {} as never, {} as never);
    try {
      expect(await svc.purgeDeleted(now)).toBe(1);
      expect(updated).toEqual(['a']);
      expect(query!.deletedAt.$lt.getTime()).toBe(now.getTime() - PURGE_DAYS * 86400_000);
      await expect(fs.stat(abs)).rejects.toThrow();
    } finally { await fs.rm(abs, { force: true }); }
  });
  it('стёртое вложение вернуть нельзя', async () => {
    const doc = { _id: 'a', fileRemovedAt: new Date(), storedPath: 'x' };
    const model = { findOne: () => ({ exec: async () => doc }), updateOne: jest.fn() };
    const svc = new ProductAttachmentsService(model as never, {} as never, {} as never);
    await expect(svc.restore(oid(1), oid(2))).rejects.toThrow('уже стёрт');
    expect(model.updateOne).not.toHaveBeenCalled();
  });
});
