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
  fetchItems(catalogUrl: string, fetchFn: FetchFn): AsyncGenerator<ParsedItem>;
}
