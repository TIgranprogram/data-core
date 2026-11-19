import type { mongo } from 'mongoose';
import { Types } from 'mongoose';
import { expandComposition, type GraphDb } from '../../common/catalog/composition-expand';
import { kindPatch, resolveKind, resolveKinds, type ResolvedKind } from '../../common/passport/kind';
import { inheritedPassportCategory } from '../../common/passport/passport-inherit';
import type { Doc } from './passport-consts';

/**
 * Паспорт с изделием (productId): общие поля берутся из изделия (`products`), у паспорта они только для чтения.
 * Касается черновиков; выданный паспорт хранит копию на момент выпуска и не меняется.
 * Поля, которых у изделия нет (пусто), остаются как в паспорте. Только паспортные поля: seatWidth, supports, cert*, bom, данные заказа — не трогаем.
 */
const NUM_KEYS = ['ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears', 'warrantyMonths', 'foundationDepth'] as const;
const DEFAULT_KEYS = ['elements', 'materialIds', 'installationTypeId', 'isKit', 'textChoices', 'textOverrides', 'joints', 'modules', 'manualText', ...NUM_KEYS] as const; // modules — C095; manualText — C132 («в справочнике» для описания/назначения/монтажа изделия)

const filled = (v: unknown) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !(v instanceof Types.ObjectId) && !Object.keys(v as object).length);
const pos = (v: unknown) => (Number(v) > 0 ? Number(v) : undefined);

/** Тип паспорта изделия: своя (passportDefaults) → вида изделия (C100) → унаследованная от группы / раздела. */
export async function productPassportCode(db: mongo.Db, prod: Doc, resolved?: ResolvedKind): Promise<string | null> {
  const own = (prod.passportDefaults as { passportCategory?: string } | undefined)?.passportCategory;
  const ownCode = String(own ?? '').trim();
  if (ownCode) return ownCode;
  const byKind = ((resolved ?? await resolveKind(db, prod)).kind?.passportCategory ?? '').trim();
  if (byKind) return byKind;
  return (await inheritedPassportCategory(db, prod.categoryId as Types.ObjectId | undefined))?.code ?? null;
}

/** Поля паспорта, которые задаёт изделие: { поле паспорта: значение }. Пустые у изделия — не попадают. */
export async function productPatch(db: mongo.Db, prod: Doc, opts: { presentation?: boolean; brief?: boolean } = {}): Promise<Doc> {
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
  put('materials', typeof prod.materialsText === 'string' ? prod.materialsText.trim() : undefined);
  const pd = (prod.passportDefaults ?? {}) as Doc;
  for (const k of DEFAULT_KEYS) put(k, pd[k]);
  if (opts.presentation) {
    put('seatsCount', pd.seatsCount);
    put('simpleDescription', pd.simpleDescription);
    const manual = new Set((out.manualText as string[] | undefined) ?? []);
    for (const [key, field] of [['manualDescription', 'description'], ['manualPurpose', 'purpose'], ['manualInstall', 'installationMethod']]) {
      if (!filled(pd[key])) continue;
      out[field] = pd[key];
      manual.add(field);
    }
    if (manual.size) out.manualText = [...manual];
  }
  // C100: чего у изделия нет своего — берём из вида изделия (элементы, назначение); своё главнее
  const rk = await resolveKind(db, prod);
  if (opts.presentation) put('kindId', rk.kind?.id);
  for (const [k, v] of Object.entries(await kindPatch(db, prod, rk))) put(k, v);
  const category = await productPassportCode(db, prod, rk);
  put('passportCategory', opts.presentation && category === 'MAF' ? 'BLG' : category);
  // C142: черновик читает дерево состава. Пусто — null (у паспорта без поля отличия нет). Выпущенный сюда не заходит.
  if (!opts.brief && (Array.isArray(prod.composition) || Array.isArray(prod.productModuleIds))) {
    const { sheet } = await expandComposition(db as unknown as GraphDb, prod);
    out.compositionSheet = sheet.length ? sheet : null;
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export const INSTANCE_TEXT_FIELDS = ['name', 'purpose', 'installationMethod', 'description'] as const;

/** Только собственные правки экземпляра удерживают поле при чтении из шаблона. */
export function instanceManualText(doc: Doc): string[] {
  const flags = doc.manualText as string[] | undefined;
  return doc.presentationVersion === 1
    ? (doc.instanceManualText as string[] | undefined) ?? (flags?.includes('name') ? ['name'] : [])
    : flags ?? [];
}

/** Что изменится в паспорте из изделия; имя и тексты экземпляра с явным manualText сохраняются. */
export function diffPatch(cur: Doc, patch: Doc): Doc {
  const manual = instanceManualText(cur);
  const presentation = cur.presentationVersion === 1;
  const out: Doc = {};
  for (const [k, value] of Object.entries(patch)) {
    if (presentation && manual.includes(k) && (INSTANCE_TEXT_FIELDS as readonly string[]).includes(k)) continue;
    if (presentation && k === 'manualText') {
      const flags = [...new Set([...(Array.isArray(value) ? value : []), ...manual])];
      if (!same(cur[k], flags)) out[k] = flags;
      continue;
    }
    if ((k === 'name' || k === 'purpose' || k === 'installationMethod') && manual.includes(k)) continue;
    // Умолчания изделия не снимают явно выбранное ручное имя экземпляра при следующем чтении.
    const v = k === 'manualText' && manual.includes('name') ? [...new Set([...(Array.isArray(value) ? value : []), 'name'])] : value;
    if (!same(cur[k], v)) out[k] = v;
  }
  return out;
}

/** Черновик с изделием берёт поля у изделия; остальные паспорта — нет. */
export const followsProduct = (d: Doc) => d.status === 'draft' && !!d.productId;

/** Типы паспорта изделий пачкой: id изделия → код (или null). */
export async function productCategories(db: mongo.Db, ids: Array<Types.ObjectId | string>): Promise<Map<string, string | null>> {
  const oids = [...new Set(ids.map(String))].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));
  const out = new Map<string, string | null>();
  if (!oids.length) return out;
  const prods = await db.collection('products').find({ _id: { $in: oids } }, { projection: { categoryId: 1, passportDefaults: 1 } }).toArray();
  const kinds = await resolveKinds(db, prods);
  for (const p of prods) out.set(String(p._id), await productPassportCode(db, p as Doc, kinds.get(String(p._id))));
  return out;
}
