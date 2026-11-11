import { api } from '../../../core/api.js';

/** Запросы воронки «Новое КП» (C081). Сервер: POST /offers/pack — все КП одним вызовом. */
const PREF_KEY = 'dc-offer-pack-prefs'; // тот же ключ, что у «КП от других фирм»: фирмы и наценка запоминаются
export const readPrefs = () => { try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; } };
export const writePrefs = (o) => { try { localStorage.setItem(PREF_KEY, JSON.stringify(o)); } catch { /* приватный режим */ } };

export const loadFirms = () => api('/offers/companies').then((x) => x?.items || []).catch(() => []);
export const findProducts = (q) => api('/showcase', { query: { search: q, limit: 12 } }).then((x) => x?.items || []).catch(() => []);
export const createPack = (body) => api('/offers/pack', { method: 'POST', body });

/** Цена с наценкой — как на сервере (offer-rules markedUp). */
export const marked = (price, pct) => Math.round((Number(price) * (100 + Number(pct || 0))) / 100);
/** Сумма КП по строкам воронки с наценкой фирмы. */
export const sumOf = (lines, pct) => lines.reduce((s, l) => s + (Number(l.qty) || 0) * marked(Number(l.price) || 0, pct), 0);

/** Тело POST /offers/pack из состояния воронки. */
export function packBody(S, firms) {
  const day = (add) => { const t = new Date(); t.setDate(t.getDate() + add); return t.toISOString().slice(0, 10); };
  const L = S.last || {};
  const num = (v) => (Number(v) > 0 ? Number(v) : undefined);
  return {
    customer: S.customer.trim(),
    ...(S.partyId ? { counterpartyId: S.partyId } : {}),
    date: day(0), validUntil: day(10),
    ...(L.objectName ? { objectName: L.objectName } : {}),
    ...(L.delivery ? { delivery: L.delivery } : {}),
    prepaymentPercent: num(L.prepaymentPercent), productionDays: num(L.productionDays), deliveryDays: num(L.deliveryDays),
    items: S.lines.map((l) => ({
      productId: l.id, productSku: l.sku || undefined, productName: l.name, quantity: Number(l.qty) || 1, unit: l.unit || 'шт',
      ...(Number(l.price) > 0 ? { unitPrice: Number(l.price) } : {}),
      ...(l.color ? { color: l.color } : {}), ...(l.size ? { size: l.size } : {}),
      ...(l.photoUrl ? { photoUrl: l.photoUrl } : {}), ...(l.description ? { description: l.description } : {}),
    })),
    companies: firms.map((f) => ({ companyId: f.id, markupPercent: f.pct })),
  };
}
