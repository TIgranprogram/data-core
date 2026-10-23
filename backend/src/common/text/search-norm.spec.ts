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

import { skuKey, skuRegex, tokensFilter } from './search-norm';
describe('артикул и поиск в списках', () => {
  it('skuKey: регистр, похожие буквы, пробелы по краям — тот же; дефис значим', () => {
    expect(skuKey(' KC-01 ')).toBe(skuKey('кс-01'));
    expect(skuKey('А-1')).not.toBe(skuKey('А1'));
  });
  it('skuRegex находит тот же артикул в БД и не находит похожий', () => {
    const re = skuRegex('KC-01');
    expect(re.test('КС-01')).toBe(true);
    expect(re.test(' кс-01 ')).toBe(true);
    expect(re.test('КС-011')).toBe(false);
    expect(skuRegex('a.b(1)').test('А.В(1)')).toBe(true);
  });
  it('tokensFilter: слова в любом порядке, каждое — в одном из полей', () => {
    const f = tokensFilter('двойные качели', ['name', 'sku'])!;
    expect(f.$and).toHaveLength(2);
    expect(((f.$and[0].$or as Record<string, RegExp>[])[0].name).test('Качели ДВОЙНЫЕ')).toBe(true);
    expect(tokensFilter('  ', ['name'])).toBeNull();
  });
});
