import { Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;
import type { BaseAdapter, FetchFn, ParsedItem } from './base.adapter';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 2000;
/** Пауза между страницами каталога: 1–2 с */
const CATALOG_PAUSE_MIN_MS = 1_000;
const CATALOG_PAUSE_MAX_MS = 2_000;
/** Пауза между страницами товаров: 500–1500 мс */
const ITEM_PAUSE_MIN_MS = 500;
const ITEM_PAUSE_MAX_MS = 1_500;
const PHOTO_URL_PATTERN = /^https:\/\/zaglushka\.ru\/images\/item\//;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RETRY_429_WAIT_MS = 30_000;

function randMs(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export class ZaglushkaAdapter implements BaseAdapter {
  private readonly logger = new Logger(ZaglushkaAdapter.name);

  async *fetchItems(catalogUrl: string, fetchFn: FetchFn): AsyncGenerator<ParsedItem> {
    const baseUrl = new URL(catalogUrl);
    let page = 1;
    let totalYielded = 0;

    while (totalYielded < MAX_ITEMS) {
      const pageUrl = new URL(baseUrl.toString());
      if (page > 1) pageUrl.searchParams.set('page', String(page));

      const html = await this.fetchPage(pageUrl.toString(), fetchFn);
      if (!html) break;

      const $ = cheerio.load(html);
      const itemLinks = this.extractItemLinks($, baseUrl.origin);
      if (itemLinks.length === 0) break;

      for (const link of itemLinks) {
        if (totalYielded >= MAX_ITEMS) break;
        await new Promise((r) => setTimeout(r, randMs(ITEM_PAUSE_MIN_MS, ITEM_PAUSE_MAX_MS)));
        const itemHtml = await this.fetchPage(link, fetchFn);
        if (!itemHtml) continue;
        const item = this.parseItemPage(itemHtml, link);
        if (!item) continue;
        yield item;
        totalYielded++;
      }

      const hasNextPage = this.hasNextPage($, page);
      if (!hasNextPage) break;
      page++;
      await new Promise((r) => setTimeout(r, randMs(CATALOG_PAUSE_MIN_MS, CATALOG_PAUSE_MAX_MS)));
    }
  }

  private async fetchPage(url: string, fetchFn: FetchFn): Promise<string | null> {
    return this.fetchWithRetry(url, fetchFn, true);
  }

  async fetchRaw(url: string, fetchFn: FetchFn): Promise<Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });
      if (res.status === 429) {
        this.logger.warn(`zaglushka 429 at ${url}, waiting ${RETRY_429_WAIT_MS}ms`);
        await new Promise((r) => setTimeout(r, RETRY_429_WAIT_MS));
        const retry = await fetchFn(url, {
          headers: { 'User-Agent': USER_AGENT },
        });
        if (!retry.ok) { this.logger.warn(`zaglushka retry failed ${retry.status} at ${url}`); return null; }
        const buf = await retry.arrayBuffer();
        if (buf.byteLength > MAX_RESPONSE_BYTES) return null;
        return Buffer.from(buf);
      }
      if (!res.ok) { this.logger.warn(`zaglushka fetch ${url} → ${res.status}`); return null; }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_RESPONSE_BYTES) { this.logger.warn(`zaglushka: body too large at ${url}`); return null; }
      return Buffer.from(buf);
    } catch (err) {
      this.logger.warn(`zaglushka fetch error at ${url}: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchWithRetry(url: string, fetchFn: FetchFn, asText: true): Promise<string | null>;
  private async fetchWithRetry(url: string, fetchFn: FetchFn, asText: false): Promise<Buffer | null>;
  private async fetchWithRetry(url: string, fetchFn: FetchFn, asText: boolean): Promise<string | Buffer | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, {
        signal: controller.signal,
        headers: { 'User-Agent': USER_AGENT },
      });

      if (res.status === 429) {
        this.logger.warn(`zaglushka 429 at ${url}, waiting ${RETRY_429_WAIT_MS}ms`);
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, RETRY_429_WAIT_MS));
        const retry = await fetchFn(url, { headers: { 'User-Agent': USER_AGENT } });
        if (!retry.ok) { this.logger.warn(`zaglushka retry failed ${retry.status} at ${url}`); return null; }
        const buf2 = await retry.arrayBuffer();
        if (buf2.byteLength > MAX_RESPONSE_BYTES) return null;
        return asText ? Buffer.from(buf2).toString('utf8') : Buffer.from(buf2);
      }

      if (!res.ok) { this.logger.warn(`zaglushka fetch ${url} → ${res.status}`); return null; }
      const contentLength = Number(res.headers.get('content-length') ?? 0);
      if (contentLength > MAX_RESPONSE_BYTES) { this.logger.warn(`zaglushka: content-length too large at ${url}`); return null; }
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_RESPONSE_BYTES) { this.logger.warn(`zaglushka: body too large at ${url}`); return null; }
      return asText ? Buffer.from(buf).toString('utf8') : Buffer.from(buf);
    } catch (err) {
      this.logger.warn(`zaglushka fetch error at ${url}: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private extractItemLinks($: cheerio.CheerioAPI, origin: string): string[] {
    const links: string[] = [];
    $('a[href]').each((_: number, el: AnyNode) => {
      const href = $(el).attr('href') ?? '';
      if (!href || href.startsWith('#') || href.startsWith('javascript')) return;
      try {
        const abs = new URL(href, origin).toString();
        if (abs.startsWith(origin) && !links.includes(abs)) {
          const path = new URL(abs).pathname;
          if (path.length > 1 && !path.startsWith('/catalog/') && path.split('/').length >= 2) {
            links.push(abs);
          }
        }
      } catch { /* ignore invalid hrefs */ }
    });
    return links;
  }

  private hasNextPage($: cheerio.CheerioAPI, currentPage: number): boolean {
    let found = false;
    $('a[href]').each((_: number, el: AnyNode) => {
      const href = $(el).attr('href') ?? '';
      try {
        const url = new URL(href, 'https://zaglushka.ru');
        const p = Number(url.searchParams.get('page'));
        if (p > currentPage) { found = true; return false; }
      } catch { /* ignore */ }
    });
    return found;
  }

  parseItemPage(html: string, sourceUrl: string): ParsedItem | null {
    const $ = cheerio.load(html);

    const name = $('h1').first().text().trim();
    if (!name) return null;

    const vendorArticle = $('main h2, h2').first().text().trim();
    if (!vendorArticle) {
      this.logger.warn(`zaglushka: no article at ${sourceUrl}, skipping`);
      return null;
    }

    const breadcrumbs: string[] = [];
    $('[class*="breadcrumb"] a, nav a, .breadcrumb li a').each((_: number, el: AnyNode) => {
      const t = $(el).text().trim();
      if (t) breadcrumbs.push(t);
    });
    const category = breadcrumbs.slice(1, 3).join(' / ') || undefined;

    // Фото: только https://zaglushka.ru/images/item/... (внешние URL — сервис их скачает)
    const photoUrls: string[] = [];
    $('img[src]').each((_: number, el: AnyNode) => {
      const src = $(el).attr('src') ?? '';
      if (PHOTO_URL_PATTERN.test(src) && !photoUrls.includes(src)) {
        photoUrls.push(src);
      }
    });

    const prices: { minQty: number; price: number }[] = [];
    let priceRetail: number | undefined;

    $('table tr').each((_: number, row: AnyNode) => {
      const cells = $(row).find('td, th').map((_: number, td: AnyNode) => $(td).text().trim()).get();
      if (cells.length < 2) return;
      const qtyCell = cells[0].toLowerCase();
      const priceCell = cells[1];
      const priceVal = parseFloat(priceCell.replace(/[^\d.,]/g, '').replace(',', '.'));
      if (isNaN(priceVal)) return;

      if (qtyCell.includes('рознич') || qtyCell.includes('розница')) {
        priceRetail = priceVal;
      } else {
        const match = qtyCell.match(/(\d+)/);
        if (match) {
          prices.push({ minQty: parseInt(match[1], 10), price: priceVal });
        }
      }
    });

    if (priceRetail === undefined && prices.length > 0) {
      priceRetail = prices[prices.length - 1].price;
    }

    const specs: Record<string, string> = {};
    let inStock: boolean | undefined;
    let stockQty: number | undefined;
    let unit: string | undefined;

    $('table tr').each((_: number, row: AnyNode) => {
      const cells = $(row).find('td, th').map((_: number, td: AnyNode) => $(td).text().trim()).get();
      if (cells.length < 2) return;
      const key = cells[0].trim();
      const val = cells[1].trim();
      if (!key || !val) return;

      if (/наличи/i.test(key)) {
        inStock = !/нет/i.test(val);
        const qtyMatch = val.match(/(\d+)/);
        if (qtyMatch) stockQty = parseInt(qtyMatch[1], 10);
      } else if (/кол-?во|количество/i.test(key)) {
        const m = val.match(/(\d+)/);
        if (m) stockQty = parseInt(m[1], 10);
        inStock = stockQty !== undefined && stockQty > 0;
      } else if (/ед\s*\.?\s*изм|единица|unit/i.test(key)) {
        unit = val;
      } else if (key && val && !/от\s*\d+\s*шт/i.test(key) && !/цена/i.test(key)) {
        specs[key] = val;
      }
    });

    return {
      vendorArticle,
      name,
      priceRetail,
      prices: prices.length > 0 ? prices : undefined,
      photoUrls: photoUrls.length > 0 ? photoUrls : undefined,
      sourceUrl,
      specs: Object.keys(specs).length > 0 ? specs : undefined,
      category,
      inStock,
      stockQty,
      unit,
    };
  }
}
