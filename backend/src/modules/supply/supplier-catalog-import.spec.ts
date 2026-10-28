import 'reflect-metadata';
import { ROLES_KEY } from '../../common/decorators/roles.decorator';
import { SupplyController } from './supply.controller';
import { classifyRow, cleanInn, itemKey, normColor, parseDate, parsePrice, parseSheet } from './supplier-catalog-import';

const HEAD = ['Артикул поставщика*', 'Название у поставщика*', 'Цвет', 'Ед. изм.', 'Цена', 'Дата цены', 'Группа', 'Наш артикул', 'Наше название', 'Примечание'];

describe('каталог поставщиков: разбор листа', () => {
  it('строки без артикула и названия — с ошибками, остальные чистые', () => {
    const { rows, headerRow } = parseSheet([
      ['Прайс от 01.10'], HEAD,
      ['A-1', 'Труба', 'серый', 'м', '120,50 р.', '01.10.2026', 'Металл', 'N-1', '', ''],
      ['', 'Без артикула', '', '', 10],
      ['A-3', '', '', '', 5],
      ['A-4', 'Уголок', '—', '', 'много'],
      [],
      ['Итого', '', '', '', 100],
    ]);
    expect(headerRow).toBe(1);
    expect(rows.map((r) => r.rowNum)).toEqual([3, 4, 5, 6]);
    expect(rows[0]).toMatchObject({ article: 'A-1', price: 120.5, color: 'серый', ourArticle: 'N-1', errors: [] });
    expect(rows[0].priceDate?.toISOString().slice(0, 10)).toBe('2026-10-01');
    expect(rows[1].errors).toEqual(['нет артикула поставщика']);
    expect(rows[2].errors).toEqual(['нет названия']);
    expect(rows[3].errors).toEqual(['цена не число']);
    expect(rows[3].color).toBe('');
  });

  it('старый прайс (7 колонок) принимается', () => {
    const { rows } = parseSheet([['№', 'Артикул', 'Описание', 'Цвет', 'Кол-во', 'Оптовая группа', 'Цена за 1 штуку'], [1, 'X', 'Болт', '', 5, 'Крепёж', '8 200 р.']]);
    expect(rows[0]).toMatchObject({ article: 'X', name: 'Болт', optGroup: 'Крепёж', price: 8200 });
  });

  it('нет колонки «Артикул» — headerRow -1', () => {
    expect(parseSheet([['Название', 'Цена'], ['a', 1]]).headerRow).toBe(-1);
  });

  it('цена, дата, цвет, ИНН', () => {
    expect(parsePrice('640,00 р.')).toBe(640);
    expect(parsePrice('abc')).toBeNull();
    expect(parsePrice(-5)).toBeNull();
    expect(parseDate('31.02.2026')).toBeNull();
    expect(parseDate('2026-10-05')?.toISOString().slice(0, 10)).toBe('2026-10-05');
    expect(normColor(' - ')).toBe('');
    expect(cleanInn('БЕЗ-ИНН-123')).toBe('');
    expect(cleanInn('7701234567')).toBe('7701234567');
    expect(itemKey('A-1', '—')).toBe(itemKey('a-1', ''));
  });
});

describe('каталог поставщиков: статус строки', () => {
  const row = (p = {}) => ({ ...parseSheet([HEAD, ['A', 'Имя', '', 'шт', 10, '', 'G', '', '', 'n']]).rows[0], ...p });
  const ex = { name: 'Имя', unit: 'шт', optGroup: 'G', note: 'n', priceHint: 10, materialId: null };

  it('новая / без изменений / цена / правка / ошибка', () => {
    expect(classifyRow(row(), undefined, null)).toBe('new');
    expect(classifyRow(row(), ex, null)).toBe('same');
    expect(classifyRow(row({ price: 11 }), ex, null)).toBe('price');
    expect(classifyRow(row({ name: 'Другое' }), ex, null)).toBe('update');
    expect(classifyRow(row(), ex, 'm1')).toBe('update');
    expect(classifyRow(row({ errors: ['x'] }), ex, null)).toBe('error');
  });
});

describe('каталог поставщиков: права', () => {
  const roles = (m: keyof SupplyController) => Reflect.getMetadata(ROLES_KEY, SupplyController.prototype[m] as object) as string[];

  it('просмотр и экспорт — все роли раздела', () => {
    for (const m of ['catalogList', 'catalogCounts', 'catalogTemplate', 'catalogExport'] as const) expect(roles(m)).toEqual(['admin', 'director', 'manager', 'user']);
  });

  it('импорт, правка, привязка, удаление — только admin и manager', () => {
    for (const m of ['catalogImport', 'catalogCreate', 'catalogBulk', 'catalogPatch', 'catalogRemove'] as const) expect(roles(m)).toEqual(['admin', 'manager']);
  });
});
