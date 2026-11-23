import { Types, type Connection } from 'mongoose';
import { safeUploadPath } from './uploads/safe-path';

type Db = NonNullable<Connection['db']>;
export type PhotoProduct = { _id: unknown; photoIds?: unknown };
export type ResolvedProductPhoto = { id: string; url: string; thumb: string; medium?: string };

export const photoObjectIds = (value: unknown): Types.ObjectId[] => (Array.isArray(value) ? value : []).flatMap((v) => {
  const id = String(v ?? '');
  return /^[a-f\d]{24}$/i.test(id) ? [new Types.ObjectId(id)] : [];
});

/** Только живые безопасные оригиналы; вариант не становится оригиналом по прямой ссылке на его ID. */
export async function loadLivePhotos(db: Db, values: unknown[]): Promise<Map<string, ResolvedProductPhoto>> {
  const ids = photoObjectIds([...new Set(values.map(String))]);
  const loaded = new Map<string, ResolvedProductPhoto>();
  if (!ids.length) return loaded;
  const [live, variants] = await Promise.all([
    db.collection('photos').find({ _id: { $in: ids }, deletedAt: null }, { projection: { storageUrl: 1, variant: 1, parentPhotoId: 1 } }).toArray(),
    db.collection('photos').find({ parentPhotoId: { $in: ids }, deletedAt: null, variant: { $in: ['thumb', 'medium'] } },
      { projection: { storageUrl: 1, parentPhotoId: 1, variant: 1 } }).toArray(),
  ]);
  const thumbs = new Map(variants.filter((p) => p.variant === 'thumb' && safeUploadPath(p.storageUrl)).map((p) => [String(p.parentPhotoId), String(p.storageUrl)]));
  const mediums = new Map(variants.filter((p) => p.variant === 'medium' && safeUploadPath(p.storageUrl)).map((p) => [String(p.parentPhotoId), String(p.storageUrl)]));
  for (const p of live) {
    if (p.parentPhotoId != null || (p.variant != null && p.variant !== 'original') || !safeUploadPath(p.storageUrl)) continue;
    const id = String(p._id), url = String(p.storageUrl);
    loaded.set(id, { id, url, thumb: thumbs.get(id) ?? url, ...(mediums.has(id) ? { medium: mediums.get(id) } : {}) });
  }
  return loaded;
}

/** Собственный каталог → живой паспортный overview → прежний паспорт. Пакетный resolver без чтения шаблона/PDF. */
export async function resolveProductPhotos(db: Db, docs: PhotoProduct[]) {
  const own = await loadLivePhotos(db, docs.flatMap((d) => Array.isArray(d.photoIds) ? d.photoIds : []));
  const pictures = new Map(docs.map((d) => [String(d._id), photoObjectIds(d.photoIds).map((id) => own.get(String(id))).filter((p): p is ResolvedProductPhoto => !!p)]));
  const missing = docs.filter((d) => !pictures.get(String(d._id))?.length);
  const covers = new Map<string, ResolvedProductPhoto>();
  const productIds = photoObjectIds(missing.map((d) => d._id));
  if (!productIds.length) return { pictures, covers };
  const [rows, passports] = await Promise.all([
    db.collection('productphotos').find({ productId: { $in: productIds }, deletedAt: null, purpose: 'passport', kind: 'overview' },
      { projection: { productId: 1, photoId: 1 } }).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).toArray(),
    db.collection('productpassports').find({ productId: { $in: productIds }, deletedAt: null, 'images.kind': 'overview' },
      { projection: { productId: 1, images: 1 } }).sort({ date: -1, _id: -1 }).toArray(),
  ]);
  const candidates = [...rows.map((r) => ({ productId: r.productId, photoId: r.photoId })), ...passports.flatMap((p) =>
    (Array.isArray(p.images) ? p.images as Array<{ kind?: string; photoId?: unknown }> : [])
      .filter((i) => i.kind === 'overview').map((i) => ({ productId: p.productId, photoId: i.photoId })))];
  const loaded = await loadLivePhotos(db, candidates.map((r) => r.photoId));
  const requested = new Set(productIds.map(String));
  for (const r of candidates) {
    const key = String(r.productId), p = loaded.get(String(r.photoId));
    if (requested.has(key) && !covers.has(key) && p) covers.set(key, p);
  }
  return { pictures, covers };
}
