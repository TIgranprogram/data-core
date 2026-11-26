import { coordinateGuard, coordinateMatch } from './stock-coordinate';
import type { StockCoordinateDto } from './stock-coordinate.dto';
import { mergeDims } from './metal';

const dto: StockCoordinateDto = { kind: 'pipe', name: 'Новая труба', categoryId: 'abcdefabcdefabcdefabcdef', unit: 'м', materialGrade: 'Ст3', washed: false,
  dims: { width: 40, height: 20, thickness: 2, length: 6000 } };
const material = { name: 'Старое имя', unit: 'М.', materialGrade: ' ст3 ', washed: false, dimensions: mergeDims([], dto.dims) };

describe('C274 — консервативная координата металла', () => {
  it('длина, профиль и форма получены из штатных полей, имя произвольно', () => {
    expect(coordinateMatch(dto, material)).toBe('exact');
    expect(coordinateMatch(dto, { ...material, materialGrade: 'st 3' })).toBe('exact');
    expect(coordinateMatch({ ...dto, materialGrade: 'AISI 304' }, { ...material, materialGrade: 'asi 304' })).toBe('exact');
    expect(coordinateMatch(dto, { ...material, dimensions: mergeDims([], { length: 6000 }), assortment: 'Труба 40 x 20 х 2' })).toBe('exact');
    expect(coordinateMatch(dto, { ...material, dimensions: mergeDims([], { length: 6000 }), assortment: '40×20' })).toBe('possible');
    expect(coordinateMatch(dto, { ...material, assortment: '40×30×2' })).toBe('possible');
    expect(coordinateMatch(dto, { ...material, dimensions: [...material.dimensions, { type: 'width', value: 50 }] })).toBe('possible');
    expect(coordinateMatch(dto, { ...material, dimensions: [{ type: 'length', value: 6, unit: 'м' }] })).toBe('possible');
  });
  it('ориентация, длина, известные марка, мойка и единица различают запасы', () => {
    for (const change of [{ unit: 'шт' }, { materialGrade: 'AISI 304' }, { washed: true }, { dimensions: mergeDims([], { length: 12000 }) },
      { dimensions: mergeDims([], { diameter: 40 }) }, { dimensions: mergeDims([], { width: 20, height: 40 }) }]) {
      expect(coordinateMatch(dto, { ...material, ...change })).toBe('different');
    }
  });
  it('неизвестная мойка, марка, единица и дополнительные признаки требуют сверки', () => {
    for (const change of [{ washed: null }, { washed: 'false' }, { materialGrade: null }, { unit: '' }, { unit: 'пог. м' }, { materialGrade: 'сталь общего назначения' }, { profileId: 'crm' },
      { typeName: 'Профиль' }, { surface: 'Гладкая' }, { assortment: 'ГОСТ нестандартный' }, { standardRef: '123' }, { coating: 'Цинк' }]) {
      expect(coordinateMatch(dto, { ...material, ...change })).toBe('possible');
    }
  });
  it('лист — толщина, ширина и длина, поверхность не вычисляется из имени', () => {
    const sheet: StockCoordinateDto = { ...dto, kind: 'sheet', washed: null, unit: 'лист', dims: { width: 1000, length: 2000, thickness: 3 } };
    const data = { ...material, unit: 'лист', dimensions: mergeDims([], sheet.dims) };
    expect(coordinateMatch(sheet, data)).toBe('exact');
    expect(coordinateMatch(sheet, { ...data, assortment: 'Лист 3,0 мм' })).toBe('exact');
    expect(coordinateMatch(sheet, { ...data, assortment: 'Лист 4 мм' })).toBe('possible');
    expect(coordinateMatch(sheet, { ...data, assortment: 'Лист рифлёный' })).toBe('possible');
    expect(coordinateMatch(sheet, { ...data, dimensions: mergeDims([], { width: 2000, length: 1000, thickness: 3 }) })).toBe('different');
  });
  it('ключ одинаков для разных имён и зон с общей категорией; округление при записи исключено', () => {
    expect(coordinateGuard(dto)).toBe(coordinateGuard({ ...dto, name: 'Другое', materialGrade: null, washed: null }));
    expect(coordinateGuard(dto)).not.toBe(coordinateGuard({ ...dto, categoryId: '123456789012345678901234' }));
    for (const dims of [{ ...dto.dims, diameter: 10 }, { ...dto.dims, width: 2 }, { ...dto.dims, thickness: 2.123 }, { length: 1 }]) {
      expect(() => coordinateGuard({ ...dto, dims })).toThrow();
    }
  });
});
