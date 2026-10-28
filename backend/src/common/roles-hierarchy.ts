/**
 * Иерархия ролей (решение пользователя 2026-10-20): старшая роль получает всё, что есть у младших.
 *   директор → бухгалтер → менеджер → наблюдатель (user).
 * Администратор — отдельно: всё, плюс пользователи и настройки (как и раньше, только явным @Roles('admin')).
 * Деньги (суммы, доходы, платёжный календарь) видят только администратор, директор и бухгалтер.
 *
 * SK-8c — свои роли (`roles` с `baseRole`, код `r-…`): права = права `baseRole`
 * (+ иерархия ниже неё). Соответствие «код → baseRole» держит кэш в памяти
 * процесса: заполняет RoleService при старте и обновляет при создании/правке/
 * удалении роли. Все проверки прав идут через effectiveRoles / baseRoleOf.
 */
export const ROLE_INHERITS: Record<string, string[]> = {
  admin: ['director', 'accountant', 'manager', 'user'],
  director: ['accountant', 'manager', 'user'],
  accountant: ['manager', 'user'],
  manager: ['user'],
};

/** Встроенные роли (код не меняется, смысл задан ROLE_INHERITS). */
export const BUILTIN_ROLES = ['user', 'manager', 'accountant', 'director', 'admin'] as const;

/** На что может опираться своя роль — любая встроенная, кроме администратора. */
export const BASE_ROLES = ['user', 'manager', 'accountant', 'director'] as const;

/** Русские названия встроенных ролей (если в `roles.label` осталось английское из сида). */
export const BUILTIN_ROLE_LABELS: Record<string, string> = {
  admin: 'Администратор',
  director: 'Директор',
  accountant: 'Бухгалтер',
  manager: 'Менеджер',
  user: 'Наблюдатель',
};

export function isBuiltinRole(role: string | undefined | null): boolean {
  return (BUILTIN_ROLES as readonly string[]).includes(String(role));
}

export function isBaseRole(role: string | undefined | null): boolean {
  return (BASE_ROLES as readonly string[]).includes(String(role));
}

/** SK-8c: кэш «код своей роли → baseRole». Только допустимые baseRole (не admin). */
const customRoleBase = new Map<string, string>();

/** Полностью заменить кэш (старт приложения). */
export function setCustomRoleBases(roles: Array<{ name: string; baseRole?: string | null }>): void {
  customRoleBase.clear();
  for (const r of roles) setCustomRoleBase(r.name, r.baseRole);
}

/** Записать/убрать одну роль (baseRole пусто или недопустимо — убрать). Встроенные в кэш не попадают. */
export function setCustomRoleBase(name: string, baseRole: string | null | undefined): void {
  if (!name || isBuiltinRole(name)) return;
  if (baseRole && isBaseRole(baseRole)) customRoleBase.set(name, baseRole);
  else customRoleBase.delete(name);
}

/**
 * Базовая роль для проверок прав: встроенная — она сама; своя — её baseRole;
 * незнакомая — сама строка (как раньше, прав по иерархии у неё нет).
 */
export function baseRoleOf(role: string | undefined | null): string | null {
  if (!role) return null;
  return customRoleBase.get(role) ?? role;
}

/** Роль + все младшие. Своя роль: [код, baseRole, ...младшие baseRole]. */
export function effectiveRoles(role: string | undefined | null): string[] {
  if (!role) return [];
  const base = customRoleBase.get(role);
  if (base) return [role, base, ...(ROLE_INHERITS[base] ?? [])];
  return [role, ...(ROLE_INHERITS[role] ?? [])];
}

export const MONEY_ROLES = ['admin', 'director', 'accountant'];

export function canSeeMoney(user: { role?: string | null; isOwner?: boolean } | undefined | null): boolean {
  return !!user && (user.isOwner === true || MONEY_ROLES.includes(String(baseRoleOf(user.role))));
}

/**
 * Название роли для людей: своё `label`, если оно по-русски; для встроенной
 * с английским названием из сида — русское из BUILTIN_ROLE_LABELS.
 */
export function roleLabelOf(name: string | undefined | null, label?: string | null): string {
  if (label && /[а-яё]/i.test(label)) return label;
  return BUILTIN_ROLE_LABELS[String(name)] ?? label ?? String(name ?? '');
}

/** Денежные поля, которые скрываются от менеджера и наблюдателя (в ответах) и не принимаются от них (в запросах). */
export const MONEY_FIELDS = ['priceHint', 'unitPrice', 'amountManual', 'amount', 'paidAmount', 'sum', 'paidDate', 'reportDate', 'salaryRate', 'payments', 'debt', 'money'];
