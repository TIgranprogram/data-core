import { specRows } from './passport-pdf-v2-layout';

const base = { height: 860, length: 1500, width: 610, weight: 37 };
const rows = (p: object) => Object.fromEntries(specRows(p as never));

describe('Таблица размеров паспорта (ПЧ-4)', () => {
  it('черновик: буквы и объём из габаритов', () => {
    const r = rows({ ...base, status: 'draft', seatWidth: 470 });
    expect(r['Длина (L), мм']).toBe(1500);
    expect(r['Ширина посадки (Bп), мм']).toBe(470);
    expect(r['Объём перевозки (V), куб. м']).toBe(0.79);
  });
  it('вписанный объём важнее расчётного', () => {
    expect(rows({ ...base, status: 'draft', shipVolume: 1 })['Объём перевозки (V), куб. м']).toBe(1);
  });
  it('выпущенный без новых полей печатается как раньше', () => {
    expect(Object.keys(rows({ ...base, status: 'issued' }))).toEqual(['Высота, мм', 'Длина, мм', 'Ширина, мм', 'Вес, кг']);
  });
  it('выпущенный с новыми полями — с буквами', () => {
    expect(rows({ ...base, status: 'issued', supports: 2 })['Количество опор, шт']).toBe(2);
  });
});
