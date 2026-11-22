import { Types, type Connection } from 'mongoose';
import sharp from 'sharp';
import { safeUploadPath } from '../../common/uploads/safe-path';

type Db = NonNullable<Connection['db']>;
type Row = { productId?: unknown; photoUrl?: string };

function ids(values: unknown[]): Types.ObjectId[] {
  const keys = [...new Set(values.map(String).filter((s) => /^[a-f\d]{24}$/i.test(s)))];
  return keys.map((s) => new Types.ObjectId(s));
}

/** Одни и те же читаемые JPEG для печати и проверки. Снимок строки → фото изделия → старая витрина. */
export async function offerPhotos(db: Db, rows: Row[]): Promise<(Buffer | null)[]> {
  const cache = new Map<string, Buffer | null>();
  async function first(urls: unknown[]) {
    for (const url of urls) {
      const path = safeUploadPath(url);
      if (!path) continue;
      if (!cache.has(path)) {
        try {
          cache.set(path, await sharp(path).flatten({ background: '#ffffff' }).resize(240, 240, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer());
        } catch { cache.set(path, null); }
      }
      const image = cache.get(path);
      if (image) return image;
    }
    return null;
  }

  const out: (Buffer | null)[] = [];
  for (const row of rows) out.push(await first([row.photoUrl]));
  const missing = () => ids(rows.filter((_, i) => !out[i]).map((row) => row.productId));
  const wanted = missing();
  if (!wanted.length) return out;

  const products = await db.collection('products').find({ _id: { $in: wanted }, deletedAt: null },
    { projection: { mainPhotoId: 1, photoIds: 1 } }).toArray();
  const byProduct = new Map(products.map((p) => [String(p._id), ids([p.mainPhotoId, ...(Array.isArray(p.photoIds) ? p.photoIds : [])])]));
  const wantedPhotos = ids([...byProduct.values()].flat());
  if (wantedPhotos.length) {
    const live = await db.collection('photos').find({ _id: { $in: wantedPhotos }, deletedAt: null },
      { projection: { storageUrl: 1 } }).toArray();
    const variants = live.length ? await db.collection('photos').find({ parentPhotoId: { $in: live.map((p) => p._id) },
      deletedAt: null, variant: { $in: ['medium', 'thumb'] } }, { projection: { parentPhotoId: 1, variant: 1, storageUrl: 1 } }).sort({ variant: 1, _id: 1 }).toArray() : [];
    const files = new Map(live.map((p) => [String(p._id), [p.storageUrl]]));
    for (const p of variants) files.get(String(p.parentPhotoId))?.push(p.storageUrl);
    for (const [i, row] of rows.entries()) {
      if (!out[i]) out[i] = await first((byProduct.get(String(row.productId)) || []).flatMap((id) => files.get(String(id)) || []));
    }
  }

  const legacyIds = missing();
  if (legacyIds.length) {
    const old = await db.collection('showcaseitems').find({ _id: { $in: legacyIds }, deletedAt: null },
      { projection: { 'photo.thumb': 1, 'photo.url': 1 } }).toArray();
    const files = new Map(old.map((p) => [String(p._id), [p.photo?.thumb, p.photo?.url]]));
    for (const [i, row] of rows.entries()) {
      if (!out[i]) out[i] = await first(files.get(String(row.productId)) || []);
    }
  }
  return out;
}
