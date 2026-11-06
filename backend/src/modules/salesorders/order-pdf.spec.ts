import { writeFileSync } from 'fs';
import { orderColumns, renderOrderPdf, ruMoney } from './order-pdf';

const lines = Array.from({ length: 34 }, (_, k) => ({
  seqNo: k + 1, title: k % 5 === 0 ? `Трибуна на 200 мест, 20,02 м, 6 рядов в высоту, подтрибунное пространство под размеры трибун (вариант ${k + 1})` : `Качалка на пружине «Мотоцикл» ${k + 1}`,
  note: k % 3 === 0 ? 'Цвет: графит · 1200×600' : undefined, sku: `54${String(k).padStart(2, '0')}`, qty: k + 1, unit: 'шт', price: 12500.5, amount: 12500.5 * (k + 1), shipDate: '2026-12-10',
}));
const input = (money: boolean) => ({
  number: '17-26', stageLabel: 'В производстве', customer: 'ИП Сахаджи', productionDeadline: '2026-12-01', shipDate: '2026-12-10',
  org: { name: 'ООО «Спортивные игровые юнион»', inn: '7700000000', address: 'г. Москва, ул. Примерная, 1', phone: '+7 900 000-00-00' },
  contracts: [
    { orderNo: '34', contractDate: '2026-10-01', title: 'Детская площадка', stageLabel: 'В производстве', lines: lines.slice(0, 20), paid: 50000 },
    { orderNo: '35', contractDate: '2026-10-05', title: 'Трибуны', stageLabel: 'Новый', lines: lines.slice(20) },
  ],
  money, printedAt: new Date('2026-11-06T10:00:00Z'),
});

describe('PDF заказа (А4)', () => {
  it('рендерит PDF с деньгами и без, несколько страниц', async () => {
    const withMoney = await renderOrderPdf(input(true));
    const noMoney = await renderOrderPdf(input(false));
    expect(withMoney.subarray(0, 4).toString()).toBe('%PDF');
    expect(noMoney.subarray(0, 4).toString()).toBe('%PDF');
    expect((withMoney.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
    if (process.env.ORDER_PDF_OUT) { writeFileSync(process.env.ORDER_PDF_OUT, withMoney); writeFileSync(process.env.ORDER_PDF_OUT.replace(/\.pdf$/, '-nomoney.pdf'), noMoney); }
  });

  it('колонки «Цена» и «Сумма» — только с деньгами; сумма по-русски', () => {
    expect(orderColumns(true).map((c) => c[0])).toContain('Сумма');
    expect(orderColumns(false).map((c) => c[0])).not.toContain('Цена');
    expect(ruMoney(1234567.5)).toBe('1 234 567,50');
  });
});
