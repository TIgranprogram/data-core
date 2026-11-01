import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';

/**
 * Склады-зоны (WAREHOUSE-ZONES): пользователь видит и меняет только позиции своих складов.
 * Склад (`stockzones`) = категории (с потомками) + поштучные добавки − поштучные исключения; «Основной» (isDefault)
 * ещё и позиции без категории. Доступ роли = объединение выбранных складов (`roles.warehouseIds`);
 * запасной путь — старые `roles.stockCategoryIds`. Пусто — весь склад. Владелец и admin — всегда весь склад.
 * Кэш в памяти (роли — RoleService, склады и дерево категорий — StockZonesService): запрос не ходит в базу за правами.
 * Единый вход: `stockScopeFor` → `inScope` (в памяти) / `scopeMatch` (запрос к materials) / `@StockScoped()` в контроллере.
 */
export interface ZoneDef {
  id: string;
  name?: string;
  categoryIds: readonly string[];
  includeIds?: readonly string[];
  excludeIds?: readonly string[];
  isDefault?: boolean;
}

/** Один склад с раскрытыми подкатегориями. */
export interface ZoneClause {
  id: string;
  categoryIds: ReadonlySet<string>;
  includeIds: ReadonlySet<string>;
  excludeIds: ReadonlySet<string>;
  noCategory: boolean;
}

export interface StockScope {
  zones: readonly ZoneClause[];
  /** Объединение категорий всех складов (с потомками). */
  categoryIds: readonly string[];
  /** Видны позиции без категории (есть склад isDefault). */
  noCategory: boolean;
}

export interface RoleStockSource { warehouseIds?: readonly string[] | null; stockCategoryIds?: readonly string[] | null }

const zoneDefs = new Map<string, ZoneDef>();
let parents = new Map<string, string | null>();
const roles = new Map<string, RoleStockSource>();
const memo = new Map<string, StockScope | null>();

/** Склады: заменить кэш целиком (после правки справочника). */
export function setStockZones(list: readonly ZoneDef[]): void {
  zoneDefs.clear();
  for (const z of list) zoneDefs.set(z.id, z);
  memo.clear();
}

/** Дерево категорий (id → родитель) для раскрытия подкатегорий. */
export function setCategoryTree(rows: ReadonlyArray<{ id: string; parentId?: string | null }>): void {
  parents = new Map(rows.map((r) => [r.id, r.parentId ? String(r.parentId) : null]));
  memo.clear();
}

export function setRoleStockScope(name: string, src: RoleStockSource | null | undefined): void {
  if (!name) return;
  if ((src?.warehouseIds?.length || src?.stockCategoryIds?.length) && name !== 'admin') roles.set(name, { warehouseIds: src.warehouseIds?.map(String), stockCategoryIds: src.stockCategoryIds?.map(String) });
  else roles.delete(name);
  memo.delete(name);
}

export function setRoleStockScopeAll(list: Array<{ name: string } & RoleStockSource>): void {
  roles.clear();
  memo.clear();
  for (const r of list) setRoleStockScope(r.name, r);
}

/** Категории и все их потомки. */
export function withDescendants(ids: readonly string[]): Set<string> {
  const out = new Set(ids.map(String));
  if (!out.size) return out;
  let grew = true;
  while (grew) {
    grew = false;
    for (const [id, parent] of parents) if (!out.has(id) && parent && out.has(parent)) { out.add(id); grew = true; }
  }
  return out;
}

function clause(z: ZoneDef): ZoneClause {
  return { id: z.id, categoryIds: withDescendants(z.categoryIds), includeIds: new Set((z.includeIds ?? []).map(String)), excludeIds: new Set((z.excludeIds ?? []).map(String)), noCategory: z.isDefault === true };
}

/** Доступ по списку складов (без роли): нужен и для `GET /stock/zones`, и для проверки. */
export function scopeOfZones(list: readonly ZoneDef[]): StockScope {
  const zones = list.map(clause);
  return { zones, categoryIds: [...new Set(zones.flatMap((z) => [...z.categoryIds]))], noCategory: zones.some((z) => z.noCategory) };
}

function build(src: RoleStockSource): StockScope {
  if (src.warehouseIds?.length) return scopeOfZones(src.warehouseIds.map((id) => zoneDefs.get(id)).filter((z): z is ZoneDef => !!z));
  return scopeOfZones([{ id: 'legacy', categoryIds: src.stockCategoryIds ?? [] }]);
}

/** Склады, доступные роли (для переключателя склада): `null` — все. */
export function zonesFor(user: { role?: string | null; isOwner?: boolean } | null | undefined): ZoneDef[] | null {
  if (!user || user.isOwner === true || !user.role || user.role === 'admin') return null;
  const src = roles.get(user.role);
  if (!src) return null;
  if (!src.warehouseIds?.length) return [];
  return src.warehouseIds.map((id) => zoneDefs.get(id)).filter((z): z is ZoneDef => !!z);
}

/** Доступ пользователя: `null` — весь склад. */
export function stockScopeFor(user: { role?: string | null; isOwner?: boolean } | null | undefined): StockScope | null {
  if (!user || user.isOwner === true || !user.role || user.role === 'admin') return null;
  const src = roles.get(user.role);
  if (!src) return null;
  if (!memo.has(user.role)) memo.set(user.role, build(src));
  return memo.get(user.role) ?? null;
}

/** Позиция (материал) входит в доступ? `null` — да. Для проверок в памяти и записи. */
export function inScope(scope: StockScope | null | undefined, m: { id?: unknown; _id?: unknown; materialId?: unknown; categoryId?: unknown }): boolean {
  if (!scope) return true;
  const id = String(m.id ?? m._id ?? m.materialId ?? '');
  const cat = m.categoryId ? String(m.categoryId) : '';
  return scope.zones.some((z) => !z.excludeIds.has(id) && (z.includeIds.has(id) || (cat ? z.categoryIds.has(cat) : z.noCategory)));
}

const both = (ids: Iterable<string>) => [...ids].filter((x) => Types.ObjectId.isValid(x)).flatMap((x) => [new Types.ObjectId(x), x]);
const oidList = (ids: Iterable<string>) => [...ids].filter((x) => Types.ObjectId.isValid(x)).map((x) => new Types.ObjectId(x));

/**
 * Условие для запроса к `materials`; `{}` — без ограничения. Объединять через `$and`: [свой фильтр, scopeMatch(scope)].
 * В `categoryId` встречаются и ObjectId, и строки — ищем оба вида.
 */
export function scopeMatch(scope: StockScope | null | undefined): Record<string, unknown> {
  if (!scope) return {};
  const parts = scope.zones.map((z) => {
    const or: Record<string, unknown>[] = [];
    if (z.categoryIds.size) or.push({ categoryId: { $in: both(z.categoryIds) } });
    if (z.includeIds.size) or.push({ _id: { $in: oidList(z.includeIds) } });
    if (z.noCategory) or.push({ categoryId: null });
    if (!or.length) return null;
    const own = or.length === 1 ? or[0] : { $or: or };
    return z.excludeIds.size ? { $and: [own, { _id: { $nin: oidList(z.excludeIds) } }] } : own;
  }).filter((x): x is Record<string, unknown> => !!x);
  return parts.length ? (parts.length === 1 ? parts[0] : { $or: parts }) : { _id: { $in: [] } };
}

/** Переключатель склада: сузить доступ до одного выбранного склада (zoneId из GET /stock/zones). Чужой склад — 403. */
export function narrowToZone(scope: StockScope | null, zoneId: unknown): StockScope | null {
  const id = String(zoneId ?? '').trim();
  if (!id) return scope;
  const def = zoneDefs.get(id);
  const z = scope ? scope.zones.find((c) => c.id === id) : def ? clause(def) : undefined;
  if (!z) throw scope ? new ForbiddenException('Этот склад вам недоступен') : new BadRequestException('Такого склада нет');
  return { zones: [z], categoryIds: [...z.categoryIds], noCategory: z.noCategory };
}

/** Фильтр списка: запрошенные категории внутри своих, чужие отбрасываются; ничего не осталось — все свои. */
export function narrowCategories(requested: unknown, scope: StockScope): string {
  const own = new Set(scope.categoryIds);
  const want = String(requested ?? '').split(',').map((s) => s.trim()).filter((s) => own.has(s));
  return (want.length ? want : scope.categoryIds).join(',');
}
