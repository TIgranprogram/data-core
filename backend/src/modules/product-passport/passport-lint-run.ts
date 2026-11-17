import type { mongo } from 'mongoose';
import { Types } from 'mongoose';
import { lintPassportText, type LintFinding, type LintText } from './passport-lint';
import type { Doc } from './passport-consts';

/** Названия записей справочника по id (для карточки проверки). */
async function names(db: mongo.Db, dict: string, ids: unknown): Promise<string[]> {
  const list = (Array.isArray(ids) ? ids : []).filter((x) => Types.ObjectId.isValid(String(x))).map((x) => new Types.ObjectId(String(x)));
  if (!list.length) return [];
  const rows = await db.collection('dict_values').find({ dict, _id: { $in: list } }, { projection: { name: 1 } }).toArray();
  return rows.map((r) => String(r.name ?? '')).filter(Boolean);
}

/** Проверка текста сохранённого паспорта: снимок (или переданный текст) + карточка из справочников. Только чтение. */
export async function lintDoc(db: mongo.Db, doc: Doc, text?: LintText | null): Promise<LintFinding[]> {
  const snap = (text ?? doc.textSnapshot) as LintText | undefined;
  if (!snap?.sections?.length) return [];
  const spec = (doc.materialsSpec ?? {}) as { coatingIds?: unknown[]; coatingTexts?: unknown[] };
  const [elementNames, coatings] = await Promise.all([names(db, 'passportElements', doc.elements), names(db, 'passportMaterials', spec.coatingIds)]);
  const kinds = ((doc.images as Array<{ kind?: unknown }>) || []).map((i) => String(i.kind ?? ''));
  return lintPassportText(snap, {
    name: String(doc.name ?? ''),
    joints: ((doc.joints as unknown[]) || []).map(String),
    coatingText: [...coatings, ...((spec.coatingTexts as unknown[]) || []).map(String)].join(', ') || undefined,
    elementNames: elementNames.length ? elementNames : undefined,
    imageKinds: kinds.length ? kinds : undefined,
  });
}
