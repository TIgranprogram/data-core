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
