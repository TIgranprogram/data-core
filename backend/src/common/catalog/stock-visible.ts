/**
 * C057 (Л1): склад и снабжение не показывают детали из PDM (materialKind='part') и сортаменты (isProfile).
 * `withParts=1` в запросе — показать. Поля необязательные: у старых записей их нет, `$ne` их пропускает.
 */
export const STOCK_VISIBLE = { materialKind: { $ne: 'part' }, isProfile: { $ne: true } } as const;

/** Строка запроса `withParts` → boolean (`1` / `true`). */
export const withPartsOf = (v: unknown): boolean => v === '1' || v === 1 || v === 'true' || v === true;
