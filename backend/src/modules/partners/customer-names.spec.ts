import { normName, splitCustomer, uniqueNames } from './customer-names';

describe('customer-names (ЗЧ.1–ЗЧ.2)', () => {
  it('normName: регистр, ё, кавычки, пробелы', () => {
    expect(normName('  ООО  «Академия  Благоустройства» ')).toBe(normName('ооо академия благоустройства'));
    expect(normName('Ёлка')).toBe('елка');
  });
  it('uniqueNames: дубли написания сливаются, побеждает название контрагента, по алфавиту', () => {
    expect(uniqueNames(['ИП Сахаджи'], ['ип  сахаджи', 'Академия благоустройства', '', null])).toEqual(['Академия благоустройства', 'ИП Сахаджи']);
  });
  it('splitCustomer: «заказчик, объект» → два поля; без запятой — null', () => {
    expect(splitCustomer('ИП Сахаджи, Академия благоустройства')).toEqual({ customer: 'ИП Сахаджи', object: 'Академия благоустройства' });
    expect(splitCustomer('ИП Сахаджи')).toBeNull();
    expect(splitCustomer(', объект')).toBeNull();
  });
});
