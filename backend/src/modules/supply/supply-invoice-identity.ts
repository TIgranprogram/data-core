import { ConflictException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { Types, type ClientSession, type Connection } from 'mongoose';
import { parseSheetDate } from '../../common/date-parse';
import { legalHash } from '../../common/legal/legal-utils';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { PDF_UPLOAD_MAX_BYTES } from '../photos/image-upload.options';
import { inspectIntakePdf } from '../photos/photo-intake.storage';
import { normInvoiceNo } from './supply-invoice-rules';

const IDENTITY_GUARD_ID = new Types.ObjectId('c16900000000000000000001');
export const INVOICE_IDENTITY_FIELDS = ['no', 'date', 'supplierId', 'payerCompanyId', 'fileIds'] as const;

/** Общая точка записи для загрузчика и обычной правки реквизитов счёта. */
export async function lockInvoiceIdentity(connection: Connection, session: ClientSession): Promise<void> {
  await connection.db!.collection('counters').updateOne(
    { _id: IDENTITY_GUARD_ID },
    { $inc: { seq: 1 }, $setOnInsert: { entity: 'SupplyInvoiceIdentity', prefix: 'C169', year: 0 } },
    { upsert: true, session },
  );
}

export function legacyInvoiceKeyMatches(
  no: unknown, date: unknown, payer: unknown, noKey: string, day: string | undefined, payerId: string,
): boolean {
  if (normInvoiceNo(no) !== noKey || (payerId && payer && String(payer) !== payerId)) return false;
  const legacyDate = parseSheetDate(date);
  return !day || !legacyDate || legacyDate.toISOString().slice(0, 10) === day;
}

/** Обычная правка продолжает поддерживать намеренный дубль с явной причиной. */
export async function guardLegacyInvoiceIdentity(
  connection: Connection,
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
  reason: string | undefined,
  session: ClientSession,
): Promise<{ duplicateOf: Types.ObjectId; duplicateReason: string } | undefined> {
  const invoices = connection.db!.collection('supplyinvoices');
  const next = { ...current, ...patch };
  const filter = {
    _id: { $ne: current._id as Types.ObjectId }, deletedAt: null, status: { $ne: 'cancelled' },
    intakeUid: { $type: 'string' },
  };
  const findConflict = async () => {
    const noKey = normInvoiceNo(next.no);
    const day = parseSheetDate(next.date)?.toISOString().slice(0, 10);
    const payer = next.payerCompanyId ? String(next.payerCompanyId) : '';
    if (noKey && next.supplierId) {
      if (day && payer) {
        const key = legalHash([String(next.supplierId), payer, noKey, day]);
        const match = await invoices.findOne({ ...filter, intakeBusinessKey: key }, { session });
        if (match) return match;
      }
      const candidates = await invoices.find({ ...filter, supplierId: next.supplierId }, { session }).toArray();
      const match = candidates.find(row => legacyInvoiceKeyMatches(row.no, row.date, row.payerCompanyId, noKey, day, payer));
      if (match) return match;
    }
    if ('fileIds' in patch && Array.isArray(next.fileIds) && next.fileIds.length) {
      const ids = next.fileIds as Types.ObjectId[];
      const identical = await invoices.findOne({ ...filter, fileIds: { $in: ids } }, { session });
      if (identical) return identical;
      const photos = await connection.db!.collection('photos').find({ _id: { $in: ids }, deletedAt: null }, {
        projection: { sha256: 1, storageUrl: 1 }, session,
      }).toArray();
      for (const photo of photos) {
        const path = safeUploadPath(photo.storageUrl);
        const entry = path ? await fs.lstat(path).catch(() => null) : null;
        const bytes = path && entry?.isFile() && entry.size >= 5 && entry.size <= PDF_UPLOAD_MAX_BYTES
          ? await inspectIntakePdf(path, entry.size) : null;
        const hashes = [photo.sha256, bytes?.pdf ? bytes.sha256 : undefined].filter(value => typeof value === 'string');
        if (hashes.length) {
          const match = await invoices.findOne({ ...filter, intakeSourceSha256: { $in: hashes } }, { session });
          if (match) return match;
        }
      }
    }
    return undefined;
  };
  const conflict = await findConflict();
  if (!conflict) return;
  if (reason?.trim()) return { duplicateOf: conflict._id, duplicateReason: reason.trim() };
  throw new ConflictException('Счёт с таким ключом или оригиналом уже загружен');
}
