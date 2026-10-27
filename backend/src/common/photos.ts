import type { Connection, Types } from 'mongoose';

type Db = NonNullable<Connection['db']>;

/** Фото по id: оригинал и миниатюра — двумя запросами на любой набор id (общий помощник: доска, позиции, изделия). */
export async function loadPhotos(db: Db, ids: Types.ObjectId[]) {
  const map = new Map<string, { id: string; url: string; thumb: string }>();
  if (!ids.length) return map;
  const [orig, thumbs] = await Promise.all([
    db.collection('photos').find({ _id: { $in: ids } }, { projection: { storageUrl: 1 } }).toArray(),
    db.collection('photos').find({ parentPhotoId: { $in: ids }, variant: 'thumb' }, { projection: { storageUrl: 1, parentPhotoId: 1 } }).toArray(),
  ]);
  const th = new Map(thumbs.map((t) => [String(t.parentPhotoId), String(t.storageUrl)]));
  for (const p of orig) map.set(String(p._id), { id: String(p._id), url: String(p.storageUrl), thumb: th.get(String(p._id)) ?? String(p.storageUrl) });
  return map;
}
