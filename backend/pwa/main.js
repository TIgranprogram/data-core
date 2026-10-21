/* «Рабочее место» — вход, шапка, разделы (docs/PRODUCT.md, docs/CANON.md).
 * Раздел = описание в sections/*.js; список, карточка и форма — общие компоненты из ui/. */
import { api, events, login, PREFIX, session } from './core/api.js';
import { $, debounce, h } from './core/dom.js';
import { closeStep, current, go, onChange, onNav, patch, setGuard } from './core/router.js';
import { confirmDlg } from './ui/dialog.js';
import { openCard } from './ui/card.js';
import { icon } from './ui/icons.js';
import { mountList } from './ui/list.js';
import { mountHome } from './sections/home.js';
import { movements } from './sections/movements.js';
import { mountMoney } from './sections/money.js';
import { mountOps } from './sections/ops.js';
import { mountPayroll } from './sections/payroll.js';
/** Включаемые разделы: ФОТ — презентационный (TASKS Д3.6), false — пропадёт из меню и не откроется. */
const FEATURES = { payroll: true };
import { orders } from './sections/orders.js';
import { salesorders } from './sections/salesorders.js';
import { partners } from './sections/partners.js';
import { dict, mountDicts } from './sections/dicts.js';
import { mountFill } from './sections/fill.js';
import { invoice, pasteOrder } from './sections/invoice.js';
import { requests } from './sections/requests.js';
import { mountSearch } from './sections/search.js';
import { stock } from './sections/stock.js';
import { mountTrash } from './sections/trash.js';
// раздел «История» — под своим именем: иначе импорт перекрывает window.history и ‹ › ломаются (НВ.1)
import { history as historySection } from './sections/history.js';
import { products } from './sections/products.js';
import { catalogImport, kp } from './sections/kp.js';

const SECTIONS = { requests, stock, movements, orders, salesorders, partners, invoice, pasteorder: pasteOrder, dict, history: historySection, products, kp, catalogimport: catalogImport };
const NAV = [['home', 'Сегодня', 'home'], ['requests', 'Заявки', 'requests'], ['ops', 'Операции', 'ops'], ['stock', 'Остатки', 'stock'], ['movements', 'Движения', 'moves'], ['salesorders', 'Заказы', 'orders'], ['partners', 'Контрагенты', 'partners'], ['products', 'Продукция', 'stock'], ['orders', 'Позиции и оплаты', 'money'], ['money', 'Платёжный календарь', 'money'], ['payroll', 'ФОТ', 'partners']];
const DEFAULT = 'home';
const root = $('#root');

// ---------- Вход ----------
function showLogin(message) {
  closeCard();
  const err = h('div', { class: 'form-error', hidden: !message }, message || '');
  const user = h('input', { name: 'username', autocomplete: 'username', required: true });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Войти');
  const form = h('form', { class: 'login-card' },
    h('img', { src: 'icon.svg', alt: '' }), h('h1', null, 'Вход'), h('div', { class: 'muted' }, 'Логин и пароль сотрудника — те же, что в CRM.'),
    err, h('label', { class: 'field' }, h('span', null, 'Логин'), user), h('label', { class: 'field' }, h('span', null, 'Пароль'), pass), btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Вход…'; err.hidden = true;
    try { await login(user.value.trim(), pass.value); showApp(); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Войти'; pass.select(); }
  });
  root.replaceChildren(h('div', { class: 'login' },
    h('div', { class: 'login-art' }, h('img', { src: 'icon.svg', alt: '', style: { width: '48px', height: '48px' } }),
      h('h2', null, 'Рабочее место — ', h('span', { class: 'gold' }, 'заявки, склад и учёт'), ' в одном окне'),
      h('p', null, 'Все данные — в единой базе компании: заявки снабжения, остатки и движения склада.')),
    h('div', { class: 'login-side' }, form)));
  user.focus();
}
events.onAuthLost = () => { session.clear(); showLogin('Сессия истекла — войдите снова.'); };

// ---------- Каркас: меню слева, сверху поиск ----------
let navLinks = {};
let netBar;
let shellEl;
function shell() {
  const link = (id, label, ico) => h('a', { class: 'side-link', href: '#' + id, title: label, onclick: () => shellEl.classList.remove('nav-open') },
    icon(ico), h('span', { class: 'lbl' }, label), h('span', { class: 'cnt', hidden: true }));
  navLinks = Object.fromEntries(NAV.map(([id, label, ico]) => [id, link(id, label, ico)]));
  navLinks.trash = link('trash', 'Корзина', 'trash');
  navLinks.dicts = link('dicts', 'Справочники', 'dicts');
  navLinks.history = link('history', 'История', 'history'); // И.2 — директор и администратор
  const seesHistory = session.user?.isOwner === true || ['admin', 'director'].includes(session.user?.role);
  const gs = h('input', { type: 'search', placeholder: 'Найти заявку, позицию, поставщика…', 'aria-label': 'Поиск по всему' });
  // Ищет сразу при вводе (от 2 знаков, пауза 0,4 с); в истории — один шаг «Поиск», а не каждая буква. Enter — сразу.
  const runSearch = () => { const q = gs.value.trim(); if (q.length < 2) return; go('search', { q }, { replace: current().section === 'search' }); };
  const liveSearch = debounce(runSearch, 400);
  gs.addEventListener('input', liveSearch);
  gs.addEventListener('keydown', (e) => { if (e.key === 'Enter' && gs.value.trim()) { go('search', { q: gs.value.trim() }, { replace: current().section === 'search' }); gs.blur(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) { e.preventDefault(); gs.focus(); }
  });
  const initials = (session.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Меню' },
    h('a', { class: 'brand', href: '#' + DEFAULT }, h('img', { src: 'icon.svg', alt: '' }), h('span', null, 'Рабочее место', h('small', null, 'единая база'))),
    navLinks.home,
    h('div', { class: 'side-group' }, 'Снабжение'), navLinks.requests,
    h('div', { class: 'side-group' }, 'Склад'), navLinks.ops, navLinks.stock, navLinks.movements,
    h('div', { class: 'side-group' }, 'Заказы'), navLinks.salesorders, navLinks.products, navLinks.partners,
    session.canMoney ? [h('div', { class: 'side-group' }, 'Деньги'), navLinks.orders, navLinks.money, FEATURES.payroll ? navLinks.payroll : null] : null,
    h('div', { class: 'side-foot' },
      navLinks.dicts,
      seesHistory ? navLinks.history : null,
      navLinks.trash,
      session.user?.role === 'admin' ? h('a', { class: 'side-link', href: PREFIX + '/admin/', title: 'Администрирование' }, icon('admin'), h('span', { class: 'lbl' }, 'Администрирование')) : null,
      // CRM живёт на том же домене в корне (https://kppdf-crm.ru/), приложение — под /db/; локально CRM нет
      PREFIX ? h('a', { class: 'side-link', href: '/', title: 'CRM' }, icon('crm'), h('span', { class: 'lbl' }, 'CRM')) : null,
      themeButton(),
      h('div', { class: 'side-user' }, h('span', { class: 'avatar' }, initials),
        h('div', { class: 'who' }, h('b', null, session.name), h('span', null, roleName(session.user?.role)))),
      h('a', { class: 'side-link', href: '#', title: 'Выйти', onclick: (e) => { e.preventDefault(); session.clear(); showLogin(); } }, icon('logout'), h('span', { class: 'lbl' }, 'Выйти'))));
  netBar = h('div', { class: 'net-off', hidden: true }, 'Нет связи с сервером — изменения сейчас не сохранятся. Проверьте интернет.');
  // ‹ › (НВ.3): неактивны, когда некуда; подсказка — куда ведут («Назад: Склад»)
  const backBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Назад', onclick: () => window.history.back() }, '‹');
  const fwdBtn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', 'aria-label': 'Вперёд', onclick: () => window.history.forward() }, '›');
  onNav((i) => {
    backBtn.disabled = !i.canBack; fwdBtn.disabled = !i.canForward;
    backBtn.title = i.canBack ? `Назад: ${screenTitle(i.backUrl)} (Alt+←)` : 'Назад — это первый экран';
    fwdBtn.title = i.canForward ? `Вперёд: ${screenTitle(i.forwardUrl)} (Alt+→)` : 'Вперёд — некуда';
  });
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'btn btn-ghost btn-icon burger', type: 'button', 'aria-label': 'Меню', onclick: () => shellEl.classList.toggle('nav-open') }, icon('menu')),
    // назад / вперёд — всегда в одном месте (история браузера: раздел, фильтр, открытая карточка)
    h('div', { class: 'histnav' },
      backBtn, fwdBtn),
    h('div', { class: 'gsearch' }, gs, h('kbd', null, '/')));
  const main = h('main', { class: 'page', id: 'page' });
  shellEl = h('div', { class: 'shell' }, sidebar, h('div', { class: 'side-back', onclick: () => shellEl.classList.remove('nav-open') }),
    h('div', { class: 'main' }, topbar, netBar, main));
  root.replaceChildren(shellEl);
  refreshCounts();
  return { main, gs };
}
const roleName = (r) => ({ admin: 'администратор', director: 'руководитель', manager: 'менеджер', user: 'просмотр' })[r] || r || '';
events.onNet = (ok) => { if (netBar) netBar.hidden = ok; };

/** Кнопка темы: как в системе → светлая → тёмная (theme.js). */
function themeButton() {
  const name = h('span', null, window.dcTheme?.name() || 'как в системе');
  return h('button', { class: 'side-link', type: 'button', title: 'Тема оформления', onclick: () => { name.textContent = window.dcTheme?.cycle() || ''; } },
    icon('theme'), h('span', { class: 'lbl' }, 'Тема: ', name));
}

/** Счётчики в меню: активные заявки; позиции к закупке и без остатка. */
async function refreshCounts() {
  const set = (id, n) => { const c = navLinks[id]?.querySelector('.cnt'); if (c) { c.textContent = String(n); c.hidden = !n; } };
  try {
    const [r, s, o, so] = await Promise.all([api('/supply/requests', { query: { limit: 1 } }), api('/stock/items', { query: { limit: 1 } }), api('/incomes', { query: { limit: 1 } }).catch(() => null), api('/salesorders', { query: { limit: 1 } }).catch(() => null)]);
    if (o) set('orders', o.counts?.awaiting || 0);
    if (so) set('salesorders', so.counts?.active || 0);
    const c = r.counts || {};
    set('requests', (c.requested || 0) + (c.in_progress || 0) + (c.ordered || 0) + (c.paid || 0));
    set('stock', (s.counts?.low || 0) + (s.counts?.none || 0));
  } catch { /* счётчики не критичны */ }
}

// ---------- Разделы ----------
let ui = null;            // { main, gs }
let mounted = null;       // { key, section, list }
let card = null;          // { key, handle }

function closeCard() { if (card) { card.handle.close(); card = null; } }
/** Экран пересоздаётся только при смене раздела (и поиска по всему — у него свой запрос); остальное — update(). */
const screenKey = (section, params) => section + (section === 'search' ? '?' + (params.q || '') : '');

function render({ section, params }) {
  if (!section) { go(DEFAULT, {}, { replace: true }); return; }
  for (const [id, a] of Object.entries(navLinks)) a.classList.toggle('active', id === section);
  ui.gs.value = section === 'search' ? params.q || '' : '';

  const key = screenKey(section, params);
  const sec = SECTIONS[section];
  if (!mounted || mounted.key !== key) {
    mounted?.list?.destroy?.();
    let list = null;
    if (sec) {
      list = mountList(sec, params, {
        onOpen: (row) => openRecord(section, row.id),
        onCreate: () => go(section, { ...current().params, new: '1', open: undefined }, { replace: true }),
        quick: sec.quick ? sec.quick(() => { mounted?.list?.reload?.(); refreshCounts(); }) : null,
        onChanged: () => refreshCounts(),
      });
    } else if (section === 'home') list = mountHome({ open: (of, id) => go('home', { ...current().params, of, open: id }, { replace: true }), refreshCounts });
    else if (section === 'money') list = mountMoney(params);
    else if (section === 'ops') list = mountOps(params);
    else if (section === 'payroll' && FEATURES.payroll && session.canMoney) list = mountPayroll();
    else if (section === 'trash') list = mountTrash();
    else if (section === 'dicts') list = mountDicts(params);
    else if (section === 'fill') list = mountFill(params);
    else if (section === 'search') list = mountSearch(params);
    else { go(DEFAULT, {}, { replace: true }); return; }
    ui.main.replaceChildren(list.el);
    mounted = { key, section, list };
    document.title = screenTitle('#' + section) + ' · Рабочее место';
    window.scrollTo(0, 0);
  } else {
    mounted.list.update?.(params);
  }
  syncCard(section, params);
}

/** Открыть запись: в адрес (для «Назад» и ссылки) шагом «карточка»; соседняя запись в открытой карточке — без нового шага. */
function openRecord(section, id) {
  go(section, { ...current().params, open: id, new: undefined }, { replace: !!current().params.open, kind: 'card' });
}

/** Название экрана по адресу — для подсказок ‹ › и заголовка вкладки. */
const NAMES = { home: 'Сегодня', payroll: 'ФОТ', dicts: 'Справочники', fill: 'Требуют заполнения', ops: 'Операции', money: 'Деньги', trash: 'Корзина', search: 'Поиск' };
function screenTitle(url) {
  const [sec, qs = ''] = String(url || '').replace(/^#\/?/, '').split('?');
  const name = SECTIONS[sec]?.title || NAMES[sec] || 'Сегодня';
  return /(^|&)(open|new)=/.test(qs) ? `${name} (карточка)` : name;
}

/**
 * Защита ввода (НВ.4): «Назад» / «Вперёд» / ссылка при открытом окне — сначала закрывается окно (как жест «назад» на Android);
 * при несохранённой форме в карточке — одно подтверждение «Выйти без сохранения?». Нет — остаёмся, ввод цел.
 */
setGuard(async (next) => {
  const dlg = document.querySelector('.modal-back');
  if (dlg) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return false; }
  if (card?.handle?.isDirty?.()) {
    const ofName = next.params.of || (next.section === 'home' ? undefined : next.section);
    const stays = ofName === card.of && (next.params.open || next.params.new) && card.key.includes(next.params.new ? 'new' : 'open:' + next.params.open);
    if (!stays) return confirmDlg('Выйти без сохранения?', 'Изменения в форме не сохранены.', { okText: 'Выйти' });
  }
  return true;
});

/** Карточка: open=<id> или new=1; of=<раздел записи>, если запись другого раздела (на «Сегодня», заявка из склада). */
function syncCard(section, params) {
  const ofName = params.of || (section === 'home' ? undefined : section);
  const sec = SECTIONS[ofName];
  const want = sec && (params.new ? 'new' : params.open ? 'open:' + params.open : null);
  if (!want) { closeCard(); return; }
  const key = ofName + want + (params.fill ? '~' + params.fill : '');
  if (card?.key === key) return;
  // Та же панель, другая запись (стрелки, клик по соседней строке) — меняем содержимое, без закрытия
  if (card && card.of === ofName && !params.fill && want.startsWith('open:') && card.key.includes('open:') && !card.key.includes('~') && !card.handle.editing) {
    card.key = key;
    card.handle.load(params.open);
    return;
  }
  closeCard();
  const clear = { open: undefined, new: undefined, of: undefined, fill: undefined, title: undefined, unit: undefined, categoryName: undefined };
  const ctx = {
    close: () => { card = null; closeStep(clear); }, // открыта шагом — «назад», иначе убрать open= без нового шага (НВ.2)
    changed: () => { mounted?.list?.reload?.(); refreshCounts(); },
    opened: (id) => { card.key = ofName + 'open:' + id; patch({ ...clear, of: ofName !== section ? ofName : undefined, open: id }); },
  };
  if (params.new) {
    if (!session.canEdit || !sec.form) { patch({ new: undefined }); return; }
    const initial = { ...(sec.form.initial ? sec.form.initial() : {}) };
    for (const k of ['title', 'unit', 'categoryName', 'orderNo', 'customer', 'companyName', 'orderId']) if (params[k]) initial[k] = params[k];
    card = { key, of: ofName, handle: openCard(sec, { mode: 'create', initial }, ctx) };
  } else {
    card = { key, of: ofName, handle: openCard(sec, { id: params.open, fill: params.fill }, ctx) };
  }
}

async function showApp() {
  ui = shell();
  mounted = null; card = null;
  render(current());
  // Свежие данные о пользователе (роль могла измениться)
  api('/auth/me').then((me) => { if (me?.id || me?.username) session.user = { ...session.user, ...me }; }).catch(() => {});
}
onChange((c) => { if (ui && session.refresh) render(c); });
// «Отменить» во всплывающем сообщении и другие изменения вне списка — обновить текущий экран и счётчики меню
window.addEventListener('data-changed', () => { mounted?.list?.reload?.(); refreshCounts(); });
window.addEventListener('online', () => events.onNet(true));
window.addEventListener('offline', () => events.onNet(false));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* без офлайн-оболочки */ });
if (session.refresh) showApp(); else showLogin();
