import { composeMaterialsText, joinRu, matchMaterial, normSize, specFromComposition, type MatRec, type PartRec } from './materials-text';

/** МИ.3: сборка текста «Изготовлено из…» по таблице материалов изделия; МИ.2: «Взять из состава». */
const mats = new Map<string, MatRec>([
  ['pipe', { name: 'Труба стальная', code: 'PIPE_STEEL', kind: 'material', genSingular: 'стальной трубы', genPlural: 'стальных труб', sizeTemplate: '{sizes} мм' }],
  ['sheet', { name: 'Лист стальной', code: 'SHEET_STEEL', kind: 'material', genSingular: 'стального листа', genPlural: 'стальных листов', sizeTemplate: 'толщиной {sizes} мм' }],
  ['concrete', { name: 'Бетон', code: 'CONCRETE', kind: 'material', genSingular: 'бетона', genPlural: 'бетона', sizeTemplate: '' }],
  ['old', { name: 'Сталь с покрытием', madeOf: 'стали с порошковым покрытием' }],
  ['powder', { name: 'Порошковая окраска', kind: 'coating', phrase: 'Окрашено порошковой краской методом запекания в заводских условиях.' }],
  ['oil', { name: 'Масло для древесины', kind: 'coating', phrase: 'Древесина покрыта маслом' }],
]);
const parts = new Map<string, PartRec>([
  ['post', { name: 'Стойка', genSingular: 'стойки', genPlural: 'стоек' }],
  ['bar', { name: 'Перекладина', genSingular: 'перекладины', genPlural: 'перекладин' }],
  ['clamp', { name: 'Хомут', genSingular: 'хомута', genPlural: 'хомутов' }],
]);
const text = (rows: { materialId: string; sizes?: string[]; partIds?: string[] }[], coatingIds: string[] = []) =>
  composeMaterialsText({ rows: rows.map((r) => ({ sizes: [], partIds: [], ...r })), coatingIds }, mats, parts);

describe('сборка текста материалов (МИ.3)', () => {
  it('пример из ТЗ: размеры одного материала объединяются, части без дублей, покрытие — его фраза', () => {
    expect(text([
      { materialId: 'pipe', sizes: ['∅89×3'], partIds: ['post', 'bar'] },
      { materialId: 'pipe', sizes: ['∅33,5×2,8'], partIds: ['bar', 'clamp'] },
      { materialId: 'sheet', sizes: ['2', '6'] },
    ], ['powder'])).toBe('Изготовлено из стальных труб ∅89×3 и ∅33,5×2,8 мм, стального листа толщиной 2 и 6 мм. Состоит из стоек, перекладин и хомутов. Окрашено порошковой краской методом запекания в заводских условиях.');
  });
  it('один размер — ед. ч.; три и больше — через запятую и «и»; повтор размера не дублируется', () => {
    expect(text([{ materialId: 'sheet', sizes: ['2'] }])).toBe('Изготовлено из стального листа толщиной 2 мм.');
    expect(text([{ materialId: 'pipe', sizes: ['∅89×3', '∅57×3', 'Ø 33.5 x 2,8 мм'] }, { materialId: 'pipe', sizes: ['∅57×3'] }]))
      .toBe('Изготовлено из стальных труб ∅89×3, ∅57×3 и ∅33,5×2,8 мм.');
  });
  it('строка без размеров — без пустых «∅×» и «толщиной мм» (ТЭ-4)', () => {
    expect(text([{ materialId: 'sheet' }, { materialId: 'concrete' }])).toBe('Изготовлено из стального листа, бетона.');
    expect(text([{ materialId: 'sheet', sizes: ['  ', ''] }])).not.toMatch(/толщиной|мм/);
  });
  it('нет форм падежа — «Изготовлено из…» старой записи (madeOf); пустой шаблон размера — «{sizes} мм»', () => {
    expect(text([{ materialId: 'old' }])).toBe('Изготовлено из стали с порошковым покрытием.');
    expect(text([{ materialId: 'concrete', sizes: ['100'] }])).toBe('Изготовлено из бетона 100 мм.');
  });
  it('несколько покрытий — по фразе, с точкой; без материалов — только части и покрытия', () => {
    expect(text([], ['powder', 'oil', 'powder'])).toBe('Окрашено порошковой краской методом запекания в заводских условиях. Древесина покрыта маслом.');
    expect(text([{ materialId: 'gone', partIds: ['post'] }])).toBe('Состоит из стоек.');
  });
  it('пустая таблица и неизвестные id — пустой текст', () => {
    expect(text([])).toBe('');
    expect(composeMaterialsText(null, mats, parts)).toBe('');
    expect(text([{ materialId: 'gone', sizes: ['1'] }], ['gone2'])).toBe('');
  });
  it('перечень и размер одним написанием', () => {
    expect(joinRu(['а'])).toBe('а');
    expect(joinRu(['а', 'б'])).toBe('а и б');
    expect(joinRu(['а', 'б', 'в'])).toBe('а, б и в');
    expect(normSize('Ø 89 х 3 мм')).toBe('∅89×3');
    expect(normSize('40x40X2')).toBe('40×40×2');
    expect(normSize('1.5')).toBe('1,5');
  });
});

describe('«Взять из состава» (МИ.2)', () => {
  const recs = [
    { id: 'pipe', ...mats.get('pipe')! },
    { id: 'prof', name: 'Труба стальная профильная', code: 'PIPE_STEEL_PROFILE', kind: 'material', sizeTemplate: '{sizes} мм' },
    { id: 'sheet', ...mats.get('sheet')! },
    { id: 'powder', ...mats.get('powder')! },
  ];
  it('запись справочника по названию позиции склада: больше совпавших слов, при равенстве — короче', () => {
    expect(matchMaterial('Труба 89х3', recs)?.id).toBe('pipe');
    expect(matchMaterial('Труба профильная 40х40х2', recs)?.id).toBe('prof');
    expect(matchMaterial('Болт М10', recs)).toBeNull();
  });
  it('строки по материалам: размеры под шаблон, одинаковый материал — одна строка, написание — из «Сортамента», покрытие — отдельно', () => {
    const r = specFromComposition([
      { name: 'Труба 89х3', text: 'Труба 89х3' },
      { name: 'Труба 33.5x2.8', text: 'Труба 33.5x2.8' },
      { name: 'Труба профильная 40х40х2', text: 'Труба профильная 40х40х2' },
      { name: 'Лист г/к 2х1250х2500', text: 'Лист г/к 2х1250х2500' },
      { name: 'Краска порошковая RAL 6005', text: 'Краска порошковая RAL 6005' },
      { name: 'Болт М10', text: 'Болт М10' },
    ], recs, [{ material: 'PIPE_STEEL', name: '∅33,5×2,8' }]);
    expect(r.rows).toEqual([
      { materialId: 'pipe', sizes: ['∅89×3', '∅33,5×2,8'], partIds: [] },
      { materialId: 'prof', sizes: ['40×40×2'], partIds: [] },
      { materialId: 'sheet', sizes: ['2'], partIds: [] },
    ]);
    expect(r.coatingIds).toEqual(['powder']);
    expect(r.unmatched).toEqual(['Болт М10']);
  });
  it('пустой состав — пустая таблица', () => {
    expect(specFromComposition([], recs, [])).toEqual({ rows: [], coatingIds: [], unmatched: [] });
  });
});
