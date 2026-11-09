import { renderPassportPdfV2, type PdfV2Input, type PdfV2Text } from './passport-pdf-v2';

/** C054 B3: раскладка 2 (нумерация одним проходом, монтаж внутри раздела текста) собирается без ошибок; прежние снимки — как раньше. */
const TEXT: PdfV2Text = {
  sections: [
    { key: 'general', number: '3', title: 'Общие указания', items: [{ key: 'p1', number: '3.1', bullet: false, text: 'Паспорт содержит сведения об изделии.' }] },
    { key: 'mounting', number: '4', title: 'Монтаж', items: [{ key: 'p1', number: '4.1', bullet: false, text: 'Монтаж выполняют по схеме.' }, { key: 'p2', number: null, bullet: true, text: '— использовать перчатки;' }] },
  ],
  description: 'Решётка приствольная.', purpose: 'Защита корней дерева.', rules: ['Не ставить тяжёлые предметы'],
  maintenance: [{ period: 'ежегодно', rows: [{ what: 'Целостность', where: 'Решётка', measure: 'Осмотр', tolerance: 'Без трещин' }] }],
  install: { text: 'Уложить на выровненное основание', requirements: ['Ровное плотное основание'], requiredImages: [] },
};
const BASE: PdfV2Input = {
  passport: { passportNumber: '701', warrantyCode: '202611-701', productCode: 'РП-1', name: 'Решётка', height: 20, length: 1000, width: 1000, weight: 30, warrantyMonths: 12, serviceLifeYears: 10, passportCategory: 'BLG' },
  org: { name: 'ООО «СпортИнЮг»', shortName: 'СпортИнЮг', inn: '2310181417', trademark: 'STREET IRON', directorName: 'Тен А.Т.' },
  text: TEXT, images: {}, withStamp: false, mode: 'pages',
};

describe('PDF v2: раскладка 2', () => {
  it('layout 2 с разделом «Монтаж» и без него, и прежний снимок собираются в PDF', async () => {
    const withMounting = await renderPassportPdfV2({ ...BASE, text: { ...TEXT, layout: 2 } });
    const withoutMounting = await renderPassportPdfV2({ ...BASE, text: { ...TEXT, layout: 2, sections: [TEXT.sections[0]] } });
    const old = await renderPassportPdfV2(BASE);
    for (const pdf of [withMounting, withoutMounting, old]) expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });
});
