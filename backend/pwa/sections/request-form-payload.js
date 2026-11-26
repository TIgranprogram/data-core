import { isoDay, parseNum } from '../core/format.js';
import { PRIORITY, SUPPLY_STATUS, supplyKey } from '../ui/kit/badges.js';
import { joinRef, splitRef } from './salesorders.js';

export function toInitial(row) {
  return {
    ...row,
    articleId: row.articleId ? String(row.articleId) : '',
    photos: row.photos || [],
    salesOrderRef: joinRef(row),
    status: supplyKey(row),
    priority: row.priority || 'normal',
    requestDate: row.requestDate ? isoDay(row.requestDate) : '',
    invoiceDate: row.invoiceDate ? String(row.invoiceDate).slice(0, 10) : '',
  };
}

export function requestBody(v, row) {
  const s = (x) => (x === null ? '' : String(x));
  const linked = !!v.materialId; // поля позиции не шлём — истина в карточке склада
  const inInvoice = !!(row && row.invoiceId); // реквизиты строки счёта правятся в счёте
  const body = {
    qty: v.qty ?? 1,
    orderLabel: s(v.orderLabel), requestedBy: s(v.requestedBy),
    invoiceType: s(v.invoiceType), deliveryNote: s(v.deliveryNote), notes: s(v.notes),
    statusLabel: SUPPLY_STATUS[v.status]?.label, priorityLabel: PRIORITY[v.priority]?.label,
    photoIds: v.photos || [],
  };
  if ('unit' in v) body.unit = s(v.unit);
  if ('productUrl' in v) body.productUrl = s(v.productUrl);
  if (!linked) {
    body.title = s(v.title);
    body.categoryName = s(v.categoryName);
    body.article = s(v.article);
    body.color = s(v.color);
  }
  if (!inInvoice) body.priceHint = v.priceHint; // null очищает сумму
  if (v.requestDate) body.requestDate = v.requestDate;
  body.costCenter = v.costCenter || '';
  body.costObject = v.costObject || '';
  if (!inInvoice) {
    if ('supplierName' in v) body.supplierName = s(v.supplierName);
    if ('companyName' in v) body.companyName = s(v.companyName);
    if ('invoiceNo' in v) body.invoiceNo = s(v.invoiceNo);
    if ('invoiceDate' in v) body.invoiceDate = v.invoiceDate || '';
  }
  if ('articleId' in v) body.articleId = v.articleId || null;
  if (v.materialId) body.materialId = String(v.materialId);
  if ('responsibleId' in v) body.responsibleId = v.responsibleId || '';
  Object.assign(body, splitRef(v.salesOrderRef));
  if (body.salesOrderId && !v.orderLabel) delete body.orderLabel; // подпись заказа поставит сервер
  return body;
}

export function requestPatch(values, row, body, initialArticleId) {
  const initial = toInitial(row);
  initial.articleId = initialArticleId ?? initial.articleId;
  const initialValues = Object.fromEntries(Object.keys(values).map(key => {
    if (key === 'photos') return [key, initial.photos.map(photo => photo.id)];
    if (key === 'qty' || key === 'priceHint') return [key, parseNum(initial[key]) ?? null];
    const text = String(initial[key] ?? '');
    const normalized = key === 'notes' ? text.replace(/\r\n?/g, '\n') : text;
    return [key, normalized.trim() || null];
  }));
  const previous = requestBody(initialValues, row);
  return Object.fromEntries(Object.entries(body).filter(([key, value]) => {
    if (value === undefined) return false;
    if (key === 'photoIds') return JSON.stringify(value) !== JSON.stringify(previous.photoIds);
    return !Object.is(value, previous[key]);
  }));
}
