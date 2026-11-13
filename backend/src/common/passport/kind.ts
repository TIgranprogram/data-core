import { Types, type mongo } from 'mongoose';

/**
 * «Вид изделия» паспорта (C100): справочник `dict_values` `dict: 'passportKinds'`. Вид полностью определяет, что это за изделие
 * (элементы), назначение и категорию паспорта — без угадывания по названию.
 * Источник вида: `products.passportDefaults.kindId` (своё) → `categories.passportKindId` группы изделия. Нет ни того, ни другого —
 * вида нет, менеджер отвечает на один вопрос «Вид изделия».
 */
export const KINDS_DICT = 'passportKinds';

export interface Kind { id: string; name: string; passportCategory: string; elementIds: string[]; purposeLeafId: string }
export interface ResolvedKind { kind: Kind | null; source: 'own' | 'group' | null; groupName: string }

const s = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();
const oid = (v: unknown) => (v && Types.ObjectId.isValid(String(v)) && String(v).length === 24 ? new Types.ObjectId(String(v)) : null);
const NONE: ResolvedKind = { kind: null, source: null, groupName: '' };

type Doc = Record<string, unknown>;

function toKind(d: Doc): Kind {
  return {
    id: String(d._id), name: s(d.name), passportCategory: s(d.passportCategory),
    elementIds: ((d.elementIds as unknown[]) ?? []).map(String), purposeLeafId: d.purposeLeafId ? String(d.purposeLeafId) : '',
  };
}

/**
 * Вид изделий пачкой: id изделия → результат. Два чтения на всех (группы, виды), без запроса на изделие.
 * Удалённый вид (или ссылка в никуда) = вида нет; битое своё значение уступает виду группы.
 * `loaded` — группы, уже прочитанные вызывающим (id → { name, parentId, passportKindId }): категории заново не читаются.
 */
export async function resolveKinds(db: mongo.Db, prods: Doc[], loaded?: Map<string, Doc>): Promise<Map<string, ResolvedKind>> {
  const out = new Map<string, ResolvedKind>();
  if (!prods.length) return out;
  const catIds = [...new Set(prods.map((p) => String(p.categoryId ?? '')).filter(Boolean))].map(oid).filter((x): x is Types.ObjectId => !!x);
  const groups = loaded ?? new Map<string, Doc>();
  if (!loaded && catIds.length) for (const c of await db.collection('categories').find({ _id: { $in: catIds }, deletedAt: null }, { projection: { name: 1, parentId: 1, passportKindId: 1 } }).toArray()) groups.set(String(c._id), c);
  const ownId = (p: Doc) => s((p.passportDefaults as { kindId?: unknown } | undefined)?.kindId);
  const wanted = new Set<string>();
  for (const p of prods) {
    if (ownId(p)) wanted.add(ownId(p));
    const g = groups.get(String(p.categoryId ?? ''));
    if (g?.passportKindId) wanted.add(String(g.passportKindId));
  }
  const ids = [...wanted].map(oid).filter((x): x is Types.ObjectId => !!x);
  const kinds = new Map<string, Kind>();
  if (ids.length) for (const d of await db.collection('dict_values').find({ dict: KINDS_DICT, deletedAt: null, _id: { $in: ids } }).toArray()) kinds.set(String(d._id), toKind(d));
  for (const p of prods) {
    const g = groups.get(String(p.categoryId ?? ''));
    const groupName = g?.parentId ? s(g.name) : ''; // раздел без родителя — не группа
    const own = kinds.get(ownId(p));
    if (own) { out.set(String(p._id), { kind: own, source: 'own', groupName }); continue; }
    const byGroup = g?.parentId ? kinds.get(String(g.passportKindId ?? '')) : undefined;
    out.set(String(p._id), byGroup ? { kind: byGroup, source: 'group', groupName } : { ...NONE, groupName });
  }
  return out;
}

/** Вид одного изделия (`categoryId`, `passportDefaults.kindId` — из документа изделия). */
export async function resolveKind(db: mongo.Db, prod: Doc): Promise<ResolvedKind> {
  const key = prod._id ?? '_';
  return (await resolveKinds(db, [{ ...prod, _id: key }])).get(String(key)) ?? NONE;
}

/** Корень раздела «Назначение» воронки текстов (`passportPhrases`): без родителя и без текста. */
export async function purposeRootId(db: mongo.Db): Promise<string | null> {
  const roots = await db.collection('dict_values').find({ dict: 'passportPhrases', deletedAt: null, section: 'purpose', parentId: null }, { projection: { text: 1 } }).toArray();
  const root = roots.find((r) => !s(r.text));
  return root ? String(root._id) : null;
}

/**
 * Что вид изделия добавляет в паспорт сверх своего у изделия: элементы (если у изделия их нет) и выбор «Назначения»
 * (если у изделия нет своего). Удалённый лист назначения не подставляется — вопрос «выберите заново» задаёт `productGaps`.
 */
export async function kindPatch(db: mongo.Db, prod: Doc, rk: ResolvedKind): Promise<{ elements?: Types.ObjectId[]; textChoices?: Record<string, string> }> {
  const kind = rk.kind;
  if (!kind) return {};
  const pd = (prod.passportDefaults ?? {}) as { elements?: unknown[]; textChoices?: Record<string, string> };
  const out: { elements?: Types.ObjectId[]; textChoices?: Record<string, string> } = {};
  if (!(pd.elements ?? []).length && kind.elementIds.length) out.elements = kind.elementIds.map(oid).filter((x): x is Types.ObjectId => !!x);
  const leaf = oid(kind.purposeLeafId);
  if (leaf) {
    const root = await purposeRootId(db);
    if (root && !s(pd.textChoices?.[root]) && await db.collection('dict_values').findOne({ _id: leaf, dict: 'passportPhrases', deletedAt: null, parentId: new Types.ObjectId(root) }, { projection: { _id: 1 } })) {
      out.textChoices = { ...(pd.textChoices ?? {}), [root]: String(leaf) };
    }
  }
  return out;
}
