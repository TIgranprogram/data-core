import { filterImagesByKind, imageKindAllowed, installKindOf, variantOf } from './passport-variants';
import { missingFieldsV2, requiredImageKinds } from './passport-rules';

describe('варианты паспорта и правила по категории', () => {
  const cat = { requiredImages: 'overview\nsafety_zone', requiredFields: 'maxUsers\nsiteLength — Длина площадки' };
  const base = { passportCategory: 'TRN', images: [{ kind: 'overview' }] } as never;

  it('variantOf: по умолчанию short', () => {
    expect(variantOf(undefined)).toBe('short');
    expect(variantOf('мусор')).toBe('short');
    expect(variantOf('full')).toBe('full');
  });
  it('зона безопасности требуется только детским площадкам (DIO)', () => {
    expect(missingFieldsV2(base, cat)).not.toContain('Рисунок: Зона безопасности');
    expect(missingFieldsV2({ ...(base as object), passportCategory: 'DIO' } as never, cat)).toContain('Рисунок: Зона безопасности');
    expect(requiredImageKinds({}, cat, { category: 'TRN' })).toEqual(['overview']);
    expect(requiredImageKinds({}, cat, { category: 'DIO' })).toEqual(['overview', 'safety_zone']);
  });
  it('фундамент: бетонирование — обязателен, анкер — не печатается', () => {
    expect(installKindOf({ code: 'CONCRETE_POSTS' })).toBe('concrete');
    expect(installKindOf({ name: 'Анкерное крепление' })).toBe('anchor');
    expect(installKindOf(null)).toBe('unknown');
    expect(missingFieldsV2(base, cat, { install: 'concrete' })).toContain('Рисунок: Схема фундамента');
    expect(missingFieldsV2(base, cat, { install: 'anchor' })).not.toContain('Рисунок: Схема фундамента');
    expect(imageKindAllowed('foundation', { install: 'anchor' })).toBe(false);
    expect(imageKindAllowed('foundation', { install: 'concrete' })).toBe(true);
  });
  it('short не требует зону размещения, full требует', () => {
    expect(missingFieldsV2(base, cat, { variant: 'short' })).not.toContain('Длина площадки');
    expect(missingFieldsV2(base, cat, { variant: 'full' })).toContain('Длина площадки');
    expect(missingFieldsV2(base, cat)).toContain('Пользователей одновременно');
  });
  it('печать: short без необязательных рисунков, full с ними; безопасность только DIO', () => {
    const by = { overview: [1], overview_callouts: [2], safety_zone: [3], foundation: [4] };
    expect(Object.keys(filterImagesByKind(by, { category: 'DIO', install: 'anchor', variant: 'short' }))).toEqual(['overview', 'safety_zone']);
    expect(Object.keys(filterImagesByKind(by, { category: 'TRN', install: 'concrete', variant: 'full' }))).toEqual(['overview', 'overview_callouts', 'foundation']);
  });
});
