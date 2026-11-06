import { renderOfferPdf, money, rub } from './offer-pdf';

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
});
