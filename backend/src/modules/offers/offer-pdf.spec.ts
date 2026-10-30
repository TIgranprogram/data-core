import { renderOfferPdf, money } from './offer-pdf';

const item = (n: number) => ({ productName: `Урна «Парк» № ${n}`, productSku: `U-${n}`, color: 'серый', quantity: 2, unit: 'шт', unitPrice: 1500.5, total: 3001 });

describe('КП: PDF', () => {
  it('формат денег', () => {
    expect(money(1234567.5)).toBe('1 234 567,50');
    expect(money(null)).toBe('');
  });

  it('40 строк без фонов — валидный PDF на нескольких страницах', async () => {
    const buf = await renderOfferPdf({
      number: 'КП-2026-001', date: '2026-10-30', validUntil: '2026-11-15', customer: 'ООО «Школа»', companyName: 'СпортИН-ЮГ',
      items: Array.from({ length: 40 }, (_, i) => item(i + 1)), total: 120040, prepaymentPercent: 50, productionDays: 14, deliveryDays: 3,
      terms: 'Цены без НДС.\nОплата по счёту.', notes: 'Монтаж отдельно', bg1: null, bg2: null, photos: new Map(),
    });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    const pages = (buf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
    expect(pages).toBeGreaterThanOrEqual(3);
  });
});
