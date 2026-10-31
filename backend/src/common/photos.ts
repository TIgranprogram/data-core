import { Types, type Connection } from 'mongoose';

type Db = NonNullable<Connection['db']>;

type LineLike = { _id: unknown; photoIds?: unknown; productId?: unknown };
export type LinePhoto = { url: string; thumb: string } | null;

/** Источник фото строки: своё (photoIds[0]) → главное фото изделия → null. prodFirst: id изделия → его первое фото. */
export function linePhotoId(line: Pick<LineLike, 'photoIds' | 'productId'>, prodFirst: Map<string, unknown>): string | null {
  const own = ((line.photoIds as unknown[] | undefined) ?? [])[0];
  const id = own ?? (line.productId ? prodFirst.get(String(line.productId)) : undefined);
  return id ? String(id) : null;
}

/** Фото строк позиций пачкой (изделия и фото — по одному запросу на весь набор): id строки → {url, thumb} | null. */
export async function loadLinePhotos(db: Db, lines: LineLike[]): Promise<Map<string, LinePhoto>> {
  const needProd = [...new Set(lines.filter((l) => !((l.photoIds as unknown[] | undefined) ?? [])[0] && l.productId).map((l) => String(l.productId)))];
  const prodFirst = new Map<string, unknown>();
  if (needProd.length) {
    const prods = await db.collection('products').find({ _id: { $in: needProd.map((s) => new Types.ObjectId(s)) } }, { projection: { photoIds: 1 } }).toArray();
    for (const p of prods) { const f = ((p.photoIds as unknown[] | undefined) ?? [])[0]; if (f) prodFirst.set(String(p._id), f); }
  }
  const ids = lines.map((l) => linePhotoId(l, prodFirst));
  const photos = await loadPhotos(db, [...new Set(ids.filter(Boolean) as string[])].map((s) => new Types.ObjectId(s)));
  return new Map(lines.map((l, i) => { const p = ids[i] ? photos.get(ids[i]!) : undefined; return [String(l._id), p ? { url: p.url, thumb: p.thumb } : null]; }));
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
