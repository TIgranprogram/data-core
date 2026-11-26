// Права показа рабочего места. Сервер отдельно проверяет каждый запрос.
import { viewAsActive } from './view-as.js';

export const OWNER = Object.freeze({
  passfunnel: 'docs', passports: 'docs', passarchive: 'docs', orderpass: 'docs', doctpl: 'docs',
  salesorder: 'salesorders', orderedit: 'salesorders', worklaunch: 'salesorders', workplan: 'salesorders',
  shipdo: 'salesorders', matching: 'salesorders', specimport: 'salesorders',
  wsstep: 'workschedule', designorder: 'design', prodreq: 'design', designsettings: 'design',
  profile: 'home', movements: 'stock', stockop: 'stock', stockissue: 'stock', resedit: 'stock', ops: 'stock',
  pasteorder: 'requests', reqstep: 'requests', orderbulk: 'requests', invoicecard: 'requests', invoice: 'requests',
  reqreceive: 'requests', contract: 'partners', staffcard: 'staff', zonecard: 'staff', dict: 'dicts',
  incpay: 'money', incprice: 'money', expense: 'money', payout: 'payroll', finstart: 'money', moneyclassification: 'money',
  pricelist: 'suppliercatalog', kp: 'products', catalogimport: 'products', fromorders: 'products',
  frompassports: 'products', composition: 'products', compsug: 'products', techsheet: 'products',
  modulecomp: 'modules', partblank: 'parts', partwork: 'parts', offerpack: 'offers', offerfunnel: 'offers',
  ptext: 'products', ptextview: 'products', ptnode: 'products',
});
const sections = new Set(['requests', 'stock', 'suppliercatalog', 'salesorders', 'design', 'work',
  'products', 'offers', 'docs', 'partners', 'money', 'payroll', 'stock-mobile', 'my-tasks']);
const general = new Set(['desk', 'home', 'atlas', 'help', 'chat', 'search', 'trash', 'dicts', 'fill']);
const stockScreens = new Set(['home', 'stock', 'stock-mobile', 'movements', 'atlas', 'help', 'profile']);
const aliases = { expenses: 'money', workschedule: 'work', contracts: 'requests', modules: 'products', parts: 'products' };

export function stockView(user) {
  if (/труб[ао]рез/i.test(user?.roleLabel || '')) return 'pipe';
  if (/лазер\s+лист/i.test(user?.roleLabel || '')) return 'sheet';
  if (/^(деревообработка|кладовщик дерева)(?:\s*\(телефон\))?$/iu.test(user?.roleLabel?.trim() || '')) return 'wood';
  return null;
}

export function mobileOnly(user) {
  return !user?.isOwner && user?.role !== 'admin' && user?.sections?.length === 1 && user.sections[0] === 'stock-mobile';
}

export function woodScreen(session, view) {
  return stockView(session.user) === 'wood' || (session.isAdmin && view === 'wood');
}

export function allowsWoodPanel(session, { of, open, new: isNew }) {
  return of === 'profile' || (of === 'wooditem' && isNew && !open && session.canEdit) || (!of && !open && !isNew);
}

export function canOpen(session, route, screen, params = {}) {
  const user = session.user;
  if (!user || !route) return false;
  if (mobileOnly(user)) return route === 'stock-mobile' && !screen;
  if (route === 'wooditem') return screen === 'stock' && session.canEdit && canOpen(session, 'stock');
  const native = stockView(user);
  const nativeReceipt = (native === 'pipe' || native === 'sheet') && route === 'stockop' && screen === 'stock'
    && session.canEdit && params.new === '1' && !params.open && params.op === 'in'
    && params.workerKind === native && Boolean(params.workerZone) && !stockScreenAccess(session, params.view).readOnly;
  if (native && !stockScreens.has(route) && !nativeReceipt) return false;
  if (native === 'wood' && (route === 'movements' || (screen && route === 'stock'))) return false;
  const permitted = (id) => user.isOwner || user.role === 'admin' || !Array.isArray(user.sections) || user.sections.includes(id);
  const owner = Object.hasOwn(OWNER, route) ? OWNER[route] : route;
  if (owner === 'kit') return session.role === 'admin';
  if (owner === 'stockzone') return session.isAdmin;
  if (['staff', 'history'].includes(owner)) return session.isAdmin || session.role === 'director';
  if (route === 'contract') return permitted('requests') || permitted('partners');
  if (route === 'specimport' && !permitted('stock')) return false;
  if (route === 'bulkedit') return ['stock', 'products', 'docs', 'passports'].includes(screen) && canOpen(session, screen);
  if (owner === 'orders') return session.canMoney && (screen || permitted('money')) && (permitted('orders') || permitted('salesorders'));
  if (general.has(owner)) return true;
  if (['modules', 'parts'].includes(owner) && !session.isAdmin && !['director', 'manager'].includes(session.role)) return false;
  const id = Object.hasOwn(aliases, owner) ? aliases[owner] : owner;
  if (id === 'docs') return session.canEdit && (permitted('docs') || permitted('passports'));
  if (id === 'money' && !session.canMoney) return false;
  if (id === 'payroll' && !session.canPayroll) return false;
  return sections.has(id) && permitted(id);
}

/** Один выбор экрана для меню, прямого URL и mount. Дополнительные экраны — только просмотр. */
export function stockScreenAccess(session, requestedView) {
  const native = stockView(session.user);
  const view = ['pipe', 'sheet', 'wood'].includes(requestedView) ? requestedView : native;
  const denied = { allowed: false, view, readOnly: true };
  if (!canOpen(session, 'stock')) return denied;
  if (!view) return { allowed: true, view: null, readOnly: false };
  const preview = (view === 'pipe' || view === 'sheet') && viewAsActive(session.realUser);
  if (session.isAdmin) return { allowed: true, view, readOnly: preview };
  if (native) return native === view ? { allowed: true, view, readOnly: preview || !session.canEdit } : denied;
  const user = session.user;
  const views = Object.hasOwn(user, 'stockViews')
    ? (Array.isArray(user.stockViews) ? user.stockViews.filter(value => ['pipe', 'sheet'].includes(value)) : [])
    : (session.role === 'director' ? ['pipe', 'sheet'] : []);
  return views.includes(view) ? { allowed: true, view, readOnly: true } : denied;
}

export function canViewStock(session, view) {
  return stockScreenAccess(session, view).allowed;
}

/** В дополнительном режиме просмотра нет панелей складских операций. */
export function allowsStockPanel(session, params) {
  return !stockScreenAccess(session, params.view).readOnly || ((!params.of || params.of === 'profile') && !params.open && !params.new);
}

export function canFollow(session, href) {
  if (typeof href !== 'string' || !href.startsWith('#')) return false;
  const [route, query] = href.replace(/^#\/?/, '').split('?');
  const params = new URLSearchParams(query);
  const panel = params.get('of');
  const isWood = route === 'stock' && woodScreen(session, params.get('view'));
  if (route === 'stock' && !allowsStockPanel(session, { view: params.get('view'), of: panel, open: params.get('open'), new: params.get('new') })) return false;
  if (panel === 'wooditem' && !isWood) return false;
  if (isWood && !allowsWoodPanel(session, { of: panel, open: params.get('open'), new: params.get('new') })) return false;
  return canOpen(session, route) && (route !== 'stock' || canViewStock(session, params.get('view'))) &&
    (!panel || canOpen(session, panel, route, Object.fromEntries(params)));
}

export const todayRoute = { delivery: 'requests', shipment: 'salesorders', design: 'design', question: 'design', work: 'work', payment: 'money' };
const todayBlocks = { delivery: 'requests', work: 'work', shipment: 'salesorders', payment: 'money',
  questions: 'design', passports: 'docs', contracts: 'contracts', fill: 'fill', unmatched: 'salesorders', money: 'money' };
export function seesTodayBlock(session, kind) {
  return !Object.hasOwn(todayBlocks, kind) || canOpen(session, todayBlocks[kind]);
}
export function visibleToday(session, dashboard) {
  const visible = event => canOpen(session, todayRoute[event.kind]);
  return { ...dashboard, feed: (dashboard.feed || []).filter(visible),
    week: (dashboard.week || []).map(day => ({ ...day, events: day.events.filter(visible) })) };
}
