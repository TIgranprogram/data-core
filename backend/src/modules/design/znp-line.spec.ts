import { parseZnpLine } from './znp-line';

describe('parseZnpLine', () => {
  it('полная строка', () => {
    const s = parseZnpLine('19\n3216\n\nОграждение деревянное 28 м.п.\n1\nшт\n?х?х1200\nБетонирование\nНет\nСогласовать\nДля Экотропы 120 м.п. поз 18\n \nhttps://yougile.com/user-data/x/image.png');
    expect(s).toMatchObject({ qty: '1', unit: 'шт', size: '?х?х1200', mount: 'Бетонирование', cover: 'Нет', ral: 'Согласовать', extra: 'Для Экотропы 120 м.п. поз 18' });
  });
  it('RAL и кавычки в названии', () => {
    const s = parseZnpLine('2\n3904\n\n"Стела" Табло\n4\nшт\n1650х?х2200\nАнкер\nДа\nRAL 6005');
    expect(s).toMatchObject({ qty: '4', size: '1650х?х2200', mount: 'Анкер', ral: 'RAL 6005', extra: '' });
  });
  it('поле не совпало — пустое, без сдвига', () => {
    const s = parseZnpLine('1\n3903\n\nСтела\n8\nшт\n600х145х2200\nматериал: сталь\nНет\nСогласовать');
    expect(s).toMatchObject({ qty: '8', size: '600х145х2200', mount: '', cover: '', ral: '', extra: 'материал: сталь\nНет\nСогласовать' });
  });
  it('меньше трёх полей или не ЗНП — null', () => {
    expect(parseZnpLine('просто текст\nещё строка\nи ещё\nчетвёртая')).toBeNull();
    expect(parseZnpLine('1\n3903\n\nСтела\n8')).toBeNull();
    expect(parseZnpLine('[фото]')).toBeNull();
    expect(parseZnpLine(undefined)).toBeNull();
  });
});
