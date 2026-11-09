import { renderTechSheetPdf } from './tech-sheet-pdf';

const boxes = (b: Buffer) => [...b.toString('latin1').matchAll(/\/MediaBox \[([^\]]+)\]/g)].map((m) => m[1].replace(/\s+/g, ' ').trim());

describe('Техническое описание: PDF', () => {
  it('собирается без фото', async () => {
    const buf = await renderTechSheetPdf({ title: 'Тренажёр', rows: [{ name: 'Стойка', text: 'Труба стальная, толщина стенки не менее 2 и не более 4 мм' }], photo: null });
    expect(buf.subarray(0, 4).toString()).toBe('%PDF');
    expect(boxes(buf).every((x) => x === '0 0 595.28 841.89')).toBe(true);
  });
  it('длинная таблица переходит на следующий лист', async () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ name: `Часть ${i}`, text: 'Описание с допусками и материалом '.repeat(3) }));
    const one = await renderTechSheetPdf({ title: 'Т', rows: rows.slice(0, 2), photo: null });
    const many = await renderTechSheetPdf({ title: 'Т', rows, photo: null });
    expect(many.length).toBeGreaterThan(one.length);
  });
});
