import { effectiveClassification, originalClassification } from './financial-classification';
describe('Финансовая классификация', () => {
  it('absence наследует original, null явно снимает только выбранную связь', () => {
    const source = { articleId: 'a', salesOrderId: 'source-order', costCenter: 'office', classificationOverride: { articleId: null } } as const;
    expect(effectiveClassification(source)).toEqual({ articleId: null, salesOrderId: 'source-order', costCenter: 'office', costObject: null });
    expect(source.salesOrderId).toBe('source-order');
  });
  it('сохранённый original не меняется с будущими подсказками документа', () => {
    expect(originalClassification({ articleId: 'new-hint', classificationOriginal: { articleId: 'old' } }).articleId).toBe('old');
    expect(effectiveClassification({ articleId: 'new', classificationOriginal: { articleId: 'old' }, classificationOverride: {} }).articleId).toBe('old');
  });
});
