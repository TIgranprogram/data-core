/** Типизированные значения юридического комплекта: неизвестное не превращается в ноль или текущую дату. */
export const ISSUE_FIELDS = {
  objectAddress: 'Адрес объекта', productionOrder: 'Производственный заказ', counterparty: 'Покупатель', payment: 'Оплата', drawing: 'Чертёж', catalogMatch: 'Сопоставление каталога', other: 'Другое уточнение', signature: 'Подписание', signedDate: 'Дата подписания',
  paymentVerification: 'Проверка оплаты', paymentPlan: 'План оплаты', deliveryTerms: 'Доставка и монтаж',
  deadlineTerms: 'Условия срока', productionAssignment: 'Привязка к заказу', productMatching: 'Сопоставление изделий',
};
export const ISSUE_STATES = { unknown: 'Нужно уточнить', conflict: 'Противоречие', not_applicable: 'Не применяется', resolved: 'Заполнено' };
export const SIGNATURE_STATES = { unknown: 'Не проверено', seller_only: 'В копии подпись продавца', both: 'Подписано обеими сторонами', not_applicable: 'Не применяется' };
export const DOCUMENT_KINDS = { contract: 'Договор', customer_invoice: 'Счёт покупателю', customer_order: 'Заказ покупателя', offer: 'КП', specification: 'Спецификация', addendum: 'Дополнительное соглашение', payment_evidence: 'Подтверждение оплаты', acceptance: 'Акт / УПД' };
export const PAYMENT_EVENTS = { signed: 'Подписание договора', advance_received: 'Зачисление аванса', installation_completed: 'Завершение монтажа', acceptance: 'Приёмка', fixed: 'Установленная дата' };
export const copyLegal = (legal) => JSON.parse(JSON.stringify(legal));
export const openIssues = (legal) => (legal?.issues || []).filter((x) => ['unknown', 'conflict'].includes(x.state));
export const legalDay = (value) => String(value || '').slice(0, 10);
export function optionalNumber(value) {
  if (value === '' || value === null || value === undefined) return undefined;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0) throw new Error('Укажите число не меньше нуля или оставьте поле пустым.');
  return n;
}
export function offerTotals(items = []) {
  const cents = (rows) => rows.reduce((sum, x) => sum + Math.round(Number(x.quantity || 0) * Number(x.unitPrice || 0) * 100), 0) / 100;
  return { source: cents(items), agreed: cents(items.filter((x) => x.scopeState !== 'excluded')) };
}
export function replaceByUid(rows, value) {
  return rows.some((x) => x.uid === value.uid) ? rows.map((x) => x.uid === value.uid ? value : x) : [...rows, value];
}

/** Ручной черновик не придумывает дату/сумму/подпись: задачи менеджеру отделены от производственного заказа. */
export function manualLegalDraft(source = {}) {
  return { state: 'draft', currency: 'RUB', ...(source.contractDate ? { sourceDate: source.contractDate } : {}), ...(source.orderNo ? { sourceNumber: source.orderNo } : {}),
    signature: { state: 'unknown' }, paymentVerification: 'unknown', documents: [], paymentPlan: [], origin: { kind: 'manual' },
    issues: [
      { uid: 'object-address', field: 'objectAddress', label: 'Уточнить адрес объекта', reason: 'Адрес объекта пока не указан.', state: 'unknown' },
      { uid: 'signature', field: 'signature', label: 'Проверить подписание', reason: 'Нужен подписанный экземпляр или подтверждение ЭДО.', state: 'unknown' },
      { uid: 'payment-verification', field: 'paymentVerification', label: 'Проверить поступления', reason: 'Фактические суммы и даты зачисления нужно сверить отдельно.', state: 'unknown' },
      ...(!source.contractDate ? [{ uid: 'contract-date', field: 'other', label: 'Уточнить дату договора', reason: 'В исходном документе дата пока не установлена.', state: 'unknown' }] : []),
    ],
  };
}
