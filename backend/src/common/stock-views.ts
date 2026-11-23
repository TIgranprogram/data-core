/** Дополнительные экраны склада в интерфейсе. Это не разрешения API и не складской scope. */
export const STOCK_VIEWS = ['pipe', 'sheet'] as const;
export type StockView = typeof STOCK_VIEWS[number];

/** Нет настройки — наследуем просмотр директора; повреждённая настройка ничего не выдаёт. */
export function stockViewsFor(baseRole: string, configured: unknown): StockView[] {
  if (configured === undefined) return baseRole === 'director' ? [...STOCK_VIEWS] : [];
  if (!Array.isArray(configured) || configured.length > STOCK_VIEWS.length
    || new Set(configured).size !== configured.length
    || configured.some(value => !STOCK_VIEWS.includes(value as StockView))) return [];
  return [...configured] as StockView[];
}
