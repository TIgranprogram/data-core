import { ZaglushkaAdapter } from './zaglushka.adapter';

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<head><title>Опора М10</title></head>
<body>
  <nav class="breadcrumb">
    <a href="/">Главная</a>
    <a href="/opory/">Опоры</a>
    <a href="/opory/rezbovye/">Резьбовые регулируемые</a>
  </nav>
  <main>
    <h1>Опора резьбовая регулируемая М10</h1>
    <h2>ОР-М10-50</h2>
    <p>Описание товара</p>

    <table>
      <tr><td>от 1 шт.</td><td>25.50 руб.</td></tr>
      <tr><td>от 10 шт.</td><td>22.00 руб.</td></tr>
      <tr><td>Розничная</td><td>28.00 руб.</td></tr>
    </table>

    <table>
      <tr><td>Материал</td><td>Сталь оцинкованная</td></tr>
      <tr><td>Вес</td><td>0.0037 кг</td></tr>
      <tr><td>Наличие</td><td>В наличии 150 шт.</td></tr>
    </table>

    <img src="https://zaglushka.ru/images/item/or-m10-1.jpg" alt="фото 1" />
    <img src="https://zaglushka.ru/images/item/or-m10-2.jpg" alt="фото 2" />
    <img src="/images/logo.png" alt="логотип" />
  </main>
</body>
</html>
`;

describe('ZaglushkaAdapter.parseItemPage', () => {
  const adapter = new ZaglushkaAdapter();

  it('parses article from h2', () => {
    const item = adapter.parseItemPage(SAMPLE_HTML, 'https://zaglushka.ru/or-m10');
    expect(item).not.toBeNull();
    expect(item!.vendorArticle).toBe('ОР-М10-50');
  });

  it('parses name from h1', () => {
    const item = adapter.parseItemPage(SAMPLE_HTML, 'https://zaglushka.ru/or-m10');
    expect(item!.name).toBe('Опора резьбовая регулируемая М10');
  });

  it('parses price thresholds', () => {
    const item = adapter.parseItemPage(SAMPLE_HTML, 'https://zaglushka.ru/or-m10');
    expect(item!.prices).toBeDefined();
    expect(item!.prices!.length).toBeGreaterThanOrEqual(1);
    expect(item!.prices![0].minQty).toBe(1);
    expect(item!.prices![0].price).toBeCloseTo(25.5);
  });

  it('parses retail price', () => {
    const item = adapter.parseItemPage(SAMPLE_HTML, 'https://zaglushka.ru/or-m10');
    expect(item!.priceRetail).toBeCloseTo(28.0);
  });

  it('parses only https zaglushka.ru/images/item photos', () => {
    const item = adapter.parseItemPage(SAMPLE_HTML, 'https://zaglushka.ru/or-m10');
    expect(item!.photoUrls).toBeDefined();
    expect(item!.photoUrls!.length).toBe(2);
    expect(item!.photoUrls!.every((u) => u.startsWith('https://zaglushka.ru/images/item/'))).toBe(true);
  });

  it('parses category from breadcrumbs', () => {
    const item = adapter.parseItemPage(SAMPLE_HTML, 'https://zaglushka.ru/or-m10');
    expect(item!.category).toContain('Опоры');
  });

  it('returns null when no article (no h2)', () => {
    const htmlNoArticle = SAMPLE_HTML.replace('<h2>ОР-М10-50</h2>', '');
    const item = adapter.parseItemPage(htmlNoArticle, 'https://zaglushka.ru/x');
    expect(item).toBeNull();
  });

  it('returns null when no h1 name', () => {
    const htmlNoName = SAMPLE_HTML.replace('<h1>Опора резьбовая регулируемая М10</h1>', '');
    const item = adapter.parseItemPage(htmlNoName, 'https://zaglushka.ru/x');
    expect(item).toBeNull();
  });
});

function makeArrayBuffer(data: string): ArrayBuffer {
  const buf = Buffer.from(data);
  // Properly sliced ArrayBuffer, no shared memory surprises
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

describe('ZaglushkaAdapter.fetchRaw — 429 handling', () => {
  it('waits and retries on 429, returns buffer on retry success', async () => {
    jest.useFakeTimers();
    const adapter = new ZaglushkaAdapter();
    let callCount = 0;

    const fetchFn = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ status: 429, ok: false, headers: new Headers() });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers(),
        arrayBuffer: () => Promise.resolve(makeArrayBuffer('image data')),
      });
    });

    const promise = adapter.fetchRaw('https://zaglushka.ru/images/item/test.jpg', fetchFn as typeof fetch);
    await jest.advanceTimersByTimeAsync(30_001);
    const result = await promise;

    expect(callCount).toBe(2);
    expect(result).not.toBeNull();
    expect(Buffer.from(result!).toString()).toBe('image data');
    jest.useRealTimers();
  });

  it('sends User-Agent header', async () => {
    const adapter = new ZaglushkaAdapter();
    let capturedHeaders: Record<string, string> = {};

    const fetchFn = jest.fn().mockImplementation((_url: string, init?: RequestInit) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-length': '100' }),
        arrayBuffer: () => Promise.resolve(makeArrayBuffer('ok')),
      });
    });

    await adapter.fetchRaw('https://zaglushka.ru/images/item/test.jpg', fetchFn as typeof fetch);
    expect(capturedHeaders['User-Agent']).toMatch(/Mozilla/);
  });
});

// ─── Обход с корня сайта ──────────────────────────────────────────────────────

describe('ZaglushkaAdapter.fetchItems — старт с корня', () => {
  const page = (body: string, og = 'website') =>
    `<html><head><meta property="og:type" content="${og}"></head><body><h1>T</h1>${body}</body></html>`;
  const ROOT = page('<a href="/plastikovye-opory">Опоры</a><a href="/about">О нас</a><a href="/en/x">en</a><a href="https://evil.com/x">x</a>');
  const CAT = page('<a href="/opora-1">1</a><a href="/plastikovye-opory?page=2">2</a>');
  const CAT2 = page('<a href="/opora-1">1</a><a href="/opora-2">2</a>');
  const ITEM = (sku: string) =>
    page(`<h2 class="x"></h2><script type="application/ld+json">{"sku": "${sku}",}</script><meta itemprop="price" content="12.5"/>`, 'product');
  const buildPages = (): Record<string, string> => ({
    'https://zaglushka.ru/': ROOT,
    'https://zaglushka.ru/plastikovye-opory': CAT,
    'https://zaglushka.ru/plastikovye-opory?page=2': CAT2,
    'https://zaglushka.ru/opora-1': ITEM('А1'),
    'https://zaglushka.ru/opora-2': ITEM('А2'),
  });
  const mkFetch = (pages: Record<string, string>) => jest.fn().mockImplementation((url: string) => {
    const html = pages[url];
    if (html === undefined) return Promise.resolve({ ok: false, status: 404, headers: new Headers() });
    return Promise.resolve({ ok: true, status: 200, headers: new Headers(), arrayBuffer: () => Promise.resolve(makeArrayBuffer(html)) });
  });
  const drain = async (adapter: ZaglushkaAdapter, fetchFn: jest.Mock, out: string[] = []) => {
    for await (const it of adapter.fetchItems('https://zaglushka.ru/', fetchFn as unknown as typeof fetch)) out.push(it.vendorArticle);
  };

  it('с корня находит разделы, пагинацию и товары; служебные и чужие ссылки не ходит', async () => {
    jest.useFakeTimers();
    const adapter = new ZaglushkaAdapter();
    const fetchFn = mkFetch(buildPages());
    const out: string[] = [];
    const p = drain(adapter, fetchFn, out);
    await jest.advanceTimersByTimeAsync(60_000);
    await p;
    expect(out.sort()).toEqual(['А1', 'А2']);
    expect(adapter.complete).toBe(true);
    const urls = fetchFn.mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => /about|\/en\/|evil/.test(u))).toBe(false);
    jest.useRealTimers();
  });

  it('первая страница не загрузилась → исключение', async () => {
    const adapter = new ZaglushkaAdapter();
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 500, headers: new Headers() });
    await expect(drain(adapter, fetchFn)).rejects.toThrow();
    expect(adapter.complete).toBe(false);
  });

  it('чужой хост каталога отклоняется; fetchRaw не ходит на чужой хост', async () => {
    const adapter = new ZaglushkaAdapter();
    const fetchFn = jest.fn();
    await expect(
      (async () => { for await (const _ of adapter.fetchItems('https://zaglushka.ru.evil.com/', fetchFn as unknown as typeof fetch)) { void _; } })(),
    ).rejects.toThrow();
    expect(await adapter.fetchRaw('https://evil.com/a.jpg', fetchFn as unknown as typeof fetch)).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('товар не загрузился → complete=false', async () => {
    jest.useFakeTimers();
    const adapter = new ZaglushkaAdapter();
    const pages = buildPages();
    delete pages['https://zaglushka.ru/opora-2'];
    const p = drain(adapter, mkFetch(pages));
    await jest.advanceTimersByTimeAsync(60_000);
    await p;
    expect(adapter.complete).toBe(false);
    jest.useRealTimers();
  });
});
