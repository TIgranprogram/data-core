import { attentionRank, freeQty } from './stock-rank';

describe('freeQty', () => {
  it('остаток минус бронь', () => expect(freeQty(10, 4)).toBe(6));
  it('бронь больше остатка — ноль, не минус', () => expect(freeQty(3, 5)).toBe(0));
  it('пустые значения — ноль', () => expect(freeQty(undefined as unknown as number, 0)).toBe(0));
  it('остаток = в брони + свободно, пока бронь не больше остатка', () => {
    const q = 12, r = 5;
    expect(r + freeQty(q, r)).toBe(q);
  });
});

describe('attentionRank', () => {
  it('сначала заканчивается, потом в брони, потом остальное', () => {
    const rows = [
      { n: 'a', status: 'ok', reservedQty: 0 },
      { n: 'b', status: 'ok', reservedQty: 2 },
      { n: 'c', status: 'low', reservedQty: 0 },
      { n: 'd', status: 'low', reservedQty: 3 },
    ];
    const sorted = [...rows].sort((x, y) => attentionRank(x) - attentionRank(y)).map((r) => r.n);
    expect(sorted).toEqual(['c', 'd', 'b', 'a']);
  });
});
