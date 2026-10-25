import { buildV2Text } from './passport-v2-text';
import { DEFAULT_PASSPORT_TEMPLATE } from './passport-template.default';

/** Полный текст паспорта v2 для снимка (БЗ-6 Э4a3/Э4c). */
describe('buildV2Text', () => {
  const dicts = {
    elements: [{ _id: 'e1', code: 'BAR', name: 'Турник', inDescription: 'перекладина для подтягиваний', purpose: 'подтягиваний', usageRules: 'Перед занятием осмотрите изделие' }],
    materials: [{ _id: 'm1', code: 'ST', name: 'Сталь', madeOf: 'стальной трубы с порошковым покрытием' }],
    defects: [{ _id: 'd1', code: 'CORR', name: 'Коррозия', applies: 'ST', measure: 'Зачистить и окрасить', period: 'ежегодно' }],
    install: [{ _id: 'i1', code: 'CONCRETE', name: 'Бетонирование опор', montage: 'Опоры бетонируют в подготовленные скважины.' }],
  };
  const passport = { name: 'Тренажёр «Турник»', passportCategory: 'TRN', elements: ['e1'], materialIds: ['m1'], installationTypeId: 'i1', warrantyMonths: 12 };

  it('собирает описание, правила, ТО и монтаж из справочников; разделы шаблона с номерами', () => {
    const t = buildV2Text({ passport, all: { ...DEFAULT_PASSPORT_TEMPLATE, version: 0 }, dicts });
    expect(t.category).toBe('TRN');
    expect(t.description).toContain('перекладина для подтягиваний');
    expect(t.description).toContain('стальной трубы');
    expect(t.rules).toEqual(['Перед занятием осмотрите изделие']);
    expect(t.maintenance.map((m) => m.period)).toEqual(['ежегодно']);
    expect(t.install.text).toContain('скважины');
    expect(t.sections.length).toBe(DEFAULT_PASSPORT_TEMPLATE.sections.length);
    expect(JSON.stringify(t.sections)).toContain('12'); // {warrantyMonths} подставлен
    expect(t.ownVersion).toBeNull();
  });

  it('версия категории заменяет пункт «Для всех» с тем же ключом', () => {
    const own = { version: 3, sections: DEFAULT_PASSPORT_TEMPLATE.sections.map((s, i) => (i === 0 ? { ...s, paragraphs: ['Свой первый пункт для тренажёров.', ...s.paragraphs.slice(1)] } : s)) };
    const t = buildV2Text({ passport, all: { ...DEFAULT_PASSPORT_TEMPLATE, version: 1 }, own, dicts });
    const first = t.sections[0].items[0].text;
    expect(first).toBe('Свой первый пункт для тренажёров.');
    expect(t.ownVersion).toBe(3);
    expect(t.templateVersion).toBe(1);
  });

  it('без справочников — пустые части, текст шаблона собирается', () => {
    const t = buildV2Text({ passport: { name: 'Скамья', passportCategory: 'BLG' }, all: DEFAULT_PASSPORT_TEMPLATE });
    expect(t.rules).toEqual([]);
    expect(t.maintenance).toEqual([]);
    expect(t.sections.length).toBeGreaterThan(0);
  });
});

/** Воронка (ПВ): выбор текстов идёт верхним слоем; «Назначение» — только из дерева. */
describe('buildV2Text с воронкой', () => {
  const hex = (n: number) => String(n).padStart(24, '0');
  const mk = (o: Record<string, unknown>) => ({ id: hex(1), name: '', parentId: null, section: 'x', text: '', categories: '', allCategories: true, order: 0, required: false, isDefault: false, installTypeId: null, slot: 1, ...o });
  const purposeRoot = mk({ id: hex(1), name: 'Назначение', section: 'purpose', children: [mk({ id: hex(2), name: 'Занятия', text: 'Для занятий спортом на {name}.', children: [] })] });
  const mountRoot = mk({ id: hex(3), name: 'Монтаж', section: 'mounting', slot: 2, children: [mk({ id: hex(4), name: 'Анкер', text: 'Крепить анкерами по {std:GOST_X}.', children: [] }), mk({ id: hex(5), name: 'Бетон', text: 'Бетонировать.', children: [] })] });
  const installRoot = mk({ id: hex(6), name: 'Установка', section: 'installation', children: [mk({ id: hex(7), name: 'Анкерная', text: 'Установка анкерная.', children: [] })] });
  const forest = [purposeRoot, mountRoot, installRoot] as never;
  const els = [{ _id: 'e1', code: 'BAR', name: 'Турник', purpose: 'подтягиваний' }];
  const base = { passport: { name: 'Турник', passportCategory: 'TRN', elements: ['e1'] }, all: { ...DEFAULT_PASSPORT_TEMPLATE, version: 0 }, standards: { GOST_X: 'ГОСТ Х' }, dicts: { elements: els } };

  it('«Назначение» — из дерева (единственный вариант сам), назначение элемента не подставляется', () => {
    const t = buildV2Text({ ...base, funnel: { forest } });
    expect(t.purpose).toBe('Для занятий спортом на Турник.');
    expect(t.purpose).not.toContain('подтягиваний');
    expect(t.choices[hex(1)]).toBe(hex(2));
    expect(t.install.text).toBe('Установка анкерная.');
  });
  it('без дерева «Назначение» пусто, а не «Предназначено для: …» из элементов', () => {
    expect(buildV2Text(base).purpose).toBe('');
  });
  it('выбор заменяет пункт №slot раздела шаблона, нумерация не ломается', () => {
    const t = buildV2Text({ ...base, funnel: { forest, choices: { [hex(3)]: hex(4) } } });
    const sec = t.sections.find((s) => s.key === 'mounting')!;
    expect(sec.items[1].text).toBe('Крепить анкерами по ГОСТ Х.');
    expect(sec.items).toHaveLength(DEFAULT_PASSPORT_TEMPLATE.sections.find((s) => s.key === 'mounting')!.paragraphs.length);
    expect(t.standards).toContain('GOST_X');
    expect(t.choices[hex(3)]).toBe(hex(4));
  });
  it('раздел без выбора из двух вариантов текст шаблона не меняет', () => {
    const t = buildV2Text({ ...base, funnel: { forest } });
    expect(t.choices[hex(3)]).toBeUndefined();
    expect(JSON.stringify(t.sections)).not.toContain('Бетонировать.');
  });
});
