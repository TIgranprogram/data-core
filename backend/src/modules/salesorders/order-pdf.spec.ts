import { writeFileSync } from 'fs';
import sharp from 'sharp';
import { renderOrderPdf, routeText, type OrderPdfLine } from './order-pdf';

const photo = () => sharp({ create: { width: 120, height: 120, channels: 3, background: '#3fae6a' } }).png().toBuffer();

async function sample() {
  const pic = await photo();
  const lines: OrderPdfLine[] = Array.from({ length: 14 }, (_, k) => ({
    seqNo: k + 1, qty: k + 1, unit: 'шт', photo: k % 4 === 3 ? undefined : pic,
    title: k % 5 === 0 ? `Трибуна на 200 мест, 20,02 м, 6 рядов в высоту, подтрибунное пространство (вариант ${k + 1})` : `Качалка на пружине «Мотоцикл» ${k + 1}`,
    facts: [`арт. 54${String(k).padStart(2, '0')}`, k % 2 ? 'цвет: графит' : '', 'отгрузка 10.12.2026'].filter(Boolean),
    route: k % 3 === 2 ? [] : [{ name: 'Резка', state: 'done' }, { name: 'Сварка', state: k % 3 ? 'now' : 'done' }, { name: 'Покраска', state: 'next' }, { name: 'Сборка', state: 'next' }],
    workText: k % 3 === 2 ? 'маршрут не задан — запуск одной работой «Изготовление»' : undefined,
    designText: k % 2 ? 'Проектирование: в работе · Иванов Пётр' : 'Проектирование: готово (01.11.2026)',
    note: k === 1 ? 'Примечание: под размеры площадки, крепёж в комплекте' : undefined,
  }));
  return {
    number: '17-26', stageLabel: 'В производстве', customer: 'ИП Сахаджи', priority: 'срочно', productionDeadline: '2026-12-01', shipDate: '2026-12-10',
    summary: 'Позиций 14 · изделий 105 шт · в проектировании 7 · в работе 5 · изготовлено 0',
    org: { name: 'ООО «Спортивные игровые юнион»', inn: '7700000000', address: 'г. Москва, ул. Примерная, 1', phone: '+7 900 000-00-00' },
    contracts: [
      { orderNo: '34', contractDate: '2026-10-01', title: 'Детская площадка', stageLabel: 'В производстве', lines: lines.slice(0, 9) },
      { orderNo: '35', contractDate: '2026-10-05', title: 'Трибуны', stageLabel: 'Новый', lines: lines.slice(9) },
    ],
    printedAt: new Date('2026-11-06T10:00:00Z'),
  };
}

describe('Производственный лист заказа (А4)', () => {
  it('рендерит PDF с фото и маршрутами на нескольких страницах, без цен', async () => {
    const buf = await renderOrderPdf(await sample());
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect((buf.toString('latin1').match(/\/Type \/Page\b/g) || []).length).toBeGreaterThan(1);
    expect(buf.toString('latin1')).not.toMatch(/₽|Сумма|Цена/);
    if (process.env.ORDER_PDF_OUT) writeFileSync(process.env.ORDER_PDF_OUT, buf);
  });

  it('маршрут одной строкой отмечает текущий шаг', () => {
    expect(routeText([{ name: 'Сварка', state: 'done' }, { name: 'Покраска', state: 'now' }, { name: 'Сборка', state: 'next' }])).toBe('Сварка  →  Покраска (сейчас)  →  Сборка');
  });
});
