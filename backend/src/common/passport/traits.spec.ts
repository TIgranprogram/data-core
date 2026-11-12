import { parseJoints, parseTraits, parseWhenParts, PASSPORT_TRAITS, PASSPORT_TRAIT_CODES, whenCodes, whenProblem, WhenError } from './traits';

describe('признаки паспорта (C054)', () => {
  it('15 признаков, у каждого русская подпись без латиницы', () => {
    expect(PASSPORT_TRAIT_CODES).toHaveLength(15);
    for (const c of PASSPORT_TRAIT_CODES) expect(PASSPORT_TRAITS[c]).toMatch(/^[А-ЯЁ]/);
  });

  it.each([
    ['bolts', [[{ code: 'bolts', not: false }]]],
    ['bolts|welds', [[{ code: 'bolts', not: false }, { code: 'welds', not: false }]]],
    ['concrete !freestanding', [[{ code: 'concrete', not: false }], [{ code: 'freestanding', not: true }]]],
    ['  !wood|metal   moving ', [[{ code: 'wood', not: true }, { code: 'metal', not: false }], [{ code: 'moving', not: false }]]],
    ['', []],
    [null, []],
    [undefined, []],
  ])('разбор when %p', (src, parts) => {
    expect(parseWhenParts(src)).toEqual(parts);
  });

  it.each(['!', 'bolts|', '|bolts', 'bolts||welds', '!!bolts', 'nonsense', '!nonsense', 'bolts nonsense'])('ошибка в when %p', (src) => {
    expect(() => parseWhenParts(src)).toThrow(WhenError);
    expect(whenProblem(src)).toBeTruthy();
  });

  it('текст ошибки по-русски и называет код', () => {
    expect(whenProblem('boltz')).toMatch(/Неизвестный признак: boltz/);
    expect(whenProblem('bolts')).toBeNull();
  });

  it('whenCodes — все упомянутые коды без повторов; ошибочная строка — пусто', () => {
    expect(whenCodes('bolts|welds !bolts concrete')).toEqual(['bolts', 'welds', 'concrete']);
    expect(whenCodes('???')).toEqual([]);
  });

  it('parseTraits: строка и массив, порядок словаря, без повторов; неизвестный код — ошибка', () => {
    expect(parseTraits('freestanding, metal; metal')).toEqual(['metal', 'freestanding']);
    expect(parseTraits(['wood'])).toEqual(['wood']);
    expect(parseTraits('')).toEqual([]);
    expect(() => parseTraits('bolts, rocket')).toThrow(/Неизвестный признак: rocket/);
  });

  it('parseJoints: не выбрано — null; неизвестное — ошибка', () => {
    expect(parseJoints(undefined)).toBeNull();
    expect(parseJoints([])).toBeNull();
    expect(parseJoints(['welds', 'bolts'])).toEqual(['bolts', 'welds']);
    expect(() => parseJoints(['glue'])).toThrow(WhenError);
  });
});
