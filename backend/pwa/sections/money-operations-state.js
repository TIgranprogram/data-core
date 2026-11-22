import { businessToday } from './invoice-workspace-state.js';
export const FINANCE_FILTER_KEYS = ['from', 'to', 'type', 'companyId', 'articleId', 'salesOrderId', 'productionNo', 'salesOrderLineId', 'personId', 'costCenter', 'counterpartyId', 'counterpartyName', 'source', 'unassigned'];
/** Частичный URL-patch: «Все заказы» снимает оба legacy alias, сохраняя другие условия. */
export function financialFilterChanges(key, value) {
  return { [key]: value || undefined, page: undefined, ...(key === 'companyId' ? { org: undefined } : {}), ...(key === 'type' ? { articleId: undefined } : {}), ...(key === 'articleId' ? { unassigned: undefined } : {}), ...(key === 'counterpartyName' ? { counterpartyId: undefined } : {}), ...(['salesOrderId', 'productionNo'].includes(key) ? { mode: undefined, order: undefined, salesOrderLineId: undefined, [key === 'salesOrderId' ? 'productionNo' : 'salesOrderId']: undefined } : {}) };
}
export function financialQuery(params = {}) {
  const today = businessToday(), year = /^\d{4}-\d{2}$/.test(params.month || '') ? params.month.slice(0, 4) : today.slice(0, 4);
  const query = { from: params.from || year + '-01-01', to: params.to || (year === today.slice(0, 4) ? today : year + '-12-31') };
  for (const key of FINANCE_FILTER_KEYS.slice(2)) if (params[key]) query[key] = params[key];
  if (!query.companyId && params.org && params.org !== 'all') query.org = params.org;
  if (!query.salesOrderId && params.mode === 'object' && params.order) query.salesOrderId = params.order;
  const day = value => { const date = new Date(value + 'T00:00:00Z'); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error('Проверьте даты периода'); return date.getTime(); };
  const span = (day(query.to) - day(query.from)) / 86400000;
  if (span < 0 || span > 365) throw new Error('Период должен быть от1 до366 дней');
  return query;
}
export function operationsQuery(params) {
  return { ...financialQuery(params), includeDescendants: 1, page: Math.max(1, Math.trunc(Number(params.page) || 1)), limit: Math.max(1, Math.min(100, Math.trunc(Number(params.limit) || 30))), sort: params.sort === 'amount' ? 'amount' : 'date', dir: params.dir === 'asc' ? 'asc' : 'desc' };
}
export function classificationBody(row, values, clientUid) {
  if (row.classificationEditable !== true) throw new Error(row.classificationReason || row.classificationEditableReason || row.reason || 'Классификация этого источника недоступна');
  const reason = String(values.reason || '').trim();
  if (reason.length < 3 || reason.length > 1000) throw Object.assign(new Error('Укажите причину: от3 до1000 символов'), { field: 'reason' });
  const version = Number(row.classificationVersion);
  if (!Number.isInteger(version) || version < 0) throw new Error('Обновите операцию: версия классификации неизвестна');
  const body = { reason, clientUid, version };
  if (values.resetToOriginal === true || values.action === 'reset') return { ...body, resetToOriginal: true };
  const centers = ['workshop', 'office', 'smr', 'order'];
  if (values.costCenter && !centers.includes(values.costCenter)) throw Object.assign(new Error('Выберите направление затрат'), { field: 'costCenter' });
  const costObject = String(values.costObject || '').trim(); if (costObject.length > 1000) throw Object.assign(new Error('Уточнение объекта: до1000 символов'), { field: 'costObject' });
  for (const key of ['articleId', 'salesOrderId', 'costCenter', 'costObject']) if (Object.hasOwn(values, key)) body[key] = key === 'costObject' ? costObject || null : values[key] || null;
  return body;
}

/** Адресная подготовка истории: только серверный план, никаких ID из индекса/суммы/даты. */
export function identityPreparationBody(plan, clientUid) {
  if (plan?.canApply !== true || !(plan.changesCount > 0)) throw new Error((plan?.blockers || []).join(' ') || 'История не требует подготовки или пока не может быть подготовлена');
  if (!Number.isInteger(plan.version) || plan.version < 0 || typeof plan.planHash !== 'string' || !plan.planHash) throw new Error('Обновите план подготовки: данные проверки неполны');
  if (!Array.isArray(plan.items) || !plan.items.length) throw new Error('Нет оплат для проверки плана');
  return { confirm: true, version: plan.version, clientUid, planHash: plan.planHash };
}
