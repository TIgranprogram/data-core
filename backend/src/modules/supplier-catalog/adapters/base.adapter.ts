export interface ParsedItem {
  vendorArticle: string;
  name: string;
  description?: string;
  priceRetail?: number;
  prices?: { minQty: number; price: number }[];
  photoUrls?: string[];
  sourceUrl: string;
  specs?: Record<string, string>;
  category?: string;
  inStock?: boolean;
  stockQty?: number;
  unit?: string;
}

export type FetchFn = typeof fetch;

export interface BaseAdapter {
  /** Белый список хостов: каждый запрос (страницы, товары, фото) — только на них */
  readonly hosts: string[];
  /** true, только если обход каталога завершён целиком (иначе пропавшие позиции не деактивируются) */
  complete: boolean;
  fetchItems(catalogUrl: string, fetchFn: FetchFn): AsyncGenerator<ParsedItem>;
}
