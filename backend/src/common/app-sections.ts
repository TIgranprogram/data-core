/**
 * SK-8a — разделы «Рабочего места» (`backend/pwa/main.js`, `NAV`), которые
 * можно включить роли галочками (`roles.appSections`). Это только видимость
 * меню: права остаются на маршрутах (@Roles, permissions, MoneyMask).
 * Новый раздел в NAV → добавить сюда (иначе его нельзя отметить у роли).
 */
export const APP_SECTIONS = [
  { id: 'home', label: 'Сегодня' },
  { id: 'requests', label: 'Заявки' },
  { id: 'stock', label: 'Остатки' },
  { id: 'salesorders', label: 'Заказы' },
  { id: 'partners', label: 'Контрагенты' },
  { id: 'products', label: 'Продукция' },
  { id: 'passports', label: 'Паспорта' },
  { id: 'orders', label: 'Позиции и оплаты' },
  { id: 'money', label: 'Платёжный календарь' },
  { id: 'payroll', label: 'ФОТ' },
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
