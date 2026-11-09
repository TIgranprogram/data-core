import { api } from '../core/api.js';
import { assertOperation } from './invoice-workspace-state.js';

export const getInvoice = (id) => api(`/supply/invoices/${id}`);
/** Удалить пустой неоплаченный счёт (сервер сам проверит, что можно). */
export const deleteInvoice = (id) => api(`/supply/invoices/${id}`, { noWait: true, method: 'DELETE' });
export const getPayers = () => api('/incomes/lookups').then((r) => (r.companies || []).map((c) => ({ value: String(c.id), label: c.name })));
export const getContracts = (supplierId) => supplierId ? api('/supply/contracts', { query: { supplierId, limit: 100, status: 'active' } }).then((r) => r.items || []) : Promise.resolve([]);
/** total относится к исходной выборке, а не к отфильтрованным непривязанным строкам. */
export async function getCandidates(invoice, { page = 1, q = '', limit = 50 } = {}) {
  const result = await api('/supply/requests', { query: { status: 'requested,ordered,paid,in_progress', ...(invoice.supplierId ? { supplierId: String(invoice.supplierId) } : {}), page, limit, ...(q ? { search: q } : {}) } });
  return { ...result, page, limit, items: (result.items || []).filter((r) => !r.invoiceId && !r.deletedAt) };
}
/**
 * Заявки того же поставщика, которые уже лежат в ДРУГОМ счёте (ещё не приняты): их можно перенести сюда.
 * У каждой — `from` (счёт-источник: id, no, status) для подписи и проверки «оплачен — не переносим».
 */
export async function getBusyRequests(invoice, { q = '', limit = 80 } = {}) {
  const result = await api('/supply/requests', { query: { status: 'requested,ordered,in_progress', ...(invoice.supplierId ? { supplierId: String(invoice.supplierId) } : {}), page: 1, limit, ...(q ? { search: q } : {}) } });
  const items = (result.items || []).filter((r) => r.invoiceId && String(r.invoiceId) !== String(invoice.id) && !r.deletedAt);
  const ids = [...new Set(items.map((r) => String(r.invoiceId)))];
  const invs = new Map((await Promise.all(ids.map((id) => getInvoice(id).catch(() => null)))).filter(Boolean).map((v) => [String(v.id), v]));
  return items.map((r) => ({ ...r, from: invs.get(String(r.invoiceId)) || { id: String(r.invoiceId), no: r.invoiceNo || null, status: null } }));
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
