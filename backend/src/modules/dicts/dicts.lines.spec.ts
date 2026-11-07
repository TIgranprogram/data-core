import { lines } from './dicts.defs';

describe('dicts: многострочные поля справочников сохраняют переносы строк', () => {
  it('переносы остаются, лишние пробелы внутри строки схлопываются', () => {
    expect(lines('Шаг 1   держаться\r\n  Шаг 2\tне висеть  \n\nШаг 3')).toBe('Шаг 1 держаться\nШаг 2 не висеть\n\nШаг 3');
  });
  it('пусто и одни пробелы — null', () => {
    expect(lines('')).toBeNull();
    expect(lines('  \n \n')).toBeNull();
    expect(lines(undefined)).toBeNull();
  });
  it('одна строка — как раньше', () => {
    expect(lines('  Турник  ')).toBe('Турник');
  });
});
