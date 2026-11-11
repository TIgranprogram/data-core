import { api } from '../../../core/api.js';
import { PD_KEYS } from '../../products/data.js';

/** Запросы воронки паспорта (C028, договор API A1–A5). Сервер: docs/crew/C028-passport-funnel/TZ.md. */
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== ''));

/** A2: срез воронки — шаги со значениями и числами + изделия. */
export const funnelData = (q) => api('/passports/funnel', { query: clean(q) });
/** A3: чего не хватает изделию для паспорта. */
export const loadGaps = (id) => api(`/showcase/${id}/passport-gaps`);
export const getProduct = (id) => api(`/showcase/${id}`);
/** A4: признаки изделия целиком (список id значений). */
export const setFacets = (id, facetValueIds) => api(`/showcase/${id}`, { method: 'PATCH', body: { facetValueIds } });
/** Поля самого изделия (габариты, вес) — в изделие, не в умолчания паспорта: их проверяет выпуск. */
export const patchProduct = (id, body) => api(`/showcase/${id}`, { method: 'PATCH', body });

/**
 * Умолчания паспорта изделия (PUT заменяет их целиком — берём известные поля + то, что меняем).
 * prod.passportDefaults обновляется на месте, чтобы следующий ответ не стёр предыдущий.
 */
export async function putDefaults(prod, change) {
  const pd = { ...(prod.passportDefaults || {}), ...change };
  const keys = new Set([...PD_KEYS, ...Object.keys(change)]);
  const body = { ...Object.fromEntries([...keys].filter((k) => pd[k] !== undefined && pd[k] !== null && pd[k] !== '').map((k) => [k, pd[k]])), textChoices: pd.textChoices || {} };
  await api(`/showcase/${prod.id}/passport-defaults`, { method: 'PUT', body });
  prod.passportDefaults = pd;
}

/** A5: дерево фраз для шага «Тексты» — разделы шаблона категории, в каждом варианты (первыми — по признакам изделия, byFacet). */
export async function loadTexts(category, productId) {
  // дерево разделов и вариантов — /passports/funnel (sections); какие варианты подходят изделию и какие по его признакам — A5 phrases[]
  const [t, f] = await Promise.all([
    api('/passports/texts', { query: clean({ category, productId }) }).catch(() => ({})),
    api('/passports/funnel', { query: { category } }).catch(() => null)]);
  const tree = f?.sections || [];
  if (!Array.isArray(t.phrases)) return tree;
  const ok = new Map(t.phrases.map((p) => [String(p.id), p]));
  const keep = (nodes) => nodes.map((n) => {
    if (n.children?.length) { const children = keep(n.children); return children.length ? { ...n, children } : null; }
    const p = ok.get(String(n.id)); return p ? { ...n, byFacet: !!p.byFacet } : null;
  }).filter(Boolean);
  return keep(tree);
}

/**
 * Паспорт изделия: черновик из изделия → проверка → выпуск. Не хватает — черновик убирается, возвращается список.
 * Фирму выбирает менеджер (все isOurCompany). Первую из нескольких молча не подставляем.
 * extra: { supplierOrgId, incomeId?, salesOrderId?, orderNo?, customerName? }
 */
export async function issueFromProduct(productId, extra = {}) {
  const supplierOrgId = extra.supplierOrgId || undefined;
  if (!supplierOrgId) throw new Error('Выберите фирму');
  const draft = await api('/passports', { method: 'POST', body: clean({
    productId, supplierOrgId, incomeId: extra.incomeId, salesOrderId: extra.salesOrderId, orderNo: extra.orderNo, customerName: extra.customerName,
  }) });
  const id = draft.id || draft._id;
  const full = await api(`/passports/${id}`);
  if (full.missing?.length) { await api(`/passports/${id}`, { method: 'DELETE' }).catch(() => {}); return { missing: full.missing }; }
  await api(`/passports/${id}/issue`, { method: 'POST' });
  return { passport: await api(`/passports/${id}`) };
}
