import { buildIndex, matchRow, nameKey, specGroupName, type SpecMaterial } from './stock-match';
import { hangingReason } from './stock-hanging';

const mat = (id: string, name: string, extra: Partial<SpecMaterial> = {}): SpecMaterial => ({ id, name, unit: 'шт', ...extra });

describe('stock-spec: сопоставление строк', () => {
  const idx = buildIndex([
    mat('1', 'Болт мебельный М6×40', { article: 'BM-640' }),
    mat('2', 'Гайка М10', { sku: 'RAS-10' }),
    mat('3', 'Труба 40х20х2', { unit: 'м' }),
    mat('4', 'Шайба 8'), mat('5', 'шайба  8'),
  ]);

  it('по коду — точно, без учёта регистра и похожих букв', () => {
    const m = matchRow(idx, { code: 'bm-640', name: 'что угодно' });
    expect(m).toMatchObject({ kind: 'matched', by: 'code', material: { id: '1' } });
  });
  it('по наименованию: × / x / х, регистр, пробелы не важны', () => {
    expect(matchRow(idx, { name: 'болт мебельный m6x40' })).toMatchObject({ kind: 'matched', by: 'name', material: { id: '1' } });
    expect(matchRow(idx, { name: 'Труба 40×20×2', unit: 'м.' })).toMatchObject({ kind: 'matched', material: { id: '3' } });
  });
  it('внутренний код (sku) тоже находится', () => expect(matchRow(idx, { code: 'RAS-10', name: '' })).toMatchObject({ kind: 'matched', material: { id: '2' } }));
  it('нет такой позиции — не найдено (новую не создаём)', () => expect(matchRow(idx, { name: 'Уголок 50' })).toEqual({ kind: 'none' }));
  it('несколько подходящих — неоднозначно, первую не берём', () => {
    const m = matchRow(idx, { name: 'Шайба 8' });
    expect(m.kind).toBe('ambiguous');
    expect(m.kind === 'ambiguous' && m.candidates.map((c) => c.id)).toEqual(['4', '5']);
  });
  it('другая единица — отдельный статус', () => expect(matchRow(idx, { name: 'Труба 40х20х2', unit: 'шт' })).toMatchObject({ kind: 'unit', material: { id: '3' } }));
  it('единица не указана — не сверяется', () => expect(matchRow(idx, { name: 'Гайка М10' }).kind).toBe('matched'));
  it('nameKey: латинская и русская M одинаковы', () => expect(nameKey('M10 гайка')).toBe(nameKey('М10 Гайка')));
  it('имя брони загрузки — «Спецификация <дата>»', () => expect(specGroupName(new Date(2026, 9, 24))).toMatch(/^Спецификация 24\.10\.2026$/));
});

describe('hangingReason: «висящая» бронь (СК-6)', () => {
  const id = 'o1';
  it('отгружен / закрыт / аннулирован — висит', () => {
    expect(hangingReason({ stage: 'shipped' }, id)).toBe('Заказ отгружен');
    expect(hangingReason({ stage: 'closed' }, id)).toBe('Заказ закрыт');
    expect(hangingReason({ stage: 'cancelled' }, id)).toBe('Заказ аннулирован');
  });
  it('в работе — не висит', () => {
    expect(hangingReason({ stage: 'production' }, id)).toBeNull();
    expect(hangingReason({ stage: 'new' }, id)).toBeNull();
  });
  it('заказ удалён или пропал — висит', () => {
    expect(hangingReason({ stage: 'new', deletedAt: new Date() }, id)).toBe('Заказ удалён');
    expect(hangingReason(null, id)).toBe('Заказ удалён');
  });
  it('бронь без заказа — не висит', () => expect(hangingReason(null, undefined)).toBeNull());
});
