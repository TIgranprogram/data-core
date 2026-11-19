import { effectiveClassification, type ClassificationMetadata, type ClassificationInput } from '../../common/financial-classification';
import { costCenterLabel } from '../supply/cost-center';
import type { Op } from './cashflow';
export interface OperationIdentity { operationId: string; sourceId: string; companyId: string; paymentId?: string; allocationId?: string; invoiceId?: string; sourceLink: string; scopeRequestId?: string; classificationEditable: boolean; classificationReason?: string | null; warnings?: string[] }
/** Тот же effective resolver применяется до всех денежных сводок, не только на новой странице. */
export function classifiedOperation(base: Op, source: ClassificationInput & ClassificationMetadata, identity: OperationIdentity): Op {
  const effective = effectiveClassification(source);
  return { ...base, ...identity, warnings: [...new Set([...(base.warnings || []), ...((source as ClassificationMetadata & { warnings?: string[] }).warnings || []), ...(identity.warnings || [])])], companyName: base.company, counterpartyName: base.counterparty || null, docNo: base.doc,
    classificationVersion: Number(source.classificationVersion || 0),
    classificationOrigin: Object.keys(source.classificationOverride || {}).length ? 'override' : source.classificationOriginal ? 'snapshot' : 'source',
    originOperationId: source.originOperationId, classificationProvenance: source.classificationProvenance,
    articleId: effective.articleId || undefined, salesOrderId: effective.salesOrderId || undefined, costObject: effective.costObject,
    costCenterCode: effective.costCenter, costCenter: costCenterLabel({ costCenter: effective.costCenter, salesOrderId: effective.salesOrderId }),
  };
}
