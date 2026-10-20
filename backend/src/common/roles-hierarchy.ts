/**
 * Иерархия ролей (решение пользователя 2026-10-20): старшая роль получает всё, что есть у младших.
 *   директор → бухгалтер → менеджер → наблюдатель (user).
 * Администратор — отдельно: всё, плюс пользователи и настройки (как и раньше, только явным @Roles('admin')).
 * Деньги (суммы, доходы, платёжный календарь) видят только администратор, директор и бухгалтер.
 */
export const ROLE_INHERITS: Record<string, string[]> = {
  admin: ['director', 'accountant', 'manager', 'user'],
  director: ['accountant', 'manager', 'user'],
  accountant: ['manager', 'user'],
  manager: ['user'],
};

/** Роль + все младшие. */
export function effectiveRoles(role: string | undefined | null): string[] {
  if (!role) return [];
  return [role, ...(ROLE_INHERITS[role] ?? [])];
}

export const MONEY_ROLES = ['admin', 'director', 'accountant'];

export function canSeeMoney(user: { role?: string | null; isOwner?: boolean } | undefined | null): boolean {
  return !!user && (user.isOwner === true || MONEY_ROLES.includes(String(user.role)));
}

/** Денежные поля, которые скрываются от менеджера и наблюдателя (в ответах) и не принимаются от них (в запросах). */
export const MONEY_FIELDS = ['priceHint', 'unitPrice', 'amountManual', 'amount', 'paidAmount', 'sum', 'paidDate', 'reportDate'];
