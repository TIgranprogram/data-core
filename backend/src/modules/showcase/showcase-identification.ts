import type { Kind, ResolvedKind } from '../../common/passport/kind';
import { passportCategoryFor, resolvePassportCategory, type PpCat, type PpFound } from '../../common/passport/form-values';
import { PASSPORT_CATEGORY_CODES, type PassportDefaults } from './passport-defaults';
import { clean, type Db } from './showcase-common';

type Row = Record<string, unknown>;
export interface IdentificationContext { groups: Map<string, Row>; kinds: Map<string, Kind>; categories: PpCat[] }
export interface IdentificationIssue { key: 'group' | 'kind' | 'passportCategory'; label: string }
export const passportCode = (value: unknown) => clean(value) === 'MAF' ? 'BLG' : clean(value);

/** Один компактный набор метаданных для списка и фильтра; фото/паспорта/состав сюда не попадают. */
export async function loadIdentificationContext(db: Db): Promise<IdentificationContext> {
  const [groups, kinds, categories] = await Promise.all([
    db.collection('categories').find({ type: 'product', deletedAt: null }, { projection: { name: 1, parentId: 1, passportCategory: 1, passportKindId: 1 } }).toArray(),
    db.collection('dict_values').find({ dict: 'passportKinds', deletedAt: null }, { projection: { name: 1, passportCategory: 1, elementIds: 1, purposeLeafId: 1 } }).toArray(),
    db.collection('dict_values').find({ dict: 'passportCategories', deletedAt: null }, { projection: { code: 1, name: 1, catalogNames: 1 } }).toArray(),
  ]);
  return {
    groups: new Map(groups.map(g => [String(g._id), g])),
    kinds: new Map(kinds.map(k => [String(k._id), { id: String(k._id), name: clean(k.name), passportCategory: clean(k.passportCategory), elementIds: ((k.elementIds as unknown[]) ?? []).map(String), purposeLeafId: clean(k.purposeLeafId) }])),
    categories: categories.map(c => ({ code: clean(c.code), name: clean(c.name), catalogNames: clean(c.catalogNames) })),
  };
}

/** Те же приоритеты, что resolveKinds: живой свой вид → вид непосредственной группы с родителем. */
export function identifyProduct(row: Row, context: IdentificationContext) {
  const defaults = (row.passportDefaults ?? {}) as PassportDefaults;
  const group = context.groups.get(String(row.categoryId ?? ''));
  const parent = group?.parentId ? context.groups.get(String(group.parentId)) : undefined;
  const groupName = group?.parentId ? clean(group.name) : null;
  const typeName = group ? group.parentId ? parent ? clean(parent.name) : null : clean(group.name) : null;
  const ownKind = context.kinds.get(clean(defaults.kindId));
  const groupKind = group?.parentId ? context.kinds.get(String(group.passportKindId ?? '')) : undefined;
  const kind: ResolvedKind = { kind: ownKind ?? groupKind ?? null, source: ownKind ? 'own' : groupKind ? 'group' : null, groupName: groupName ?? '' };
  const inherited = passportCategoryFor({ group: groupName, type: typeName }, context.categories, {
    group: group?.parentId ? clean(group.passportCategory) : '', type: clean(group?.parentId ? parent?.passportCategory : group?.passportCategory),
  });
  const code = kind.kind?.passportCategory;
  const byKind: PpFound | null = code ? { code, name: context.categories.find(c => c.code === code)?.name || code, via: `вид «${kind.kind!.name}»`, source: 'kind' } : null;
  const passport = resolvePassportCategory(defaults.passportCategory, byKind ?? inherited, context.categories);
  const supported = (PASSPORT_CATEGORY_CODES as readonly string[]).includes(passportCode(passport.effective?.code));
  const issues: IdentificationIssue[] = [];
  if (!group?.parentId || !parent) issues.push({ key: 'group', label: 'Не выбрана доступная группа каталога' });
  if (!kind.kind) issues.push({ key: 'kind', label: 'Не выбран действующий вид изделия' });
  if (!supported) issues.push({ key: 'passportCategory', label: 'Не определён действующий тип паспорта' });
  return { group, parent, groupName, typeName, kind, passport, issues };
}
