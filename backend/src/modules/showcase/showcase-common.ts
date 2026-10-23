import type { Connection } from 'mongoose';
import type { Types } from 'mongoose';

export type Db = NonNullable<Connection['db']>;
export type Doc = Record<string, unknown> & { _id: Types.ObjectId };
export const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();
export const LIVE = { deletedAt: null };
/** Варианты изделия (цвета, размеры): список или строка «через запятую / с новой строки» → уникальные непустые, до 50. */
export const variants = (v: unknown) => [...new Set((Array.isArray(v) ? v : String(v ?? '').split(/[,;\n]/)).map(clean).filter(Boolean))].slice(0, 50);

/** Фото по id: оригинал и миниатюра. */
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
