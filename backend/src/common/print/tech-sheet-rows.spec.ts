import { techSheetRows, wallOf } from './tech-sheet-rows';

const pipe = 'a'.repeat(24);
const post = 'b'.repeat(24);
const coat = 'c'.repeat(24);

describe('строки технического описания из состава', () => {
  it('часть, материал, допуск стенки и габарит ±10 %', () => {
    expect(wallOf('∅89×3')).toBe(3);
    expect(wallOf('120×60×3')).toBe(3);
    expect(wallOf('2')).toBe(2);
    const rows = techSheetRows({
      spec: { rows: [{ materialId: pipe, sizes: ['∅89×3'], partIds: [post] }], coatingIds: [coat] },
      mats: [{ id: pipe, name: 'Труба стальная' }, { id: coat, name: 'Порошок' }],
      parts: [{ id: post, name: 'Стойка' }],
      length: 1000, unit: 'мм', weight: 12.5, purpose: 'Игры', installation: 'Бетонирование',
    });
    expect(rows[0]).toEqual({ name: 'Стойка', text: 'Труба стальная ∅89×3, толщина не менее 2 и не более 4 мм' });
    expect(rows.find((r) => r.name === 'Покрытие')?.text).toBe('Порошок');
    expect(rows.find((r) => r.name === 'Длина')?.text).toBe('не менее 900 и не более 1100 мм');
    expect(rows.find((r) => r.name === 'Вес')?.text).toBe('12,5 кг');
    expect(rows.map((r) => r.name)).toEqual(['Стойка', 'Покрытие', 'Длина', 'Вес', 'Назначение', 'Установка']);
  });

  it('без состава и габаритов строк нет; стенка 1 мм без допуска', () => {
    expect(techSheetRows({ mats: [], parts: [] })).toEqual([]);
    const rows = techSheetRows({ spec: { rows: [{ materialId: pipe, sizes: ['1'], partIds: [] }], coatingIds: [] }, mats: [], parts: [] });
    expect(rows).toEqual([{ name: 'Материал', text: '1' }]);
  });
});

it('МЦ-7 печатает только ручную техническую фразу и выбранные покрытия', () => {
  expect(techSheetRows({ mats: [], parts: [], spec: {
    rows: [{ materialId: pipe, sizes: ['∅89×3'], partIds: [], passportText: 'Паспорт', techText: 'Ручная техника' }],
    coatingIds: [coat], coatingTexts: [{ materialId: coat, techText: 'Слой А' }, { materialId: coat, techText: 'Слой Б' }, { materialId: pipe, techText: 'Снято' }],
  } })).toEqual([{ name: 'Материал', text: 'Ручная техника' }, { name: 'Покрытие', text: 'Слой А, Слой Б' }]);
});
