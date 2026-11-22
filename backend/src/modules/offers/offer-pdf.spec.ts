import { gunzipSync } from 'node:zlib';
import sharp from 'sharp';
import { OFFER_BLOCKS } from './dto';
import { OfferGeometry } from './offer-geometry';
import { newOfferPageMap, renderOfferPdf, money, rub } from './offer-pdf';

const item = (n: number) => ({ productName: `Урна «Парк» № ${n}`, productSku: `U-${n}`, color: 'серый', quantity: 2, unit: 'шт', unitPrice: 1500.5, total: 3001 });

describe('КП: PDF', () => {
  it('формат денег', () => {
    expect(money(1234567.5)).toBe('1 234 567,50');
    expect(money(null)).toBe('');
  });

  it('итог в рублях: целое без копеек, дробное — с копейками', () => {
    expect(rub(680000)).toBe('680 000 ₽');
    expect(rub(122622.95)).toBe('122 622,95 ₽');
  });

  it('40 строк без фонов — валидный PDF на нескольких страницах', async () => {
    const buf = await renderOfferPdf({
      number: 'КП-2026-001', date: '2026-10-30', validUntil: '2026-11-15', customer: 'ООО «Школа»', companyName: 'СпортИН-ЮГ',
      items: Array.from({ length: 40 }, (_, i) => item(i + 1)), total: 120040, prepaymentPercent: 50, productionDays: 14, deliveryDays: 3,
      vatMode: 'with', vatRate: 22, delivery: 'included', objectName: 'Мостик 5×2 м, проезд 4', terms: 'Оплата по счёту.', notes: 'Монтаж отдельно', bg1: null, bg2: null, photos: new Map(),
    });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(3);
  });

  it('зона бланка сдвигает текст: узкая зона даёт больше страниц', async () => {
    const base = { number: 'КП-1', date: '2026-11-06', customer: 'ООО «Школа»', items: Array.from({ length: 12 }, (_, i) => item(i + 1)), total: 1, vatMode: 'without' as const, vatRate: 22, bg1: null, bg2: null, photos: new Map() };
    const pages = (b: Buffer) => (b.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    const wide = await renderOfferPdf(base);
    const narrow = await renderOfferPdf({ ...base, zones: { first: { textTop: 0.4, textBottom: 0.5 }, next: { textTop: 0.4, textBottom: 0.5 } } });
    expect(pages(narrow)).toBeGreaterThan(pages(wide));
  });

  it('карта отражает реальные размеры фотографии, ячеек и таблицы, не меняя прежние печатные потоки PDF', async () => {
    const jpeg = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#102030' } }).jpeg().toBuffer();
    const base = { number: 'КП-1', date: '2026-11-06', customer: 'Школа', objectName: 'Парк', terms: 'Оплата',
      items: [{ ...item(1), photoMm: 30, description: 'Монтаж на площадке' }],
      total: 3001, vatMode: 'without' as const, vatRate: 22, bg1: null, bg2: null, photos: new Map([[0, jpeg]]) };
    const original = await renderOfferPdf(base);
    const geometry = new OfferGeometry();
    const same = await renderOfferPdf({ ...base, geometry, layout: { blocks: [...OFFER_BLOCKS], texts: [] } });
    const streams = (p: Buffer) => p.toString('latin1').match(/\bstream\r?\n[\s\S]*?\r?\nendstream/g);
    expect(streams(same)).toEqual(streams(original));
    const rect = (key: string) => geometry.pages[0].find((r) => r.key === key)!;
    expect(rect('photo').w).toBeCloseTo(30 * 72 / 25.4, 0);
    expect(rect('photo').h).toBeCloseTo(rect('photo').w / 2, 0);
    expect(rect('photo').y).toBeGreaterThan(rect('row').y);
    expect(rect('description').y).toBeGreaterThan(rect('productName').y);
    expect(rect('date').x).toBeGreaterThan(rect('customer').x);
    expect(rect('table').w).toBe(rect('row').w);
    expect(rect('table').y).toBeLessThan(rect('row').y);
    for (const key of ['unit', 'unitPrice', 'quantity', 'total']) {
      expect(rect(key)).toMatchObject({ row: 0, h: rect('row').h, y: rect('row').y });
    }
  });

  it('продолжает свободный текст на нескольких листах и сохраняет порядок других блоков', async () => {
    const geometry = new OfferGeometry(), pageMap = newOfferPageMap();
    await renderOfferPdf({ geometry, pageMap, number: 'КП-1', date: '2026-11-06', customer: 'Школа',
      items: [item(1)], total: 3001, vatMode: 'without', vatRate: 0, bg1: null, bg2: null, photos: new Map(),
      zones: { first: { textTop: 0.2, textBottom: 0.32 }, next: { textTop: 0.2, textBottom: 0.32 } },
      layout: { blocks: ['text:before', 'table', 'text:after', 'info', 'terms', 'notes'],
        texts: [{ id: 'before', text: 'Строка текста перед таблицей. '.repeat(55) }, { id: 'after', text: 'Текст после таблицы' }] } });
    const pagesWithText = geometry.pages.filter((page) => page.some((r) => r.key === 'text:before'));
    expect(pagesWithText.length).toBeGreaterThan(1);
    expect(pageMap.blocks['text:before']).toBe(1);
    expect(pageMap.blocks.table).toBeGreaterThanOrEqual(pagesWithText.length);
    expect(pageMap.blocks['text:after']).toBeGreaterThanOrEqual(pageMap.rows[0]);
  });

  it('для 300 строк передаёт ограниченный заголовок, а геометрию выбранного листа можно получить отдельно', async () => {
    const geometry = new OfferGeometry();
    await renderOfferPdf({ geometry, number: 'КП-1', date: '2026-11-06', customer: 'Школа',
      items: Array.from({ length: 300 }, (_, k) => ({ ...item(k), rowMm: 9 + k % 17 })),
      total: 1, vatMode: 'without', vatRate: 22, bg1: null, bg2: null, photos: new Map() });
    const unpack = (str: string) => JSON.parse(gunzipSync(Buffer.from(str, 'base64')).toString());
    const complete = unpack(geometry.header(900));
    expect(complete).toMatchObject({ paged: true, pages: [] });
    const key = String(geometry.pages.length);
    const selected = unpack(geometry.header(900, key));
    expect(selected.pages[0]).toEqual(geometry.pages[geometry.pages.length - 1]);
    expect(selected.revision).toBe(complete.revision);
    expect(geometry.pages.every((_, n) => geometry.header(900, String(n + 1)).length < 2200)).toBe(true);
  });
});
