import {
  compose, evalCondition, legacyTemplateToBlocks, legacyStartNumber, standardsDict, usedStandards, standardWarnings,
  type PassportTextBlock, type PassportCondition,
} from './passport-compose';
import { DEFAULT_PASSPORT_TEMPLATE } from './passport-template.default';

const blk = (o: Partial<PassportTextBlock> & { key: string; text: string }): PassportTextBlock =>
  ({ sectionKey: 's1', sectionTitle: 'Раздел', sectionOrder: 0, ...o });

describe('evalCondition', () => {
  const p = { isKit: true, ageFrom: 7, name: 'Горка', elements: ['slide', 'net'], empty: '  ', zero: 0 };
  const t = (c: PassportCondition) => evalCondition(c, p);
  it('без условия — true', () => expect(evalCondition(undefined, p)).toBe(true));
  it('filled / empty', () => {
    expect(t({ field: 'name', op: 'filled' })).toBe(true);
    expect(t({ field: 'empty', op: 'filled' })).toBe(false);
    expect(t({ field: 'zero', op: 'filled' })).toBe(true);
    expect(t({ field: 'nope', op: 'empty' })).toBe(true);
    expect(t({ field: 'name', op: 'empty' })).toBe(false);
  });
  it('eq / ne (isKit, массив)', () => {
    expect(t({ field: 'isKit', op: 'eq', value: true })).toBe(true);
    expect(t({ field: 'isKit', op: 'eq', value: false })).toBe(false);
    expect(t({ field: 'elements', op: 'eq', value: 'net' })).toBe(true);
    expect(t({ field: 'name', op: 'ne', value: 'Горка' })).toBe(false);
    expect(t({ field: 'name', op: 'ne', value: 'Качели' })).toBe(true);
  });
  it('in', () => {
    expect(t({ field: 'name', op: 'in', value: ['Горка', 'Качели'] })).toBe(true);
    expect(t({ field: 'elements', op: 'in', value: ['x', 'slide'] })).toBe(true);
    expect(t({ field: 'name', op: 'in', value: ['Х'] })).toBe(false);
  });
  it('gt / gte / lt / lte', () => {
    expect(t({ field: 'ageFrom', op: 'gt', value: 6 })).toBe(true);
    expect(t({ field: 'ageFrom', op: 'gt', value: 7 })).toBe(false);
    expect(t({ field: 'ageFrom', op: 'gte', value: 7 })).toBe(true);
    expect(t({ field: 'ageFrom', op: 'lt', value: 8 })).toBe(true);
    expect(t({ field: 'ageFrom', op: 'lte', value: 6 })).toBe(false);
    expect(t({ field: 'nope', op: 'gte', value: 0 })).toBe(false);
  });
  it('all / any / not', () => {
    expect(t({ all: [{ field: 'isKit', op: 'eq', value: true }, { field: 'name', op: 'filled' }] })).toBe(true);
    expect(t({ all: [{ field: 'isKit', op: 'eq', value: true }, { field: 'nope', op: 'filled' }] })).toBe(false);
    expect(t({ any: [{ field: 'nope', op: 'filled' }, { field: 'name', op: 'filled' }] })).toBe(true);
    expect(t({ not: { field: 'isKit', op: 'eq', value: true } })).toBe(false);
  });
});

describe('compose', () => {
  it('нумерация разделов и пунктов, порядок по sectionOrder/order', () => {
    const r = compose([
      blk({ key: 'b', text: 'Второй', order: 2 }),
      blk({ key: 'a', text: 'Первый', order: 1 }),
      blk({ sectionKey: 's0', sectionTitle: 'Начало', sectionOrder: -1, key: 'x', text: 'Икс' }),
    ], {}, 'TRN');
    expect(r.sections.map((s) => s.number)).toEqual(['1', '2']);
    expect(r.sections[0].title).toBe('Начало');
    expect(r.sections[1].items.map((i) => [i.number, i.text])).toEqual([['2.1', 'Первый'], ['2.2', 'Второй']]);
  });

  it('берёт ALL и свою категорию, чужую — нет', () => {
    const r = compose([
      blk({ key: 'a', text: 'общий', category: 'ALL' }),
      blk({ key: 'b', text: 'тренажёр', category: 'TRN', order: 1 }),
      blk({ key: 'c', text: 'детское', category: 'DIO', order: 2 }),
      blk({ key: 'd', text: 'без категории', order: 3 }),
    ], {}, 'TRN');
    expect(r.sections[0].items.map((i) => i.text)).toEqual(['общий', 'тренажёр', 'без категории']);
  });

  it('категория переопределяет блок ALL с тем же ключом (любой порядок входа)', () => {
    const all = blk({ key: 'age', text: 'Возраст любой', category: 'ALL' });
    const trn = blk({ key: 'age', text: 'Рост от {heightMin} мм', category: 'TRN' });
    for (const input of [[all, trn], [trn, all]]) {
      const r = compose(input, { heightMin: 1400 }, 'TRN');
      expect(r.sections[0].items).toHaveLength(1);
      expect(r.sections[0].items[0].text).toBe('Рост от 1400 мм');
    }
    expect(compose([all, trn], {}, 'MAF').sections[0].items[0].text).toBe('Возраст любой');
  });

  it('отсутствующая переменная — видимая метка и missing (без дублей)', () => {
    const r = compose([
      blk({ key: 'a', text: 'С {ageFrom} лет, до {ageTo}, снова {ageFrom}', order: 1 }),
      blk({ key: 'b', text: 'Пусто {name} {zero}', order: 2 }),
    ], { ageTo: 12, name: '   ', zero: 0 }, 'ALL');
    expect(r.sections[0].items[0].text).toBe('С [{ageFrom} не заполнено] лет, до 12, снова [{ageFrom} не заполнено]');
    expect(r.sections[0].items[1].text).toBe('Пусто [{name} не заполнено] 0');
    expect(r.missing).toEqual(['ageFrom', 'name']);
  });

  it('переменная в заголовке раздела; чужие {fig:…} не трогаются', () => {
    const r = compose([blk({ key: 'a', sectionTitle: 'Изделие {name}', text: 'См. {fig:overview}' })], { name: 'Горка' }, 'ALL');
    expect(r.sections[0].title).toBe('Изделие Горка');
    expect(r.sections[0].items[0].text).toBe('См. {fig:overview}');
    expect(r.missing).toEqual([]);
  });

  it('условие ложно — блок пропущен, нумерация без дыр, пустой раздел исчезает', () => {
    const blocks = [
      blk({ key: 'a', text: 'A', order: 1 }),
      blk({ key: 'b', text: 'B (разборное) {fromHidden}', order: 2, condition: { field: 'isKit', op: 'eq', value: true } }),
      blk({ key: 'c', text: 'C', order: 3 }),
      blk({ sectionKey: 's2', sectionTitle: 'Скрытый', sectionOrder: 1, key: 'x', text: 'X', condition: { field: 'isKit', op: 'eq', value: true } }),
      blk({ sectionKey: 's3', sectionTitle: 'Последний', sectionOrder: 2, key: 'y', text: 'Y' }),
    ];
    const r = compose(blocks, { isKit: false }, 'ALL');
    expect(r.sections.map((s) => s.number)).toEqual(['1', '2']);
    expect(r.sections[0].items.map((i) => i.number)).toEqual(['1.1', '1.2']);
    expect(r.sections[1].key).toBe('s3');
    expect(r.missing).toEqual([]); // переменные пропущенного блока не считаются ошибкой
    const r2 = compose(blocks, { isKit: true, fromHidden: 'x' }, 'ALL');
    expect(r2.sections).toHaveLength(3);
    expect(r2.sections[0].items.map((i) => i.number)).toEqual(['1.1', '1.2', '1.3']);
  });

  it('{std:КОД}: известный подставляется, неизвестный — метка и missing', () => {
    const r = compose([blk({ key: 'a', text: 'По {std:R52301} и {std:NOPE}.' })], {}, 'ALL',
      { standards: { R52301: 'ГОСТ Р 52301–2013' } });
    expect(r.sections[0].items[0].text).toBe('По ГОСТ Р 52301–2013 и [{std:NOPE} не найден].');
    expect(r.missing).toEqual(['std:NOPE']);
  });

  it('маркированные пункты не получают номер', () => {
    const r = compose([
      blk({ key: 'a', text: 'Пункт', order: 1 }),
      blk({ key: 'b', text: '— маркер', bullet: true, order: 2 }),
      blk({ key: 'c', text: 'Ещё', order: 3 }),
    ], {}, 'ALL');
    expect(r.sections[0].items.map((i) => i.number)).toEqual(['1.1', null, '1.2']);
  });
});

describe('адаптер старого шаблона', () => {
  const tpl = DEFAULT_PASSPORT_TEMPLATE;
  const blocks = legacyTemplateToBlocks(tpl);
  const r = compose(blocks, { warrantyMonths: 24 }, 'WRK', { startNumber: legacyStartNumber(tpl) });

  it('число разделов совпадает, нумерация 3…7 как в оригинале', () => {
    expect(r.sections).toHaveLength(tpl.sections.length);
    expect(r.sections.map((s) => s.number)).toEqual(['3', '4', '5', '6', '7']);
    expect(r.sections[0].title).toBe('Инструкция по монтажу / сборке / установке');
    expect(r.sections[0].items[0].number).toBe('3.1');
  });
  it('{warrantyMonths} подставлен, лишних missing нет', () => {
    const w = r.sections[1].items[0].text;
    expect(w).toContain('в течение 24 месяцев');
    expect(w).not.toContain('{warrantyMonths}');
    expect(r.missing).toEqual([]);
  });
  it('без warrantyMonths — метка и missing', () => {
    const r2 = compose(blocks, {}, null, { startNumber: 3 });
    expect(r2.missing).toEqual(['warrantyMonths']);
  });
  it('число пунктов (нумерованных + маркеров) сохраняется', () => {
    r.sections.forEach((s, i) => expect(s.items).toHaveLength(tpl.sections[i].paragraphs.length));
  });
});

describe('нормативы из справочника (БЗ-6 Э1c)', () => {
  const docs = [
    { code: 'GOST_R_57538', name: 'ГОСТ Р 57538–2017', status: 'действует', checkedAt: '2026-10-22' },
    { code: 'GOST_R_55679', name: 'ГОСТ Р 55679–2013', status: 'проверить', checkedAt: '2026-10-22' },
    { code: 'GOST_15150', name: 'ГОСТ 15150–69', status: 'действует', checkedAt: '2024-01-10' },
    { code: 'NO_NAME' },
  ];
  it('словарь для {std:КОД} и подстановка через compose', () => {
    const dict = standardsDict(docs);
    expect(dict).toEqual({ GOST_R_57538: 'ГОСТ Р 57538–2017', GOST_R_55679: 'ГОСТ Р 55679–2013', GOST_15150: 'ГОСТ 15150–69' });
    const r = compose([blk({ key: 'a', text: 'Обслуживание — по {std:GOST_R_57538}.' })], {}, 'TRN', { standards: dict });
    expect(r.sections[0].items[0].text).toBe('Обслуживание — по ГОСТ Р 57538–2017.');
    expect(r.missing).toEqual([]);
  });
  it('какие нормативы использованы и предупреждения по статусу и дате проверки', () => {
    const used = usedStandards([blk({ key: 'a', text: '{std:GOST_R_57538} и {std:GOST_R_55679}' }), blk({ key: 'b', text: 'хранение по {std:GOST_15150}; {std:GOST_R_57538}' })]);
    expect(used.sort()).toEqual(['GOST_15150', 'GOST_R_55679', 'GOST_R_57538']);
    const w = standardWarnings(used, docs, new Date('2026-10-22T00:00:00Z'));
    expect(w).toEqual(expect.arrayContaining([expect.stringContaining('ГОСТ Р 55679–2013: статус «проверить»'), expect.stringContaining('ГОСТ 15150–69: проверяли больше года назад')]));
    expect(w.some((x) => x.includes('57538'))).toBe(false);
  });
});
