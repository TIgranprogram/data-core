import { Types } from 'mongoose';
import { normSearch, searchTokens, tokensFilter } from '../../common/text/search-norm';
import { loadPhotos, LIVE, type Db, type Doc } from './showcase-common';

export type SimilarProduct = { id: string; name: string; sku: string; photo: { url: string; thumb: string } | null; groupName: string | null };

/** Слова названия для сравнения: без коротких (< 2 знаков) и «(копия)»; не больше 4 — длинный хвост не нужен. */
export const similarTokens = (name: unknown): string[] =>
  searchTokens(name).filter((t) => t.length >= 2 && t !== 'копия').slice(0, 4);

/** Порядок: полное совпадение названия → начинается с запроса → остальные (по названию). */
export function rankSimilar<T extends { name: string }>(rows: T[], name: string): T[] {
  const q = normSearch(name);
  const rank = (n: string) => { const k = normSearch(n); return k === q ? 0 : k.startsWith(q) ? 1 : 2; };
  return [...rows].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'ru'));
}

/** «Похожее уже есть»: до 5 живых изделий, где есть все слова названия (регистр, ё/е, знаки не важны). */
export async function findSimilar(db: Db, name: string, excludeId?: Types.ObjectId): Promise<SimilarProduct[]> {
  const tokens = similarTokens(name);
  if (!tokens.length) return [];
  const f = tokensFilter(tokens.join(' '), ['name'])!;
  const rows = await db.collection('products').find({ ...LIVE, ...f, ...(excludeId ? { _id: { $ne: excludeId } } : {}) },
    { projection: { name: 1, sku: 1, categoryId: 1, mainPhotoId: 1, photoIds: 1 } }).limit(30).toArray();
  const top = rankSimilar(rows.map((r) => ({ ...r, name: String(r.name ?? '') }) as Doc & { name: string }), name).slice(0, 5);
  const photoIds = top.map((r) => (r.mainPhotoId ?? (r.photoIds as Types.ObjectId[] | undefined)?.[0]) as Types.ObjectId | undefined).filter((x): x is Types.ObjectId => !!x);
  const catIds = top.map((r) => r.categoryId as Types.ObjectId | undefined).filter((x): x is Types.ObjectId => !!x);
  const [photos, cats] = await Promise.all([
    loadPhotos(db, photoIds),
    catIds.length ? db.collection('categories').find({ _id: { $in: catIds } }, { projection: { name: 1 } }).toArray() : Promise.resolve([]),
  ]);
  const catName = new Map(cats.map((c) => [String(c._id), String(c.name)]));
  return top.map((r) => {
    const pid = r.mainPhotoId ?? (r.photoIds as Types.ObjectId[] | undefined)?.[0];
    const p = pid ? photos.get(String(pid)) : undefined;
    return { id: String(r._id), name: r.name, sku: String(r.sku ?? ''), photo: p ? { url: p.url, thumb: p.thumb } : null, groupName: r.categoryId ? catName.get(String(r.categoryId)) ?? null : null };
  });
}
