import PDFDocument from 'pdfkit';
import { renderOfferPdf } from '../../modules/offers/offer-pdf';
import { renderShipmentPdf } from '../../modules/shipments/shipment-pdf';
import { renderTechSheetPdf } from '../../modules/showcase/tech-sheet-pdf';
import { renderPassportPdfV2, renderStandPdf } from '../../modules/product-passport/passport-pdf-v2';
import { hasLeak } from './fill-text';

/** Каждый печатный документ с «дырявыми» данными: в doc.text() не доходит ни «{…}», ни undefined/null/NaN. */
const calls: string[] = [];
let spy: jest.SpyInstance;
beforeEach(() => {
  calls.length = 0;
  spy = jest.spyOn(PDFDocument.prototype as never, 'text').mockImplementation(function (this: unknown, t: unknown) { calls.push(String(t)); return this; } as never);
});
afterEach(() => spy.mockRestore());
const clean = () => { expect(calls.length).toBeGreaterThan(0); expect(calls.filter(hasLeak)).toEqual([]); };

describe('печать документов: нет утечек меток и пустот', () => {
  it('КП', async () => {
    await renderOfferPdf({ number: 'КП-1', date: '2026-10-30', customer: '{customer}', items: [{ productName: 'undefined', quantity: 1, total: NaN } as never], total: NaN,
      terms: 'Оплата {pay}', bg1: null, bg2: null, photos: new Map() });
    clean();
  });
  it('накладная на отгрузку', async () => {
    await renderShipmentPdf({ number: '1', date: 'bad', orderNo: String(undefined), org: { name: 'Орг' }, customer: { name: '{customer}' },
      rows: [{ n: 1, title: 'Урна', article: String(null), unit: 'шт', ordered: NaN, now: 1, after: 0 }], receiver: '{fio}' });
    clean();
  });
  it('техническое описание', async () => {
    await renderTechSheetPdf({ title: 'Изделие {name}', rows: [{ name: 'Стойка', text: String(undefined) }], photo: null });
    clean();
  });
  it('паспорт (книжка)', async () => {
    await renderPassportPdfV2({ passport: { passportNumber: '1', name: 'Изделие', passportCategory: 'DIO', bom: [] } as never, org: { name: 'Орг' } as never,
      text: { sections: [{ key: 's', number: '1', title: 'Раздел {x}', items: [{ key: 'p', number: '1.1', bullet: false, text: 'Срок {serviceLifeYears} лет, undefined' }] }], description: '', purpose: 'null', rules: [], maintenance: [], install: { text: '', requirements: [], requiredImages: [] } } as never,
      images: {}, style: { color: '#000', categoryName: 'К', icons: [] }, withStamp: false, mode: 'pages' } as never);
    clean();
  });
  it('паспорт (стенд)', async () => {
    await renderStandPdf({ passport: { name: '{name}', maxUsers: NaN } as never, org: null, text: { rules: ['Правило {x}', 'undefined'] } as never });
    clean();
  });
});
