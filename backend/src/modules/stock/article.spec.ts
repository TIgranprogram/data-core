import { articleView, decideArticle, isAutoArticle } from './article';

describe('article (АР): артикул поставщика ≠ внутренний код', () => {
  it('автоартикул СКЛ-… и пустой — «нет артикула поставщика»', () => {
    expect(isAutoArticle('СКЛ-2026-013')).toBe(true);
    expect(isAutoArticle('')).toBe(true);
    expect(isAutoArticle('СФБОЧ-КсОК')).toBe(false);
  });
  it('показ: СКЛ-… и sku — внутренний код, не артикул', () => {
    expect(articleView({ article: 'СКЛ-2026-224', sku: 'RAS-2026-039' })).toEqual({ supplierArticle: null, internalCode: 'СКЛ-2026-224 · RAS-2026-039' });
    expect(articleView({ article: 'СФБОЧ-КсОК', sku: 'POK-2026-006', internalArticle: 'СКЛ-2026-013' })).toEqual({ supplierArticle: 'СФБОЧ-КсОК', internalCode: 'СКЛ-2026-013 · POK-2026-006' });
  });
  it('правила переноса из заявки: автоартикул → взять; свой другой → конфликт; тот же → ничего; занят другой позицией → дубль', () => {
    expect(decideArticle('СКЛ-2026-013', 'СФБОЧ-КсОК')).toBe('set');
    expect(decideArticle('', 'ILT57,2')).toBe('set');
    expect(decideArticle('СФБОЧ-КсОК', 'сфбоч-ксок')).toBe('same');
    expect(decideArticle('ABC-1', 'XYZ-2')).toBe('conflict');
    expect(decideArticle('СКЛ-2026-224', 'СФБОЧ-КсОК', true)).toBe('duplicate');
    expect(decideArticle('СКЛ-2026-013', '')).toBe('skip');
    expect(decideArticle('СКЛ-2026-013', 'СКЛ-2026-099')).toBe('skip');
  });
});
