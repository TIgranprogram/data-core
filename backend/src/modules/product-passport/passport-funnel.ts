import { Types, type mongo } from 'mongoose';
import { loadPhotos } from '../../common/photos';
import { buildFunnel, parseSelection, parseWords, type FunnelFacet, type FunnelProduct, type FunnelValue } from '../../common/passport/funnel';
import { passportCategoryFor, type PpCat } from '../../common/passport/form-values';

const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const LIMIT = 200;

/** Живые признаки и их значения (справочники productFacets / productFacetValues). */
export async function loadFacets(db: mongo.Db): Promise<{ facets: FunnelFacet[]; values: FunnelValue[] }> {
  const rows = await db.collection('dict_values').find({ dict: { $in: ['productFacets', 'productFacetValues'] }, deletedAt: null }).toArray();
  return {
    facets: rows.filter((r) => r.dict === 'productFacets').map((r) => ({ id: String(r._id), code: s(r.code), name: s(r.name), category: s(r.category), order: Number(r.order) || 0, step: r.step === true, multi: r.multi === true, hint: s(r.hint) })),
    values: rows.filter((r) => r.dict === 'productFacetValues').map((r) => ({ id: String(r._id), name: s(r.name), parentId: String(r.parentId ?? ''), order: Number(r.order) || 0, words: parseWords(r.words) })),
  };
}

/**
 * GET /passports/funnel (шаги воронки): все живые изделия читаются одним запросом (поля — минимум), срезы считаются в памяти —
 * ни запроса на шаг, ни N+1. Категория изделия: своя (passportDefaults) → группы → раздела (как в карточке изделия).
 */
export async function productFunnel(db: mongo.Db, q: Record<string, unknown>) {
  const [prods, cats, ppCats, fv] = await Promise.all([
    db.collection('products').find({ deletedAt: null }, { projection: { sku: 1, name: 1, categoryId: 1, 'passportDefaults.passportCategory': 1, facetValueIds: 1, photoIds: 1, mainPhotoId: 1 } }).toArray(),
    db.collection('categories').find({ type: 'product', deletedAt: null }, { projection: { name: 1, parentId: 1, passportCategory: 1 } }).toArray(),
    db.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }, { projection: { code: 1, name: 1, catalogNames: 1 } }).toArray() as unknown as Promise<PpCat[]>,
    loadFacets(db),
  ]);
  const cat = new Map(cats.map((c) => [String(c._id), c]));
  const products: FunnelProduct[] = prods.map((p) => {
    const c = p.categoryId ? cat.get(String(p.categoryId)) : undefined;
    const par = c?.parentId ? cat.get(String(c.parentId)) : undefined;
    const group = par ? s(c!.name) : null; // категория без родителя — сам раздел (группа не выбрана)
    const type = c ? (par ? s(par.name) : s(c.name)) : null;
    const own = s((p.passportDefaults as { passportCategory?: string } | undefined)?.passportCategory);
    const inh = passportCategoryFor({ group, type }, ppCats, { group: par ? s(c!.passportCategory) : '', type: c ? s((par ?? c).passportCategory) : '' });
    const photo = p.mainPhotoId ?? ((p.photoIds as unknown[]) ?? [])[0];
    return { id: String(p._id), sku: s(p.sku), name: s(p.name ?? p.sku), cat: own || inh?.code || null, groupId: par ? String(c!._id) : null, group, valueIds: ((p.facetValueIds as unknown[]) ?? []).map(String), photoId: photo ? String(photo) : null };
  });
  const { selected, none } = parseSelection(q.f);
  const noneIds = none.map((x) => fv.facets.find((f) => f.id === x || f.code === x)?.id).filter((x): x is string => !!x);
  const r = buildFunnel({
    products, ...fv, categories: ppCats.map((c) => ({ code: s(c.code), name: s(c.name) })).filter((c) => c.code && c.code !== 'ALL'),
    category: s(q.category) || undefined, group: s(q.group) || undefined, selected, none: noneIds, q: s(q.q),
  });
  // фото и «паспортов: N» — только для показанных изделий (и миниатюры групп), пачками
  const shown = r.matched.slice(0, LIMIT);
  const thumbIds = r.steps.flatMap((st) => st.values.map((v) => v.thumb)).filter((x): x is string => !!x);
  const photoIds = [...new Set([...shown.map((p) => p.photoId), ...thumbIds].filter((x): x is string => !!x && Types.ObjectId.isValid(x)))].map((x) => new Types.ObjectId(x));
  const [photos, counts] = await Promise.all([
    loadPhotos(db, photoIds),
    shown.length ? db.collection('productpassports').aggregate([{ $match: { deletedAt: null, productId: { $in: shown.map((p) => new Types.ObjectId(p.id)) } } }, { $group: { _id: '$productId', n: { $sum: 1 } } }]).toArray() : Promise.resolve([]),
  ]);
  const n = new Map(counts.map((c) => [String(c._id), c.n as number]));
  return {
    category: r.category,
    steps: r.steps.map((st) => ({ ...st, values: st.values.map(({ thumb, ...v }) => { const t = thumb ? photos.get(thumb)?.thumb : undefined; return t ? { ...v, thumb: t } : v; }) })),
    products: {
      items: shown.map((p) => { const ph = p.photoId ? photos.get(p.photoId) : undefined; return { id: p.id, sku: p.sku, name: p.name, photo: ph ? { url: ph.url, thumb: ph.thumb } : null, passportsCount: n.get(p.id) ?? 0, group: p.group, facetValueIds: p.valueIds }; }),
      total: r.total,
    },
  };
}
