import { Types, type mongo } from 'mongoose';

/** Элементы из `elementIds` выбранных значений признаков (порядок — как у значений, без дублей). */
export function elementsOfFacetValues(values: Array<Record<string, unknown>>): Types.ObjectId[] {
  const seen = new Set<string>();
  const out: Types.ObjectId[] = [];
  for (const v of values) {
    for (const x of (Array.isArray(v.elementIds) ? v.elementIds : [])) {
      const k = String(x);
      if (!Types.ObjectId.isValid(k) || seen.has(k)) continue;
      seen.add(k); out.push(new Types.ObjectId(k));
    }
  }
  return out;
}

/** Умолчания изделия «элементы» + элементы признаков: ручные остаются на месте, новые дописываются без дублей. Нечего дописывать — null. */
export function mergeFacetElements(cur: unknown, fromFacets: Types.ObjectId[]): Types.ObjectId[] | null {
  const have = ((Array.isArray(cur) ? cur : []) as unknown[]).map(String);
  const add = fromFacets.filter((x) => !have.includes(String(x)));
  if (!add.length) return null;
  return [...((Array.isArray(cur) ? cur : []) as Types.ObjectId[]), ...add];
}

/** Что дописать в `passportDefaults.elements` изделия при записи признаков; null — менять нечего. */
export async function facetElementsPatch(db: mongo.Db, productId: Types.ObjectId, facetValueIds: Types.ObjectId[]): Promise<Types.ObjectId[] | null> {
  if (!facetValueIds.length) return null;
  const values = await db.collection('dict_values').find({ dict: 'productFacetValues', deletedAt: null, _id: { $in: facetValueIds } }, { projection: { elementIds: 1 } }).toArray();
  const add = elementsOfFacetValues(values);
  if (!add.length) return null;
  const prod = await db.collection('products').findOne({ _id: productId }, { projection: { passportDefaults: 1 } });
  return mergeFacetElements((prod?.passportDefaults as { elements?: unknown } | undefined)?.elements, add);
}
