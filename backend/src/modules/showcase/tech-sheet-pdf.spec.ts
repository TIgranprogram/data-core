import { renderTechSheetPdf } from './tech-sheet-pdf';

describe('Техническое описание: PDF', () => {
  it('собирается без фото', async () => {
    const buf = await renderTechSheetPdf({ title: 'Тренажёр', rows: [{ name: 'Стойка', text: 'Труба стальная, толщина стенки не менее 2 и не более 4 мм' }], photo: null });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
  });
  it('длинная таблица переходит на следующий лист', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ name: `Часть ${i}`, text: 'Описание с допусками и материалом '.repeat(3) }));
    const one = await renderTechSheetPdf({ title: 'Т', rows: rows.slice(0, 2), photo: null });
    const many = await renderTechSheetPdf({ title: 'Т', rows, photo: null });
    expect(many.length).toBeGreaterThan(one.length);
  });
});
