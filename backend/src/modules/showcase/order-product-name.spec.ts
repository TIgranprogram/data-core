import { productNameKey, shortProductName } from './order-product-name';

describe('shortProductName', () => {
  it('режет описание по «Цвет:»', () => {
    expect(shortProductName('Трибуны на 200 мест, 20,02 м Цвет: графит 6 рядов в высоту')).toBe('Трибуны на 200 мест, 20,02 м');
  });
  it('короткое название не меняет', () => {
    expect(shortProductName('  Качели  двойные ')).toBe('Качели двойные');
  });
  it('длинное без разделителей — по слову, до 120', () => {
    const s = shortProductName('слово '.repeat(40));
    expect(s.length).toBeLessThanOrEqual(120);
  });
  it('ключ без регистра и лишних пробелов', () => {
    expect(productNameKey(' Качели  ДВОЙНЫЕ ')).toBe('качели двойные');
  });
});
