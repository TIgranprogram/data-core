/** Общая часть «Для всех» паспорта v2 в passporttemplates (отдельно от шаблона «Для всех» PDF v1). */
export const ALL_V2 = 'ALL_V2';

export type Doc = Record<string, unknown>;
export const SORT = ['passportNo', 'date', 'name', 'category', 'customerName', 'createdAt', 'updatedAt'];
/** Поля модели — переходят в копию паспорта и подставляются из выбранной модели (ПС.5). */
export const MODEL_FIELDS = ['productId', 'name', 'category', 'article', 'height', 'length', 'width', 'weight', 'materials', 'purpose', 'installationMethod', 'description', 'supplierOrgId', 'supplier', 'warrantyMonths', 'bom',
  // v2 (БЗ-6): поля модели — копия на ту же модель и выбор модели переносят их
  'passportCategory', 'elements', 'materialIds', 'materialsSpec', 'installationTypeId', 'isKit', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth', 'serviceLifeYears'] as const;
/** Массовое изменение (БЗ-9): общие поля паспортов; номера, талон, наименование, артикул, картинки — только по одному. */
export const BULK_PASSPORT_FIELDS = ['passportCategory', 'category', 'installationTypeId', 'elements', 'materialIds', 'isKit', 'serviceLifeYears', 'warrantyMonths', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth',
  'supplierOrgId', 'customerName', 'orderNo', 'objectName', 'installedBy', 'saleDate', 'installedAt'] as const;
export const BULK_NUMBER_FIELDS = ['serviceLifeYears', 'warrantyMonths', 'ageFrom', 'ageTo', 'heightMin', 'heightMax', 'weightMax', 'maxUsers', 'fallHeight', 'siteLength', 'siteWidth'] as const;
/** НМ-1: у выпущенного паспорта свободно меняются только эти поля (заполняются после печати). */
export const AFTER_PRINT_FIELDS = ['saleDate', 'customerName', 'customerOrgId', 'orderNo', 'salesOrderId', 'objectName', 'installedBy', 'installedAt', 'note'] as const;
/** НМ: выпущен ли паспорт (нет статуса и есть номер — старый, выпущенный до НМ). */
export const isIssued = (d: { status?: unknown; passportNumber?: unknown }) => d.status === 'issued' || (!d.status && !!d.passportNumber && !isDraftNumber(d.passportNumber));
/**
 * НМ: у черновика вместо номера — служебная метка `draft-<id>`: уникальный индекс passportNumber в общей с CRM базе
 * не допускает двух пустых номеров, а у CRM kppdf номер обязателен. Человеку метка не показывается (список «—», PDF без номера).
 */
export const DRAFT_PREFIX = 'draft-';
export const isDraftNumber = (n: unknown) => String(n ?? '').startsWith(DRAFT_PREFIX);
/** Выданные номера: без `confirmNumbers: true` не меняются (ПС, «не менять молча»). */
export const NUMBER_FIELDS = ['passportNumber', 'productCode', 'warrantyCode', 'date'] as const;
export const OID_FIELDS = ['productId', 'customerOrgId', 'salesOrderId', 'supplierOrgId', 'installationTypeId', 'manufacturerOrgId'] as const;
export { escapeRe } from '../../common/list-query';
