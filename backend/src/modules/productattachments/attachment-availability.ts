import { promises as fs } from 'fs';
import type { PassportSelection } from '../../common/passport/line-source';
import type { ClientSession, Connection } from 'mongoose';
import { Types } from 'mongoose';
import { resolveInside } from './attachment-paths';
import { UPLOAD_DIR } from '../photos/image-upload.options';
type Db = NonNullable<Connection['db']>;
type FileDoc = Record<string, unknown> & { passportSelection?: PassportSelection };
export async function attachmentAvailable(d: FileDoc | null | undefined) {
  if (!d || d.deletedAt || d.fileRemovedAt || d.purgeState === 'purging') return false;
  try { return (await fs.stat(resolveInside(UPLOAD_DIR, String(d.storedPath)))).isFile(); } catch { return false; }
}
export async function selectedAttachments(db: Db, incomes: FileDoc[], session?: ClientSession) {
  const ids = [...new Set(incomes.map(d => d.passportSelection?.attachmentId).filter(Boolean).map(String))].filter(Types.ObjectId.isValid).map(id => new Types.ObjectId(id));
  const files = ids.length ? await db.collection('productattachments').find({ _id: { $in: ids } }, { session }).toArray() : [];
  const types = files.length ? await db.collection('dict_values').find({ _id: { $in: files.map(f => f.typeId) } }, { projection: { name: 1 }, session }).toArray() : [];
  const names = new Map(types.map(t => [String(t._id), String(t.name ?? '')]));
  const result = new Map<string, Awaited<ReturnType<typeof presentSourceAttachment>>>();
  for (let i = 0; i < files.length; i += 8) await Promise.all(files.slice(i, i + 8).map(async d => result.set(String(d._id), await presentSourceAttachment(d, names.get(String(d.typeId)) ?? ''))));
  return result;
}
export async function presentSourceAttachment(d: FileDoc, typeName = '') {
  const available = await attachmentAvailable(d);
  return { id: String(d._id), productId: String(d.productId), originalName: String(d.originalName ?? ''), size: Number(d.size ?? 0), ext: String(d.ext ?? ''), mime: d.mime ?? null, typeId: String(d.typeId), typeName, selectionGeneration: Number(d.selectionGeneration ?? 0), available, unavailableReason: available ? null : d.deletedAt || d.fileRemovedAt || d.purgeState === 'purging' ? 'ATTACHMENT_DELETED' : 'FILE_MISSING' };
}
export function effectiveAttachment(inc: FileDoc, file: Awaited<ReturnType<typeof presentSourceAttachment>> | undefined, productAvailable = true) {
  const s = inc.passportSelection;
  if (file && file.productId !== String(inc.productId)) file = undefined;
  const reason = !productAvailable ? 'PRODUCT_UNAVAILABLE' : s?.invalidReason || (String(s?.productIdAtSelection) !== String(inc.productId) || inc.lineType === 'service' ? 'PRODUCT_CHANGED' : !file || Number(s?.attachmentGeneration ?? 0) !== file.selectionGeneration ? 'ATTACHMENT_DELETED' : file.unavailableReason);
  return { attachment: file ? { ...file, available: !reason && file.available, unavailableReason: reason || null } : null, missing: reason ? [reason === 'PRODUCT_UNAVAILABLE' ? 'Изделие не найдено или удалено — вложенный паспорт недоступен' : reason === 'PRODUCT_CHANGED' ? 'Изделие позиции изменилось — выберите паспорт заново' : reason === 'ATTACHMENT_DELETED' ? 'Вложение удалено или восстановлено — выберите паспорт заново' : 'Файл не найден на сервере'] : [] };
}
