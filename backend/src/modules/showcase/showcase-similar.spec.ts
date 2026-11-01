import { rankSimilar, similarTokens } from './showcase-similar';

describe('похожие изделия', () => {
  it('слова: ё/е, регистр, знаки, «(копия)» и короткие слова отброшены', () => {
    expect(similarTokens('Турник  «Ёлочка» (копия), 2 м')).toEqual(['турник', 'елочка']);
    expect(similarTokens('')).toEqual([]);
  });
  it('порядок: точное → начало → остальное', () => {
    const r = rankSimilar([{ name: 'Большой турник' }, { name: 'Турник уличный' }, { name: 'турник' }], 'Турник');
    expect(r.map((x) => x.name)).toEqual(['турник', 'Турник уличный', 'Большой турник']);
  });
});
