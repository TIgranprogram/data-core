import { BadRequestException } from '@nestjs/common';
import { normalizePassportDefaults, presentPassportDefaults } from './passport-defaults';

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
