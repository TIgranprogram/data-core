import type { Connection, Types } from 'mongoose';

type Db = NonNullable<Connection['db']>;

/** Фото по id: оригинал, миниатюра и (если есть) medium — двумя запросами на любой набор id (общий помощник: доска, позиции, изделия). */
export async function loadPhotos(db: Db, ids: Types.ObjectId[]) {
  const map = new Map<string, { id: string; url: string; thumb: string; medium?: string }>();
  if (!ids.length) return map;
  const [orig, thumbs] = await Promise.all([
    db.collection('photos').find({ _id: { $in: ids } }, { projection: { storageUrl: 1 } }).toArray(),
    db.collection('photos').find({ parentPhotoId: { $in: ids }, variant: { $in: ['thumb', 'medium'] } }, { projection: { storageUrl: 1, parentPhotoId: 1, variant: 1 } }).toArray(),
  ]);
  const th = new Map(thumbs.filter((t) => t.variant === 'thumb').map((t) => [String(t.parentPhotoId), String(t.storageUrl)]));
  const md = new Map(thumbs.filter((t) => t.variant === 'medium').map((t) => [String(t.parentPhotoId), String(t.storageUrl)]));
  for (const p of orig) {
    const id = String(p._id);
    map.set(id, { id, url: String(p.storageUrl), thumb: th.get(id) ?? String(p.storageUrl), ...(md.has(id) ? { medium: md.get(id) } : {}) });
  }
  return map;
}
