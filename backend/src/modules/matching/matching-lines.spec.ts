import { isMatched, isUnassigned, lineState } from './matching-rules';

describe('сопоставление: типы позиций (ORDER-LINES)', () => {
  it('услуга всегда сопоставлена', () => {
    expect(lineState({ lineType: 'service' })).toBe('none');
    expect(isMatched({ lineType: 'service', matchStatus: 'auto' })).toBe(true);
    expect(isUnassigned({ lineType: 'service' })).toBe(false);
  });

  it('новое изделие без изделия — «ждёт заявку», не сопоставлено и не распределено', () => {
    expect(lineState({ lineType: 'new_product' })).toBe('request');
    expect(isMatched({ lineType: 'new_product' })).toBe(false);
    expect(isUnassigned({ lineType: 'new_product' })).toBe(true);
  });

  it('после подтверждения заявки позиция — обычное изделие', () => {
    const l = { lineType: 'product', productId: 'p', matchStatus: 'confirmed' };
    expect(lineState(l)).toBe('confirmed');
    expect(isUnassigned(l)).toBe(false);
  });

  it('старые позиции без типа считаются как раньше', () => {
    expect(lineState({})).toBe('unmatched');
    expect(isUnassigned({})).toBe(true);
    expect(isUnassigned({ matchStatus: 'none' })).toBe(false);
    expect(isUnassigned({ productId: 'p' })).toBe(false);
    expect(lineState({ productId: 'p' })).toBe('legacy');
  });
});
