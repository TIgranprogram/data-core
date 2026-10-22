import { describeProduct, purposeText, usageRules, maintenanceTables, installText } from './passport-compose-parts';

const els = [
  { id: 'e1', code: 'BAR', name: 'Турник', inDescription: 'перекладины для подтягиваний.', purpose: 'Подтягивания.', usageRules: 'Шаг А\nШаг Б', inspect: 'Крепление стоек\nКоррозия' },
  { _id: 'e2', code: 'BARS', name: 'Брусья', inDescription: 'параллельных брусьев', purpose: 'Подтягивания.', usageRules: 'Шаг Б\n\nШаг В' },
];
const mats = [
  { id: 'm1', code: 'STEEL', name: 'Сталь', madeOf: 'стальной трубы' },
  { id: 'm2', code: 'WOOD', name: 'Дерево', madeOf: 'клеёного бруса' },
];
const defects = [
  { code: 'D1', name: 'Люфт', applies: 'BAR, X', measure: 'Подтянуть', period: 'ежегодно', tolerance: 'Нет' },
  { code: 'D2', name: 'Коррозия', applies: 'STEEL', measure: 'Зачистить', period: 'ежедневно', tolerance: 'Поверхностная' },
  { code: 'D3', name: 'Чужой', applies: 'OTHER', period: 'ежемесячно' },
  { code: 'D4', name: 'Бетон', applies: 'CONCRETE', period: 'ежеквартально', measure: 'м' },
  { code: 'D5', name: 'Без периода', applies: 'STEEL' },
];

describe('describeProduct', () => {
  it('собирает фразу без двойных точек', () => {
    expect(describeProduct({ name: 'Комплекс', elements: ['e1', 'e2'], materialIds: ['m1', 'm2'] }, els, mats))
      .toBe('Комплекс (далее — изделие) состоит из: перекладины для подтягиваний, параллельных брусьев; изготовлено из стальной трубы и клеёного бруса.');
  });
  it('пропускает пустые части', () => {
    expect(describeProduct({ name: 'Комплекс', materialIds: ['m1'] }, els, mats)).toBe('Комплекс (далее — изделие) изготовлено из стальной трубы.');
    expect(describeProduct({}, [], [])).toBe('');
    expect(describeProduct({ name: 'Х' }, undefined as any, undefined as any)).toBe('Х (далее — изделие).');
  });
});

describe('purposeText', () => {
  it('без дублей', () => expect(purposeText(els)).toBe('Предназначено для: Подтягивания.'));
  it('пусто', () => { expect(purposeText([])).toBe(''); expect(purposeText([{}])).toBe(''); });
});

describe('usageRules', () => {
  it('уникальные шаги по строке', () => expect(usageRules(els)).toEqual(['Шаг А', 'Шаг Б', 'Шаг В']));
  it('пустые входы', () => expect(usageRules([{}, undefined as any])).toEqual([]));
});

describe('maintenanceTables', () => {
  const t = maintenanceTables(mats, els, defects, { code: 'CONCRETE', name: 'Бетонирование' });
  it('периоды от частого к редкому, пустые не выводятся', () => {
    expect(t.map((x) => x.period)).toEqual(['ежедневно', 'ежемесячно', 'ежеквартально', 'ежегодно']);
  });
  it('пересечение applies и where', () => {
    expect(t[0].rows).toEqual([{ what: 'Коррозия', where: 'Сталь', measure: 'Зачистить', tolerance: 'Поверхностная' }]);
    expect(t[3].rows[0].where).toBe('Турник');
    expect(t[2].rows[0].where).toBe('Бетонирование');
  });
  it('чужие и безпериодные дефекты не попадают; проверки без дубля дефекта', () => {
    const all = t.flatMap((x) => x.rows.map((r) => r.what));
    expect(all).not.toContain('Чужой');
    expect(all).not.toContain('Без периода');
    expect(t[1].rows).toEqual([{ what: 'Крепление стоек', where: 'Турник', measure: '', tolerance: '' }]);
    expect(all.filter((w) => w === 'Коррозия')).toHaveLength(1);
  });
  it('без способа установки дефект установки отсутствует; пустые входы', () => {
    expect(maintenanceTables(mats, els, defects).map((x) => x.period)).toEqual(['ежедневно', 'ежемесячно', 'ежегодно']);
    expect(maintenanceTables([], [], [])).toEqual([]);
    expect(maintenanceTables(undefined as any, undefined as any, undefined as any)).toEqual([]);
  });
});

describe('installText', () => {
  it('разбирает поля', () => {
    expect(installText({ montage: 'Шаг 1\nШаг 2', baseRequirements: 'Бетон\n', requiredImages: 'foundation\nholes' }))
      .toEqual({ text: 'Шаг 1\nШаг 2', requirements: ['Бетон'], requiredImages: ['foundation', 'holes'] });
  });
  it('пусто', () => {
    expect(installText(null)).toEqual({ text: '', requirements: [], requiredImages: [] });
    expect(installText({})).toEqual({ text: '', requirements: [], requiredImages: [] });
  });
});
