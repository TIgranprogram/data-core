import { normOrderNo, normTitle, orderKey } from './order-key';

describe('order-key: ключ заказа «компания|номер»', () => {
  it('номер: без «№», пробелы схлопнуты, верхний регистр', () => {
    expect(normOrderNo('№11 Крыловская')).toBe('11 КРЫЛОВСКАЯ');
    expect(normOrderNo(' № 110-п ')).toBe('110-П');
    expect(normOrderNo(34)).toBe('34');
    expect(normOrderNo(undefined)).toBe('');
  });

  it('ключ различает компании и не зависит от записи номера', () => {
    expect(orderKey('СИЮ', '№ 2')).toBe('СИЮ|2');
    expect(orderKey('ссю', '2')).toBe('ССЮ|2');
    expect(orderKey('СИЮ', '№2')).not.toBe(orderKey('ССЮ', '№2'));
    expect(orderKey('', '14')).toBe('|14');
  });

  it('наименование: регистр, ё и пробелы не важны', () => {
    expect(normTitle('  Флагшток  стальной h 8м ')).toBe(normTitle('флагшток стальной H 8м'));
    expect(normTitle('Тренажёр')).toBe('тренажер');
  });
});
