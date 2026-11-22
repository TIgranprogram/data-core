// Ссылки стола разрешаются только через штатный API исходной карточки.
import { api, session } from '../core/api.js';
import { canFollow } from '../core/route-access.js';
import { recentThumb } from '../core/recent-cards.js';
import { deskNext } from './desk-next.js';

const TYPES = {
  salesorders: ['Заказ', 'orders', '/production-orders', 'salesorders', 'orders'],
  salesorder: ['Договор заказчика', 'orders', '/salesorders', 'salesorders', 'orders'],
  orders: ['Позиция заказа', 'table', '/incomes', 'salesorders', 'orders'],
  design: ['Проектирование', 'board', '/design-tasks', 'design', 'orders'],
  work: ['Изготовление', 'ops', '/work-tasks', 'work', 'orders'],
  products: ['Изделие', 'stock', '/showcase', 'products', 'products'],
  modules: ['Модуль', 'gallery', '/modules', 'modules', 'products'],
  parts: ['Деталь', 'table', '/materials', 'parts', 'products'],
  requests: ['Заявка снабжения', 'requests', '/supply/requests', 'requests', 'supply'],
  stock: ['Позиция склада', 'stock', '/stock/items', 'stock', 'stock'],
  offers: ['КП', 'orders', '/offers', 'offers', 'products'],
  passarchive: ['Паспорт', 'orders', '/passports', 'docs', 'products'],
  passports: ['Паспорт', 'orders', '/passports', 'docs', 'products'],
  contract: ['Договор поставщика', 'orders', '/supply/contracts', 'contracts', 'supply'],
  suppliercatalog: ['Номенклатура', 'stock', '/supply/catalog/items', 'suppliercatalog', 'supply'],
  partners: ['Контрагент', 'partners', '/partners', 'partners', 'supply'],
  personal: ['Личная задача', 'table', '', '', 'personal'],
};
const text = (value) => typeof value === 'string' ? value.trim() : '';
const joined = (...values) => values.map(text).filter(Boolean).join(' · ');
const numbered = (prefix, number) => number ? prefix + ' ' + String(number) : '';
export const deskKind = (of) => Object.hasOwn(TYPES, of) ? TYPES[of] : ['Карточка', 'orders', '', '', 'personal'];
const isID = (id) => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
export function deskRef(entry) {
  const { id, of } = entry || {};
  if (!deskKind(of)[2] || typeof id !== 'string' || !id || id.trim() !== id || /[\u0000-\u001f\u007f\\]/u.test(id)) return null;
  const group = of === 'salesorders' && id.length <= 50 && id !== '.' && id !== '..' && !id.includes('://');
  const customer = of === 'partners' && id.startsWith('c:') && id.length > 2 && id.length <= 160;
  if (!isID(id) && !group && !customer) return null;
  return { of: of === 'passports' ? 'passarchive' : of, id };
}
export function deskHref(item, screen = 'desk') {
  return '#' + screen + '?' + new URLSearchParams({ of: item.of, open: item.id });
}
export function deskCanRead(item) {
  return !!deskRef(item) && canFollow(session, deskHref(item, deskKind(item.of)[3])) && canFollow(session, deskHref(item));
}

function makeTitle(of, row, label) {
  if (of === 'salesorders') return numbered('Заказ №', row.productionNo || row.key) || label;
  if (of === 'salesorder') return numbered('Договор №', row.orderNo) || label;
  if (of === 'contract') return numbered('Договор №', row.no) || label;
  if (of === 'offers') return joined(row.number, row.title || row.customer) || label;
  if (['passarchive', 'passports'].includes(of)) return row.name || numbered('Паспорт №', row.number) || label;
  return joined(row.code, row.title || row.name || row.productName || row.materialName) ||
    numbered('Заявка №', row.num) || label;
}

function linksFor(of, row) {
  const links = [];
  const add = (dest, id, label) => {
    const item = { of: dest, id: String(id || '') };
    if (deskCanRead(item)) links.push({ label, href: deskHref(item) });
  };
  if (['work', 'design', 'orders', 'requests', 'offers', 'passarchive', 'passports', 'salesorder'].includes(of)) {
    const id = row.salesOrderId || (of === 'requests' ? null : row.orderId);
    const group = row.productionNo || id;
    if (group) add('salesorders', group, numbered('Заказ №', row.productionNo || row.orderNo) || 'Заказ');
  }
  const line = row.incomeId || row.salesOrderLineId;
  if (line) add('orders', line, numbered('Позиция', row.lineNo || row.seqNo));
  if (['design', 'work', 'orders', 'passarchive', 'passports'].includes(of) && row.productId)
    add('products', row.productId, 'Изделие');
  return links.map((link) => ({ ...link, label: link.label || 'Позиция заказа' }));
}

export async function loadDeskCard(item) {
  if (!deskCanRead(item)) return { unavailable: true };
  const { of, id } = item;
  const [, , endpoint] = deskKind(of);
  try {
    const row = await api(endpoint + '/' + encodeURIComponent(id), { quiet: true, query: endpoint === '/passports' ? { readOnly: 1 } : undefined });
    if (!row || !deskCanRead(item)) return { unavailable: true };
    const [, , , , color] = deskKind(of);
    const photos = [row.photoThumb, row.thumb, row.photo, row.photos?.[0], row.orders?.[0]?.lines?.[0]?.photo];
    const thumb = photos.flatMap((photo) => typeof photo === 'string' ? [photo] : [photo?.thumb, photo?.url]).map(recentThumb).find(Boolean);
    const customer = row.customer || row.customerName || row.orders?.map((order) => order.customer).find(Boolean);
    return {
      title: makeTitle(of, row, deskKind(of)[0]), color, thumb,
      subtitle: joined(row.sku || row.article, customer || row.supplierName || row.group),
      due: row.deadline || row.productionDeadline || row.neededBy || row.shipDate || row.validUntil,
      next: deskNext(of, row), links: linksFor(of, row), href: deskHref(item),
    };
  } catch (e) {
    return e?.status === 403 || e?.status === 404 ? { unavailable: true } : { failed: true };
  }
}
