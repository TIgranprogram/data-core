import { Types } from 'mongoose';
import { safeUploadPath } from '../../common/uploads/safe-path';
import { loadPhotos, type Db, type Doc } from './showcase-common';

const photoIds = (value: unknown): Types.ObjectId[] => (Array.isArray(value) ? value : []).flatMap((v) => {
  const id = String(v ?? '');
  return /^[a-f\d]{24}$/i.test(id) ? [new Types.ObjectId(id)] : [];
});
type Photo = Awaited<ReturnType<typeof loadPhotos>> extends Map<string, infer P> ? P : never;

/** Собственные фото → актуальный общий вид изделия → рисунок прежнего паспорта. Только пакетное чтение. */
export async function showcasePhotos(db: Db, docs: Doc[]) {
  const own = await loadPhotos(db, photoIds(docs.flatMap((d) => Array.isArray(d.photoIds) ? d.photoIds : [])));
  const pictures = new Map(docs.map((d) => [String(d._id), photoIds(d.photoIds).map((id) => own.get(String(id))).filter((p): p is Photo => !!p)]));
  const missing = docs.filter((d) => !pictures.get(String(d._id))?.length);
  const covers = new Map<string, Photo>();
  if (!missing.length) return { pictures, covers };
  const [rows, passports] = await Promise.all([
    db.collection('productphotos').find({ productId: { $in: missing.map((d) => d._id) }, deletedAt: null, purpose: 'passport', kind: 'overview' },
      { projection: { productId: 1, photoId: 1 } }).sort({ sortOrder: 1, createdAt: 1, _id: 1 }).toArray(),
    db.collection('productpassports').find({ productId: { $in: missing.map((d) => d._id) }, deletedAt: null, 'images.kind': 'overview' },
      { projection: { productId: 1, images: 1 } }).sort({ date: -1, _id: -1 }).toArray(),
  ]);
  // Все кандидаты нужны: битая ссылка первого рисунка не должна закрыть следующий пригодный общий вид.
  const candidates = [...rows.map((r) => ({ productId: r.productId, photoId: r.photoId })), ...passports.flatMap((p) =>
    (Array.isArray(p.images) ? p.images as Array<{ kind?: string; photoId?: unknown }> : [])
      .filter((i) => i.kind === 'overview').map((i) => ({ productId: p.productId, photoId: i.photoId })))];
  const ids = photoIds([...new Set(candidates.map((r) => String(r.photoId ?? '')))]);
  if (!ids.length) return { pictures, covers };
  const [live, variants] = await Promise.all([
    db.collection('photos').find({ _id: { $in: ids }, deletedAt: null }, { projection: { storageUrl: 1 } }).toArray(),
    db.collection('photos').find({ parentPhotoId: { $in: ids }, deletedAt: null, variant: { $in: ['thumb', 'medium'] } },
      { projection: { storageUrl: 1, parentPhotoId: 1, variant: 1 } }).toArray(),
  ]);
  const thumbs = new Map(variants.filter((p) => p.variant === 'thumb' && safeUploadPath(p.storageUrl)).map((p) => [String(p.parentPhotoId), String(p.storageUrl)]));
  const mediums = new Map(variants.filter((p) => p.variant === 'medium' && safeUploadPath(p.storageUrl)).map((p) => [String(p.parentPhotoId), String(p.storageUrl)]));
  const loaded = new Map<string, Photo>(live.filter((p) => safeUploadPath(p.storageUrl)).map((p) => {
    const id = String(p._id), url = String(p.storageUrl);
    return [id, { id, url, thumb: thumbs.get(id) ?? url, ...(mediums.has(id) ? { medium: mediums.get(id) } : {}) }];
  }));
  for (const r of candidates) {
    const key = String(r.productId), p = loaded.get(String(r.photoId));
    if (!covers.has(key) && p) covers.set(key, p);
  }
  return { pictures, covers };
}
