/**
 * SK-8a — разделы «Рабочего места» (`backend/pwa/main.js`, `NAV`), которые
 * можно включить роли галочками (`roles.appSections`). Это только видимость
 * меню: права остаются на маршрутах (@Roles, permissions, MoneyMask).
 * Новый раздел в NAV → добавить сюда (иначе его нельзя отметить у роли).
 */
export const APP_SECTIONS = [
  { id: 'home', label: 'Сегодня' },
  { id: 'requests', label: 'Заявки' },
  { id: 'suppliercatalog', label: 'Каталог поставщиков' },
  { id: 'stock', label: 'Остатки' },
  { id: 'salesorders', label: 'Заказы' },
  { id: 'partners', label: 'Контрагенты' },
  { id: 'products', label: 'Продукция' },
  // NAV: пункт «Документация»; старый id `passports` остаётся (его проверяют /passports*, /showcase*).
  { id: 'docs', label: 'Документация' },
  { id: 'passports', label: 'Документация (паспорта, шаблоны)' },
  { id: 'orders', label: 'Позиции и оплаты' },
  { id: 'money', label: 'Платёжный календарь' },
  { id: 'payroll', label: 'ФОТ' },
  // «Проектирование»: /api/design-tasks (modules/design, ПРЖ-3).
  { id: 'design', label: 'Проектирование' },
] as const;

export type AppSectionId = (typeof APP_SECTIONS)[number]['id'];

export const APP_SECTION_IDS: readonly string[] = APP_SECTIONS.map((s) => s.id);

/**
 * Разделы для ответа `/auth`: `null` = «как сейчас» (видимость по иерархии
 * роли) — у администратора всегда, и у роли без отмеченных разделов.
 * Неизвестные значения (раздел убрали из списка) отбрасываются.
 */
export function appSectionsFor(
  role: string | null | undefined,
  appSections: readonly string[] | null | undefined,
): string[] | null {
  if (role === 'admin') return null;
  const list = (appSections ?? []).filter((s) => APP_SECTION_IDS.includes(s));
  return list.length ? list : null;
}

/** Название раздела для сообщений («Раздел «Заказы» для вашей роли закрыт»). */
export function appSectionLabel(id: string): string {
  return APP_SECTIONS.find((s) => s.id === id)?.label ?? id;
}

/**
 * SK-8d: кэш «код роли → открытые разделы» в памяти процесса (как кэш baseRole
 * в roles-hierarchy.ts): AppSectionGuard не читает базу на каждый запрос.
 * Заполняет RoleService при старте, обновляет при создании/правке/удалении роли
 * и при входе (resolveForAuth). В кэше только роли с непустыми разделами.
 */
const roleSections = new Map<string, Set<string>>();

/** Полностью заменить кэш (старт приложения). */
export function setRoleSectionsAll(roles: Array<{ name: string; appSections?: string[] | null }>): void {
  roleSections.clear();
  for (const r of roles) setRoleSections(r.name, r.appSections);
}

/** Записать/убрать одну роль: пусто (после отбрасывания неизвестных) или admin — убрать. */
export function setRoleSections(name: string, appSections: readonly string[] | null | undefined): void {
  if (!name) return;
  const list = appSectionsFor(name, appSections);
  if (list) roleSections.set(name, new Set(list));
  else roleSections.delete(name);
}

export function deleteRoleSections(name: string): void {
  roleSections.delete(name);
}

/**
 * Открытые разделы пользователя: `null` — без ограничений (нет пользователя,
 * владелец, admin, роль без галочек или не в кэше). Ключ `kppd_` — req.user
 * владельца ключа, значит его роль.
 */
export function openSectionsFor(
  user: { role?: string | null; isOwner?: boolean } | null | undefined,
): Set<string> | null {
  if (!user || user.isOwner === true || !user.role || user.role === 'admin') return null;
  return roleSections.get(user.role) ?? null;
}

/** Открыт ли раздел (null-набор = всё открыто). */
export function sectionOpen(open: Set<string> | null, id: string): boolean {
  return !open || open.has(id);
}
