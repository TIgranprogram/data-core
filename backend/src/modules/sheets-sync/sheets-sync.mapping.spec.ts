import { SHEET_MAPS, normalizeCell, sheetToRows, slugHeader } from './sheets-sync.mapping';
import { parseSpreadsheetId } from './sheets-sync.service';

const map = (sheet: string) => SHEET_MAPS.find((m) => m.sheet === sheet)!;

describe('sheets-sync mapping', () => {
  it('normalizeCell: пустое, числа, даты', () => {
    expect(normalizeCell('  ')).toBeUndefined();
    expect(normalizeCell(null)).toBeUndefined();
    expect(normalizeCell(5)).toBe(5);
    expect(normalizeCell(' Болт ')).toBe('Болт');
    expect(normalizeCell('18.10.2026')).toBe('2026-10-18');
    expect(normalizeCell('18.10.2026 9:05:00')).toBe('2026-10-18T09:05:00');
  });

  it('slugHeader — транслит как в Apps Script', () => {
    expect(slugHeader('Тип движения')).toBe('tipDvizheniya');
    expect(slugHeader('1 шт')).toBe('f1Sht');
  });

  it('Снабжение: ключ — «№», пропуск пустых строк и колонки «Фото»', () => {
    const { rows, sheetFields } = sheetToRows([
      ['№', 'Наименование', 'Фото', 'Новая колонка'],
      [1, 'Болт', '=IMAGE()', 'x'],
      [2, '', '', ''],
      [3, 'Гайка', '', ''],
    ], map('Снабжение'));
    expect(rows.map((r) => r.key)).toEqual(['1', '3']);
    expect(rows[0].doc).toEqual({ num: 1, name: 'Болт', novayaKolonka: 'x' });
    expect(sheetFields).toEqual(['num', 'name', 'novayaKolonka']);
  });

  it('Склад: заголовок в 6-й строке, ключ — наименование без регистра; повтор имени → #2', () => {
    const values = [[], [], [], [], [], ['Наименование ТМЦ', 'Текущий остаток'], [' Болт  М8', 5], ['болт м8', 7]];
    const { rows } = sheetToRows(values, map('Склад'));
    expect(rows.map((r) => r.key)).toEqual(['болт м8', 'болт м8#2']);
  });

  it('Движение склада: ключ «№», поля журнала', () => {
    const { rows } = sheetToRows([
      ['№', 'Дата', 'Тип операции', 'Наименование ТМЦ', 'Кол-во', ''],
      [1, '25.09.2026', 'Ввод начального остатка', 'Гайка M8', 746, ''],
      [2, '25.09.2026', 'Приход', 'Болт M8', 10, ''],
    ], map('Движение склада'));
    expect(rows.map((r) => r.key)).toEqual(['1', '2']);
    expect(rows[0].doc).toEqual({ num: 1, date: '2026-09-25', operation: 'Ввод начального остатка', itemName: 'Гайка M8', qty: 746 });
  });

  it('ключ по содержимому (rowKey: null): одинаковые строки различаются', () => {
    const m = { ...map('Движение склада'), rowKey: null };
    const { rows } = sheetToRows([['Наименование ТМЦ', 'Кол-во'], ['Болт', 1], ['Болт', 1], ['Гайка', 2]], m);
    expect(rows[0].key).not.toBe(rows[2].key);
    expect(rows[1].key).toBe(`${rows[0].key}#2`);
  });

  it('нет обязательной колонки → понятная ошибка', () => {
    expect(() => sheetToRows([['№', 'Имя']], map('Снабжение'))).toThrow('нет колонки «Наименование»');
  });

  it('parseSpreadsheetId — из ссылки и голого id', () => {
    expect(parseSpreadsheetId('https://docs.google.com/spreadsheets/d/1AbC_defGHIjklMNOpqrSTUvwxYZ012345/edit#gid=0')).toBe('1AbC_defGHIjklMNOpqrSTUvwxYZ012345');
    expect(parseSpreadsheetId('1AbC_defGHIjklMNOpqrSTUvwxYZ012345')).toBe('1AbC_defGHIjklMNOpqrSTUvwxYZ012345');
    expect(parseSpreadsheetId('https://example.com')).toBeNull();
  });
});
