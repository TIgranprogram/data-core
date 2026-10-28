import { ISSUED_GATE, ORDERED_GATE, missing, splitAmount } from './supply-invoice-rules';

describe('splitAmount', () => {
  it('делит пропорционально, остаток копеек — последней строке', () => {
    const r = splitAmount(100, [1, 1, 1]);
    expect(r).toEqual([33.33, 33.33, 33.34]);
    expect(r.reduce((s, x) => s + x, 0)).toBeCloseTo(100, 2);
  });
  it('по весам строк', () => {
    expect(splitAmount(1000, [100, 300])).toEqual([250, 750]);
  });
  it('нулевые веса — поровну; пусто — пусто', () => {
    expect(splitAmount(10, [0, 0])).toEqual([5, 5]);
    expect(splitAmount(10, [])).toEqual([]);
  });
});

describe('ворота', () => {
  it('«заказал»: поставщик, количество, единица', () => {
    expect(missing(ORDERED_GATE, { qty: 0 })).toEqual(['Поставщик', 'Количество', 'Единица измерения']);
    expect(missing(ORDERED_GATE, { supplierId: 'x', qty: 2, unit: 'шт' })).toEqual([]);
  });
  it('«выставлен»: №, дата, сумма', () => {
    expect(missing(ISSUED_GATE, { no: ' ' })).toEqual(['№ счёта', 'Дата счёта', 'Сумма счёта']);
    expect(missing(ISSUED_GATE, { no: '12', date: new Date(), amount: 5 })).toEqual([]);
  });
});
