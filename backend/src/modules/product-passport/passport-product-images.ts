/** Рисунки паспорта из изделия (PRODUCT-FILES, шаг c): productphotos с purpose='passport' по видам (kind). */
export interface ProductImageRow { kind?: string | null; photoId?: unknown; sortOrder?: number | null; caption?: string | null }
export interface PassportImageLike { kind?: string; photoId?: unknown; order?: number; caption?: string; refCode?: string; [k: string]: unknown }

/** Данные для предпросмотра, отдельно от собственных images[], которые клиент может записывать. */
export function presentEffectiveImages(own: PassportImageLike[], effective: PassportImageLike[], urls: Map<string, string>) {
  return effective.map((image) => ({
    ...image,
    url: urls.get(String(image.photoId)) ?? null,
    fromProduct: !own.includes(image),
  }));
}

// safety (форма v1) и safety_zone (v2) — один вид
const norm = (k?: string | null) => (k === 'safety' ? 'safety_zone' : k || 'overview');

/**
 * Рисунки черновика: вид, который есть в изделии, берётся из изделия; остальные виды — из images[] паспорта (как раньше).
 * Чистая функция: порядок внутри вида — по sortOrder изделия.
 */
export function mergeProductImages(rows: ProductImageRow[], own: PassportImageLike[] = []): PassportImageLike[] {
  const live = rows.filter((r) => r.kind && r.photoId);
  const kinds = new Set(live.map((r) => norm(r.kind)));
  const fromProduct = live.map((r, i) => ({ kind: String(r.kind), photoId: r.photoId, order: r.sortOrder ?? i, ...(r.caption ? { caption: String(r.caption) } : {}) }));
  return [...fromProduct, ...own.filter((i) => !kinds.has(norm(i.kind)))];
}
