/** C161: единая типизированная аналитика; не денежный факт и не источник прав доступа. */
export const CLASSIFICATION_FIELDS = ['articleId', 'salesOrderId', 'costCenter', 'costObject'] as const;
export const FINANCIAL_COST_CENTERS = ['workshop', 'office', 'smr', 'order'] as const;
export type FinancialCostCenter = typeof FINANCIAL_COST_CENTERS[number];
export interface FinancialClassification { articleId: string | null; salesOrderId: string | null; costCenter: FinancialCostCenter | null; costObject: string | null }
export interface ClassificationHistoryEntry { at: Date; by?: string; authorName?: string; reason: string; clientUid: string; requestHash: string; version: number; before: FinancialClassification; after: FinancialClassification; original?: FinancialClassification; override?: Partial<FinancialClassification>; resetToOriginal?: boolean }
export interface ClassificationMetadata {
  classificationOriginal?: Partial<FinancialClassification>;
  classificationOverride?: Partial<FinancialClassification>;
  classificationVersion?: number;
  classificationHistory?: ClassificationHistoryEntry[];
  originOperationId?: string;
  classificationProvenance?: 'payment-snapshot' | 'current-request' | 'category-hint' | 'source-field' | 'legacy-none';
}
export type ClassificationInput = Partial<Record<typeof CLASSIFICATION_FIELDS[number], unknown>>;
const ref = (value: unknown): string | null => value == null || value === '' ? null : String(value);
export function originalClassification(source: ClassificationInput & ClassificationMetadata): FinancialClassification {
  const original = source.classificationOriginal || source;
  const center = String(original.costCenter || '');
  return { articleId: ref(original.articleId), salesOrderId: ref(original.salesOrderId), costCenter: (FINANCIAL_COST_CENTERS as readonly string[]).includes(center) ? center as FinancialCostCenter : null, costObject: ref(original.costObject) };
}
export function effectiveClassification(source: ClassificationInput & ClassificationMetadata): FinancialClassification {
  const original = originalClassification(source), override = source.classificationOverride || {};
  const result = { ...original };
  for (const field of CLASSIFICATION_FIELDS) if (Object.prototype.hasOwnProperty.call(override, field) && override[field] !== undefined) (result as Record<string, unknown>)[field] = override[field];
  return result;
}
export const hasClassificationHistory = (source: ClassificationMetadata) => !!source.classificationHistory?.length || !!Object.keys(source.classificationOverride || {}).length;
