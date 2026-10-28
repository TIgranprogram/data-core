import type { Connection } from 'mongoose';

type Db = NonNullable<Connection['db']>;

/**
 * Миниатюра первого фото пачки документов (`photoIds[0]`): одним запросом, без N+1.
 * Вариант 'thumb' → иначе оригинал. Ключ карты — String(_id) документа.
 */
export async function firstPhotoThumbs(db: Db, docs: Array<{ _id: unknown; photoIds?: unknown }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const withPhoto = docs.filter((r) => Array.isArray(r.photoIds) && r.photoIds.length > 0);
  if (withPhoto.length === 0) return out;
  const firstIds = withPhoto.map((r) => (r.photoIds as any[])[0]); // eslint-disable-line @typescript-eslint/no-explicit-any -- ObjectId из mongoose и mongodb разных пакетов
  const [thumbs, originals] = await Promise.all([
    db.collection('photos').find({ parentPhotoId: { $in: firstIds }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
    db.collection('photos').find({ _id: { $in: firstIds } }, { projection: { storageUrl: 1 } }).toArray(),
  ]) as unknown as Array<Array<Record<string, unknown>>>;
  const byParent = new Map(thumbs.map((t) => [String(t.parentPhotoId), String(t.storageUrl)]));
  const byId = new Map(originals.map((p) => [String(p._id), String(p.storageUrl)]));
  for (const r of withPhoto) {
    const pid = String((r.photoIds as unknown[])[0]);
    const url = byParent.get(pid) ?? byId.get(pid);
    if (url) out.set(String(r._id), url);
  }
  return out;
}
