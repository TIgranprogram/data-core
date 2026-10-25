import { Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;
import { hostAllowed } from '../safe-fetch';
import type { BaseAdapter, FetchFn, ParsedItem } from './base.adapter';

const FETCH_TIMEOUT_MS = 15_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
const MAX_ITEMS = 5000;
const MAX_PAGES = 6000;
/** Служебные разделы сайта и языковые копии — не каталог */
const SKIP_FIRST_SEGMENTS = new Set([
  'about', 'cart', 'contacts', 'delivery', 'policy', 'job', 'booklet', 'search', 'specials', 'new-products',
  'password', 'en', 'it', 'catalog', 'files', 'images', 'css', 'js', 'login', 'register', 'cached', 'api',
]);
/** Пауза между страницами товаров: 500–1500 мс */
const ITEM_PAUSE_MIN_MS = 500;
const ITEM_PAUSE_MAX_MS = 1_500;
const PHOTO_URL_PATTERN = /^https:\/\/zaglushka\.ru\/(images\/item|cached)\//;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RETRY_429_WAIT_MS = 30_000;

function randMs(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

export class ZaglushkaAdapter implements BaseAdapter {
  private readonly logger = new Logger(ZaglushkaAdapter.name);

  /** Белый список хостов каталога */
  readonly hosts = ['zaglushka.ru'];
  /** Обход дошёл до конца без пропусков */
  complete = false;

  /**
   * Обход сайта от любой стартовой ссылки (корень, раздел): страницы с og:type=product — товары,
   * остальные — разделы, из них берём ссылки дальше (ширина, без повторов, ≤ MAX_PAGES страниц).
   * complete=true — очередь разобрана до конца без пропусков и без упора в лимиты.
   */
  async *fetchItems(catalogUrl: string, fetchFn: FetchFn): AsyncGenerator<ParsedItem> {
    this.complete = false;
    const baseUrl = new URL(catalogUrl);
    if (!hostAllowed(baseUrl.hostname, this.hosts)) throw new Error('Хост каталога не разрешён');
    const queue: string[] = [baseUrl.toString()];
    const seen = new Set<string>(queue);
    let visited = 0;
    let yielded = 0;
    let skipped = false;

    while (queue.length > 0) {
      if (visited >= MAX_PAGES || yielded >= MAX_ITEMS) return;
      const url = queue.shift()!;
      const first = visited === 0;
      if (!first) await new Promise((r) => setTimeout(r, randMs(ITEM_PAUSE_MIN_MS, ITEM_PAUSE_MAX_MS)));
      visited++;

      const html = await this.fetchPage(url, fetchFn);
      if (!html) {
        if (first) throw new Error('Не удалось загрузить первую страницу каталога');
        skipped = true;
        continue;
      }
      const $ = cheerio.load(html);
      const ogType = $('meta[property="og:type"]').attr('content');
      const isProduct = ogType ? ogType === 'product' : false;
      if (isProduct || (!ogType && !first && this.looksLikeLegacyItem($))) {
        const item = this.parseItemPage(html, url);
        if (item) { yield item; yielded++; } else skipped = true;
        continue;
      }
      const links = this.extractLinks($, baseUrl.origin);
      if (first && links.length === 0) throw new Error('На первой странице каталога нет ссылок на товары');
      for (const l of links) {
        if (!seen.has(l)) { seen.add(l); queue.push(l); }
      }
    }
    this.complete = !skipped;
  }

  /** Старая вёрстка без og:type: страница с таблицей цен и артикулом в h2. */
  private looksLikeLegacyItem($: cheerio.CheerioAPI): boolean {
    return $('h2').length > 0 && $('table').length > 0;
  }

  private async fetchPage(url: string, fetchFn: FetchFn): Promise<string | null> {
    const buf = await this.fetchRaw(url, fetchFn);
    return buf ? buf.toString('utf8') : null;
  }

  /** Скачивание с проверкой хоста, лимитом размера и одним повтором после 429. */
  async fetchRaw(url: string, fetchFn: FetchFn): Promise<Buffer | null> {
    let host: string;
    try { host = new URL(url).hostname; } catch { return null; }
    if (!hostAllowed(host, this.hosts)) {
      this.logger.warn(`zaglushka: хост вне белого списка, пропуск ${url}`);
      return null;
    }
    const first = await this.attempt(url, fetchFn);
    if (first !== 429) return first;
    this.logger.warn(`zaglushka 429 at ${url}, waiting ${RETRY_429_WAIT_MS}ms`);
    await new Promise((r) => setTimeout(r, RETRY_429_WAIT_MS));
    const retry = await this.attempt(url, fetchFn);
    return retry === 429 ? null : retry;
  }

  /** Одна попытка: свой таймаут/signal на запрос и чтение тела. 429 → число 429. */
  private async attempt(url: string, fetchFn: FetchFn): Promise<Buffer | null | 429> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchFn(url, { signal: controller.signal, headers: { 'User-Agent': USER_AGENT } });
      if (res.status === 429) return 429;
      if (!res.ok) { this.logger.warn(`zaglushka fetch ${url} → ${res.status}`); return null; }
      const declared = Number(res.headers.get('content-length') ?? 0);
      if (declared > MAX_RESPONSE_BYTES) { this.logger.warn(`zaglushka: content-length too large at ${url}`); return null; }
      const body = await this.readLimited(res);
      if (!body) this.logger.warn(`zaglushka: body too large at ${url}`);
      return body;
    } catch (err) {
      this.logger.warn(`zaglushka fetch error at ${url}: ${(err as Error).message}`);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Чтение тела с жёстким лимитом байт (стрим обрывается при превышении). */
  private async readLimited(res: Response): Promise<Buffer | null> {
    if (!res.body || typeof res.body.getReader !== 'function') {
      const ab = await res.arrayBuffer();
      return ab.byteLength > MAX_RESPONSE_BYTES ? null : Buffer.from(ab);
    }
    const reader = res.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel().catch(() => undefined); return null; }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  }

  /** Ссылки того же сайта на разделы/товары: плоские slug-пути и ?page=N, без служебных страниц. */
  private extractLinks($: cheerio.CheerioAPI, origin: string): string[] {
    const out = new Set<string>();
    $('a[href]').each((_: number, el: AnyNode) => {
      const href = $(el).attr('href') ?? '';
      if (!href || href.startsWith('#') || /^(javascript|mailto|tel):/i.test(href)) return;
      try {
        const u = new URL(href, origin);
        if (u.origin !== origin) return;
        const keys = [...u.searchParams.keys()];
        if (keys.some((k) => k !== 'page')) return;
        const segs = u.pathname.split('/').filter(Boolean);
        if (segs.length === 0 || segs.length > 4) return;
        if (!segs.every((x) => /^[a-z0-9._-]+$/i.test(x)) || /\.[a-z0-9]{2,4}$/i.test(u.pathname)) return;
        if (SKIP_FIRST_SEGMENTS.has(segs[0].toLowerCase())) return;
        u.hash = '';
        out.add(u.toString());
      } catch { /* ignore invalid hrefs */ }
    });
    return [...out];
  }

  parseItemPage(html: string, sourceUrl: string): ParsedItem | null {
    const $ = cheerio.load(html);

    const name = $('h1').first().text().trim();
    if (!name) return null;

    const vendorArticle =
      $('main h2, h2').first().text().trim() ||
      (html.match(/"sku"\s*:\s*"([^"]+)"/)?.[1] ?? '').trim();
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

    if (priceRetail === undefined && prices.length === 0) {
      const p = parseFloat($('[itemprop="price"]').first().attr('content') ?? '');
      if (!isNaN(p)) priceRetail = p;
    }
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
