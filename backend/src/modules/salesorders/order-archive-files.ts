import { ConflictException } from '@nestjs/common';
import type { ModuleRef } from '@nestjs/core';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { basename, isAbsolute, relative } from 'path';
import { Types, type ClientSession, type mongo } from 'mongoose';
import { safeUploadPath, uploadsRoot } from '../../common/uploads/safe-path';
import { isAttachmentsUrl, safeDownloadName } from '../productattachments/attachment-paths';
import { PassportPdfService } from '../product-passport/passport-pdf.service';
import { ShipmentsService } from '../shipments/shipments.service';
import { isIssued } from '../product-passport/passport-consts';
import { CHUNKS, type ArchiveFile } from './order-archive.schema';
import type { Facts } from './order-archive-facts';

const MAX_BYTES = 64 * 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
export function fileError(message: string, code = 'FILE_UNAVAILABLE'): never {
  throw new ConflictException({ code: 'ORDER_ARCHIVE_BLOCKED', message, blockers: [{ code, message }] });
}

interface Prepared {
  file: ArchiveFile;
  bytes: Buffer;
  url?: string;
}
async function read(url: string, limit: number): Promise<Buffer> {
  const disk = safeUploadPath(url);
  if (!disk) fileError('Источник не является локальным файлом загрузок');
  try {
    const actual = await fs.realpath(disk);
    const rel = relative(await fs.realpath(uploadsRoot()), actual);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) fileError('Путь источника вышел за папку загрузок');
    const handle = await fs.open(actual, 'r');
    try {
      const st = await handle.stat();
      if (!st.isFile() || !st.size) fileError('Исходный файл пуст или недоступен');
      if (st.size > limit) fileError('Комплект превышает предел одной фиксации (64 МиБ)', 'ARCHIVE_TOO_LARGE');
      return await handle.readFile();
    } finally { await handle.close(); }
  } catch (e) {
    if (e instanceof ConflictException) throw e;
    fileError('Исходный файл отсутствует или не читается');
  }
}

function photoIds(value: unknown, target: Set<string>) {
  if (!value || typeof value !== 'object' || value instanceof Date || value instanceof Types.ObjectId) return;
  for (const [key, field] of Object.entries(value)) {
    if (key === 'photoId' || key === 'photoIds') {
      for (const v of Array.isArray(field) ? field : [field]) {
        if (v == null || v === '') continue;
        if (!/^[a-f0-9]{24}$/i.test(String(v))) fileError('Некорректная ссылка на рисунок');
        target.add(String(v));
      }
    } else photoIds(field, target);
  }
}

export async function prepareFiles(db: mongo.Db, f: Facts, modules: ModuleRef): Promise<Prepared[]> {
  const out: Prepared[] = [];
  let total = 0;
  const put = (kind: ArchiveFile['kind'], sourceId: Types.ObjectId, name: string, mime: string, bytes: Buffer, url?: string, expected?: string) => {
    total += bytes.length;
    if (total > MAX_BYTES) fileError('Комплект превышает предел одной фиксации (64 МиБ)', 'ARCHIVE_TOO_LARGE');
    const sha256 = sha(bytes);
    if (expected && expected !== sha256) fileError('Контрольная сумма оригинала отличается от зарегистрированной');
    if (mime === 'application/pdf' && (bytes.subarray(0, 5).toString() !== '%PDF-' || !bytes.subarray(-2048).includes(Buffer.from('%%EOF'))))
      fileError('PDF отсутствует или обрезан');
    out.push({ file: { id: String(new Types.ObjectId()), sourceId, kind, name: safeDownloadName(name), mime, sha256, size: bytes.length }, bytes, url });
  };
  const sourceIds = new Set<string>();
  photoIds(f.lines, sourceIds);
  photoIds(f.passports, sourceIds);
  photoIds(f.design, sourceIds);
  const legalDocs: mongo.Document[] = [f.order.legal, ...(f.order.legalHistory ?? []).map((h: mongo.Document) => h.legal)]
    .flatMap(legal => legal?.documents ?? []);
  for (const d of legalDocs) {
    if (!/^[a-f\d]{24}$/i.test(String(d.fileId)) || !/^[a-f\d]{64}$/.test(d.sourceSha256)) fileError('Не зарегистрирован файл документа договора');
    sourceIds.add(String(d.fileId));
  }
  for (const id of sourceIds) {
    const p = await db.collection('photos').findOne({ _id: new Types.ObjectId(id), deletedAt: null, sourceDeleting: { $ne: true } });
    if (!p || isAttachmentsUrl(p.storageUrl)) fileError('Исходное фото или документ недоступны');
    const bytes = await read(p.storageUrl, MAX_BYTES - total);
    const docs = legalDocs.filter(d => String(d.fileId) === id);
    if (docs.some(d => d.sourceSha256 !== sha(bytes))) fileError('Хеш юридического документа не совпадает с оригиналом');
    put('photo', p._id, p.originalFilename || basename(p.storageUrl), p.mimeType || 'application/octet-stream', bytes, p.storageUrl, p.sha256);
  }
  for (const a of f.attachments) {
    if (a.fileRemovedAt || a.purgeState === 'purging' || !String(a.storedPath).startsWith(`attachments/${a.productId}/${a.typeId}/`))
      fileError('Вложение позиции недоступно');
    const url = '/uploads/' + a.storedPath;
    const bytes = await read(url, MAX_BYTES - total);
    if (bytes.length !== a.size) fileError('Размер вложения не совпадает с зарегистрированным');
    put('attachment', a._id, a.originalName, a.ext === 'pdf' ? 'application/pdf' : a.mime || 'application/octet-stream', bytes, url);
  }
  for (const p of f.passports) {
    // Старые редакции хранят собственные ссылки. Сохраняем и их файлы, включая отдельные графические ресурсы.
    const frozen = [p, ...(p.revisions ?? []).flatMap((r: mongo.Document) => [r, r.data, r.snapshot, r.before].filter(Boolean))];
    for (const doc of frozen) {
      const snap = doc.printSnapshot;
      const urls = [snap?.look?.coverFile, snap?.look?.pageFile, ...Object.values(snap?.photoUrls ?? {}), ...Object.values(snap?.assets ?? {}),
        ...(snap?.effectiveImages ?? []).map((x: mongo.Document) => x.url), ...(snap?.standardImages ?? []).map((x: mongo.Document) => x.url)];
      for (const url of urls) {
        if (!url || typeof url !== 'string' || out.some(x => x.url === url)) continue;
        if (isAttachmentsUrl(url)) fileError('Адрес рисунка не соответствует публичному источнику');
        put('print', p._id, basename(url), 'application/octet-stream', await read(url, MAX_BYTES - total), url);
      }
    }
    if (!isIssued({ status: p.status, passportNumber: p.passportNumber })) continue;
    const revisions = [...(p.revisions ?? [])].sort((a, b) => b.revision - a.revision);
    let version = Number(p.revision ?? 1), value: mongo.Document = { ...p };
    const capturePdf = async () => {
      const own = value.printFile;
      if (own?.path) {
        if (!String(own.path).startsWith('/uploads/passport/')) fileError('Неизвестный адрес собственного PDF');
        put('print', p._id, own.originalName, 'application/pdf', await read(own.path, MAX_BYTES - total), own.path);
      } else {
        try {
          const pdf = await modules.get(PassportPdfService, { strict: false }).archivePdf(value);
          put('passportPdf', p._id, pdf.filename, 'application/pdf', pdf.buf);
        } catch (e) {
          if (e instanceof ConflictException) throw e;
          fileError('Не удалось напечатать паспорт из сохранённых источников редакции ' + version);
        }
      }
      out[out.length - 1].file.passportRevision = version;
    };
    await capturePdf();
    // Каждая запись хранит предыдущие значения изменившихся полей. Восстанавливаем в обратном порядке.
    for (const r of revisions) {
      if (!Number.isInteger(r.revision) || r.revision !== version - 1 || !r.data || typeof r.data !== 'object')
        fileError('История редакций паспорта неполна. Нельзя восстановить его прежнюю печать');
      version = r.revision;
      value = { ...value, printFile: undefined, ...r.data, revision: version };
      await capturePdf();
    }
  }
  for (const s of f.shipments) {
    try {
      const pdf = await modules.get(ShipmentsService, { strict: false }).pdf(String(s._id));
      put('shipmentPdf', s._id, pdf.filename, 'application/pdf', pdf.buf);
    } catch (e) {
      if (e instanceof ConflictException) throw e;
      fileError('Не удалось сформировать исторический PDF отгрузки');
    }
  }
  return out;
}

export async function commitFiles(db: mongo.Db, orderId: Types.ObjectId, version: number, prepared: Prepared[], session: ClientSession) {
  for (const { file, bytes, url } of prepared) {
    if (file.kind === 'photo') {
      const aliases = db.collection('photos');
      const original = await aliases.findOne({ _id: file.sourceId, storageUrl: url, deletedAt: null }, { session });
      if (!original || await aliases.findOne({ storageUrl: url, sourceDeleting: true }, { session })) fileError('Исходное фото изменилось или удаляется');
      await aliases.updateMany({ storageUrl: url }, { $set: { sourceProtected: true }, $inc: { archiveFileGuard: 1 } }, { session });
    }
    if (file.kind === 'attachment') {
      const res = await db.collection('productattachments').updateOne({ _id: file.sourceId, deletedAt: null, fileRemovedAt: null, purgeState: { $ne: 'purging' } },
        { $set: { archiveProtected: true }, $inc: { selectionGuard: 1 } }, { session });
      if (!res.modifiedCount) fileError('Вложение удаляется или недоступно');
    }
    if (url && sha(await read(url, bytes.length)) !== file.sha256) fileError('Исходный файл изменился в процессе фиксации');
    for (let i = 0; i < bytes.length; i += CHUNK_BYTES)
      await db.collection(CHUNKS).insertOne({ orderId, version, fileId: file.id, seq: i / CHUNK_BYTES, data: bytes.subarray(i, i + CHUNK_BYTES) }, { session });
  }
  return prepared.map(x => x.file);
}
