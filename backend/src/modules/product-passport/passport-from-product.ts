import type { mongo } from 'mongoose';
import { Types } from 'mongoose';
import { inheritedPassportCategory } from '../../common/passport/passport-inherit';
import type { Doc } from './passport-consts';

/**
 * Паспорт с изделием (productId): общие поля берутся из изделия (`products`), у паспорта они только для чтения.
 * Касается черновиков; выданный паспорт хранит копию на момент выпуска и не меняется.
 * Поля, которых у изделия нет (пусто), остаются как в паспорте. Только паспортные поля: seatWidth, supports, cert*, bom, данные заказа — не трогаем.
 */
const NUM_KEYS = ['ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears', 'warrantyMonths'] as const;
const DEFAULT_KEYS = ['elements', 'materialIds', 'installationTypeId', 'isKit', 'textChoices', ...NUM_KEYS] as const;

const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !(v instanceof Types.ObjectId) && !Object.keys(v as object).length);
const pos = (v: unknown) => (Number(v) > 0 ? Number(v) : undefined);

/** Категория паспорта изделия: своя (passportDefaults) главнее унаследованной от группы / раздела. */
export async function productPassportCode(db: mongo.Db, prod: Doc): Promise<string | null> {
  const own = (prod.passportDefaults as { passportCategory?: string } | undefined)?.passportCategory;
  const ownCode = String(own ?? '').trim();
  if (ownCode) return ownCode;
  return (await inheritedPassportCategory(db, prod.categoryId as Types.ObjectId | undefined))?.code ?? null;
}

/** Поля паспорта, которые задаёт изделие: { поле паспорта: значение }. Пустые у изделия — не попадают. */
export async function productPatch(db: mongo.Db, prod: Doc): Promise<Doc> {
  const out: Doc = {};
  const put = (k: string, v: unknown) => { if (filled(v)) out[k] = v; };
  put('name', String(prod.name ?? '').trim());
  put('article', String(prod.sku ?? '').trim());
  const dm = (prod.dimensions ?? {}) as Doc;
  for (const k of ['length', 'width', 'height']) put(k, pos(dm[k]));
  put('weight', pos(prod.weightKg));
  put('purpose', String(prod.purpose ?? '').trim());
  put('installationMethod', String(prod.installation ?? '').trim());
  put('description', String(prod.description ?? '').trim());
  put('materialsSpec', prod.materialsSpec);
  const pd = (prod.passportDefaults ?? {}) as Doc;
  for (const k of DEFAULT_KEYS) put(k, pd[k]);
  put('passportCategory', await productPassportCode(db, prod));
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Что изменится в паспорте, если взять поля из изделия (только отличающиеся); вручную набранные purpose / installationMethod не трогаем. */
export function diffPatch(cur: Doc, patch: Doc): Doc {
  const manual = (cur.manualText as string[] | undefined) ?? [];
  const out: Doc = {};
  for (const [k, v] of Object.entries(patch)) {
    if ((k === 'purpose' || k === 'installationMethod') && manual.includes(k)) continue;
    if (!same(cur[k], v)) out[k] = v;
  }
  return out;
}

/** Черновик с изделием берёт поля у изделия; остальные паспорта — нет. */
export const followsProduct = (d: Doc) => d.status === 'draft' && !!d.productId;

/** Категории паспорта изделий пачкой: id изделия → код (или null). */
export async function productCategories(db: mongo.Db, ids: Array<Types.ObjectId | string>): Promise<Map<string, string | null>> {
  const oids = [...new Set(ids.map(String))].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
  const out = new Map<string, string | null>();
  if (!oids.length) return out;
  const prods = await db.collection('products').find({ _id: { $in: oids } }, { projection: { categoryId: 1, passportDefaults: 1 } }).toArray();
  for (const p of prods) out.set(String(p._id), await productPassportCode(db, p as Doc));
  return out;
}
