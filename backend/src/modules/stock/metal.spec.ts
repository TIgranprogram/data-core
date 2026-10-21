import { dimsOf, mergeDims, metalKind, offcutName, pipeMeters } from './metal';

describe('metal (СМ.1–СМ.2)', () => {
  it('вид по категории: труба / лист / прочее', () => {
    expect(metalKind('Профильная труба', 'м')).toBe('pipe');
    expect(metalKind('Лист г/к', 'лист')).toBe('sheet');
    expect(metalKind('Метизы', 'лист')).toBe('sheet');
    expect(metalKind('Метизы', 'шт')).toBeNull();
  });

  it('размеры: из массива схемы и правка (null — убрать, undefined — не трогать)', () => {
    const cur = [{ type: 'length', value: 6000 }, { type: 'thickness', value: 2 }, { type: 'height', value: 5 }];
    expect(dimsOf(cur)).toEqual({ length: 6000, thickness: 2 });
    expect(mergeDims(cur, { thickness: null, width: 1250 })).toEqual([{ type: 'length', value: 6000, isImmutable: false }, { type: 'width', value: 1250, isImmutable: false }]);
  });

  it('название обрезка: труба в метрах, лист — формат', () => {
    expect(offcutName('Труба 40×20×2', 'pipe', 1200)).toBe('Труба 40×20×2 — обрезок 1,2 м');
    expect(offcutName('Лист 2 мм', 'sheet', 1000, 500)).toBe('Лист 2 мм — обрезок 1×0,5 м');
  });

  it('приход хлыстами: 10 по 6 м = 60 м', () => {
    expect(pipeMeters(10, 6)).toBe(60);
    expect(pipeMeters(3, 5.85)).toBe(17.55);
  });
});
