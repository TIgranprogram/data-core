import { matchesAll, normSearch, searchTokens } from './search-norm';

describe('поиск по складу (search-norm)', () => {
  const nut = 'Гайка шестигр., M10, DIN 934';
  const bolt = 'Болт с шестигр. головкой, M10х100, DIN 933';

  it('кириллическая «м10» находит латинскую M10', () => {
    expect(matchesAll(searchTokens('м10'), nut)).toBe(true);
    expect(matchesAll(searchTokens('М10'), bolt)).toBe(true);
  });

  it('слова в любом порядке, все обязательны', () => {
    expect(matchesAll(searchTokens('м10 гайк'), nut)).toBe(true);
    expect(matchesAll(searchTokens('гайка m10'), bolt)).toBe(false);
  });

  it('размер: х / x / × / * равны, «м 10» = «м10»', () => {
    expect(matchesAll(searchTokens('m10x100'), bolt)).toBe(true);
    expect(matchesAll(searchTokens('м10*100'), bolt)).toBe(true);
    expect(matchesAll(searchTokens('м 10 болт'), bolt)).toBe(true);
  });

  it('стандарт и артикул, регистр и ё не важны', () => {
    expect(matchesAll(searchTokens('din 933'), bolt)).toBe(true);
    expect(matchesAll(searchTokens('скл-2026'), 'Шуруп', 'СКЛ-2026-0001')).toBe(true);
    expect(normSearch('Ёлка')).toBe('елка');
  });

  it('пустой запрос подходит всем', () => {
    expect(matchesAll(searchTokens('  '), nut)).toBe(true);
  });
});
