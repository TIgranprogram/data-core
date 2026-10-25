import { BadRequestException } from '@nestjs/common';
import { normalizeCategory } from './passport-template-select';

describe('категория шаблона текста паспорта', () => {
  it('normalizeCategory: пусто → ALL, мусор → 400', () => {
    expect(normalizeCategory(undefined)).toBe('ALL');
    expect(normalizeCategory('')).toBe('ALL');
    expect(normalizeCategory(null)).toBe('ALL');
    expect(normalizeCategory('BLG')).toBe('BLG');
    expect(() => normalizeCategory('XXX')).toThrow(BadRequestException);
    expect(() => normalizeCategory(5)).toThrow(BadRequestException);
  });
});
