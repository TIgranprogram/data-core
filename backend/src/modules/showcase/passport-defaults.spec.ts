import { BadRequestException } from '@nestjs/common';
import { mergePassportDefaults, normalizePassportDefaults, presentPassportDefaults } from './passport-defaults';

/** Значения паспорта по умолчанию у изделия (БЗ-6 Э4b). */
describe('normalizePassportDefaults', () => {
  const id = '6ad88933ba6c8597a0843ccc';
  it('принимает известные поля, пустые отбрасывает, числа — с запятой', () => {
    const v = normalizePassportDefaults({ passportCategory: 'TRN', elements: [id], materialIds: [], installationTypeId: id, isKit: false, heightMin: '1400', weightMax: '120,5', ageFrom: '', junk: 1 });
    expect(v.passportCategory).toBe('TRN');
    expect(v.elements?.map(String)).toEqual([id]);
    expect(v.materialIds).toBeUndefined();
    expect(String(v.installationTypeId)).toBe(id);
    expect(v.isKit).toBe(false);
    expect(v.heightMin).toBe(1400);
    expect(v.weightMax).toBe(120.5);
    expect('ageFrom' in v).toBe(false);
    expect('junk' in v).toBe(false);
    expect(presentPassportDefaults(v)).toEqual(expect.objectContaining({ elements: [id], installationTypeId: id }));
  });
  it('неизвестная категория, кривой id, отрицательное число — 400', () => {
    expect(() => normalizePassportDefaults({ passportCategory: 'XXX' })).toThrow(BadRequestException);
    expect(() => normalizePassportDefaults({ elements: ['nope'] })).toThrow(BadRequestException);
    expect(() => normalizePassportDefaults({ maxUsers: -1 })).toThrow(BadRequestException);
  });
  it('пустое тело — пусто (очистить)', () => {
    expect(normalizePassportDefaults({})).toEqual({});
    expect(presentPassportDefaults(undefined)).toBeNull();
  });
});

/** ПВ: выбор текстов воронкой в значениях по умолчанию изделия. */
describe('textChoices в passportDefaults', () => {
  const a = '6ad88933ba6c8597a0843aaa', b = '6ad88933ba6c8597a0843bbb', c = '6ad88933ba6c8597a0843ccc', d = '6ad88933ba6c8597a0843ddd';
  it('принимается и проходит в ответ как есть; мусор — 400', () => {
    const v = normalizePassportDefaults({ textChoices: { [a]: b } });
    expect(v.textChoices).toEqual({ [a]: b });
    expect(presentPassportDefaults(v)?.textChoices).toEqual({ [a]: b });
    expect(normalizePassportDefaults({ textChoices: {} })).toEqual({});
    expect(() => normalizePassportDefaults({ textChoices: { x: b } })).toThrow(BadRequestException);
  });
  it('мерж пакетной правки — по разделам: чужие выборы не стираются, пустое снимает', () => {
    const cur = { passportCategory: 'TRN', textChoices: { [a]: b, [c]: d } };
    expect(mergePassportDefaults(cur, { textChoices: { [a]: d }, heightMin: 1400 })).toEqual({ passportCategory: 'TRN', heightMin: 1400, textChoices: { [a]: d, [c]: d } });
    expect(mergePassportDefaults(cur, { textChoices: { [c]: '' } }).textChoices).toEqual({ [a]: b });
    expect(mergePassportDefaults({ textChoices: { [a]: b } }, { textChoices: { [a]: '' } })).toEqual({});
    expect(mergePassportDefaults(null, { isKit: true })).toEqual({ isKit: true });
  });
});
