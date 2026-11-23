import { Types, type Connection } from 'mongoose';
import { loadLivePhotos, photoObjectIds, resolveProductPhotos } from './product-photos';

type Db = NonNullable<Connection['db']>;

type LineLike = { _id: unknown; photoIds?: unknown; productId?: unknown };
export type LinePhoto = { url: string; thumb: string } | null;

/** Источник фото строки: своё (photoIds[0]) → главное фото изделия → null. prodFirst: id изделия → его первое фото. */
export function linePhotoId(line: Pick<LineLike, 'photoIds' | 'productId'>, prodFirst: Map<string, unknown>): string | null {
  const own = ((line.photoIds as unknown[] | undefined) ?? [])[0];
  const id = own ?? (line.productId ? prodFirst.get(String(line.productId)) : undefined);
  return id ? String(id) : null;
}

/** Фото строк: пригодное собственное → каталог изделия → паспортный overview. Только пакетное чтение. */
export async function loadLinePhotos(db: Db, lines: LineLike[]): Promise<Map<string, LinePhoto>> {
  const result = new Map<string, LinePhoto>();
  if (!lines.length) return result;
  const own = await loadLivePhotos(db, lines.flatMap((l) => Array.isArray(l.photoIds) ? l.photoIds : []));
  for (const line of lines) {
    const p = photoObjectIds(line.photoIds).map((id) => own.get(String(id))).find(Boolean);
    result.set(String(line._id), p ? { url: p.url, thumb: p.thumb } : null);
  }
  const missing = lines.filter((l) => !result.get(String(l._id)));
  const productIds = photoObjectIds([...new Set(missing.map((l) => String(l.productId ?? '')))]);
  if (!productIds.length) return result;
  const products = await db.collection('products').find({ _id: { $in: productIds }, deletedAt: null }, { projection: { photoIds: 1 } }).toArray();
  const { pictures, covers } = await resolveProductPhotos(db, products);
  for (const line of missing) {
    const key = String(line.productId), p = pictures.get(key)?.[0] ?? covers.get(key);
    if (p) result.set(String(line._id), { url: p.url, thumb: p.thumb });
  }
  return result;
}

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
