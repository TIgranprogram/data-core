import { BadRequestException } from '@nestjs/common';
import { normalizeCategory, pickOwnVersion, pickTemplateVersion } from './passport-template-select';

const docs = [
  { version: 1, isActive: false },
  { version: 2, isActive: true },
  { version: 1, isActive: false, category: 'TRN' },
  { version: 2, isActive: true, category: 'TRN' },
  { version: 3, isActive: true, category: 'TRN' },
];

describe('выбор версии шаблона текста паспорта', () => {
  it('категория есть — берётся её последняя активная версия', () => {
    expect(pickTemplateVersion(docs, 'TRN')).toMatchObject({ category: 'TRN', version: 3 });
  });
  it('категории нет — «Для всех» (без category = ALL)', () => {
    expect(pickTemplateVersion(docs, 'DIO')).toMatchObject({ version: 2 });
    expect(pickOwnVersion(docs, 'DIO')).toBeNull();
  });
  it('ALL (без параметра) — последняя активная версия без категории или с ALL', () => {
    expect(pickTemplateVersion(docs, 'ALL')).toMatchObject({ version: 2 });
    expect(pickTemplateVersion([...docs, { version: 4, isActive: true, category: 'ALL' }], 'ALL')).toMatchObject({ version: 4 });
  });
  it('ничего нет — null', () => {
    expect(pickTemplateVersion([], 'ALL')).toBeNull();
    expect(pickTemplateVersion([], 'WRK')).toBeNull();
  });
  it('normalizeCategory: пусто → ALL, мусор → 400', () => {
    expect(normalizeCategory(undefined)).toBe('ALL');
    expect(normalizeCategory('')).toBe('ALL');
    expect(normalizeCategory(null)).toBe('ALL');
    expect(normalizeCategory('MAF')).toBe('MAF');
    expect(() => normalizeCategory('XXX')).toThrow(BadRequestException);
    expect(() => normalizeCategory(5)).toThrow(BadRequestException);
  });
});
