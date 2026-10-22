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
    const t = buildV2Text({ passport: { name: 'Скамья', passportCategory: 'MAF' }, all: DEFAULT_PASSPORT_TEMPLATE });
    expect(t.rules).toEqual([]);
    expect(t.maintenance).toEqual([]);
    expect(t.sections.length).toBeGreaterThan(0);
  });
});
