import { api } from '../core/api.js';
import { assertOperation } from './invoice-workspace-state.js';

export const getInvoice = (id) => api(`/supply/invoices/${id}`);
export const getPayers = () => api('/incomes/lookups').then((r) => (r.companies || []).map((c) => ({ value: String(c.id), label: c.name })));
export const getContracts = (supplierId) => supplierId ? api('/supply/contracts', { query: { supplierId, limit: 100, status: 'active' } }).then((r) => r.items || []) : Promise.resolve([]);
/** total относится к исходной выборке, а не к отфильтрованным непривязанным строкам. */
export async function getCandidates(invoice, { page = 1, q = '', limit = 50 } = {}) {
  const result = await api('/supply/requests', { query: { status: 'requested,ordered,paid,in_progress', ...(invoice.supplierId ? { supplierId: String(invoice.supplierId) } : {}), page, limit, ...(q ? { search: q } : {}) } });
  return { ...result, page, limit, items: (result.items || []).filter((r) => !r.invoiceId && !r.deletedAt) };
}
/** Одна команда = один write. Здесь нет GET после write, повтора, merge, toast или маршрутизации. */
export function writeInvoice(invoice, rights, operation, body = {}, lineId) {
  assertOperation(invoice, rights, operation, lineId);
  const base = `/supply/invoices/${invoice.id}`;
  if (operation === 'meta') return api(base, { noWait: true, method: 'PATCH', body });
  if (operation === 'line') return api(`${base}/lines/${lineId}`, { noWait: true, method: 'PATCH', body });
  if (operation === 'add') return api(`${base}/requests`, { noWait: true, method: 'POST', body });
  if (operation === 'remove') return api(`${base}/lines/${lineId}`, { noWait: true, method: 'DELETE' });
  if (operation === 'issue') return api(base, { noWait: true, method: 'PATCH', body: { issue: true } });
  return api(`${base}/${operation}`, { noWait: true, method: 'POST', body });
}
