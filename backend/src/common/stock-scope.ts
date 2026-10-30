/**
 * Склад по роли (СМ.4): роль видит и меняет только свои категории (`roles.stockCategoryIds`), например
 * «Трубарез» — трубы, «Лазер лист» — лист. Пусто — весь склад, как раньше. Владелец и admin — всегда весь склад.
 * Кэш в памяти обновляется вместе с разделами роли (RoleService), чтобы не читать роль на каждый запрос.
 */
const scopes = new Map<string, string[]>();

export function setRoleStockScope(name: string, ids: readonly string[] | null | undefined): void {
  if (!name) return;
  if (ids?.length && name !== 'admin') scopes.set(name, ids.map(String));
  else scopes.delete(name);
}

export function setRoleStockScopeAll(roles: Array<{ name: string; stockCategoryIds?: string[] | null }>): void {
  scopes.clear();
  for (const r of roles) setRoleStockScope(r.name, r.stockCategoryIds);
}

/** Категории пользователя: `null` — весь склад. */
export function stockScopeFor(user: { role?: string | null; isOwner?: boolean } | null | undefined): string[] | null {
  if (!user || user.isOwner === true || !user.role || user.role === 'admin') return null;
  return scopes.get(user.role) ?? null;
}

/** Фильтр списка: запрошенные категории внутри своих, чужие отбрасываются; ничего не осталось — все свои. */
export function narrowCategories(requested: unknown, scope: readonly string[]): string {
  const want = String(requested ?? '').split(',').map((s) => s.trim()).filter((s) => scope.includes(s));
  return (want.length ? want : scope).join(',');
}
