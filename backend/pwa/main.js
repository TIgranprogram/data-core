/* «Рабочее место» — вход, шапка, разделы (docs/PRODUCT.md, docs/CANON.md).
 * Раздел = описание в sections/*.js; список, карточка и форма — общие компоненты из ui/. */
import { api, events, login, PREFIX, session } from './core/api.js';
import { $, h } from './core/dom.js';
import { current, go, onChange, patch } from './core/router.js';
import { openCard } from './ui/card.js';
import { icon } from './ui/icons.js';
import { mountList } from './ui/list.js';
import { mountHome } from './sections/home.js';
import { movements } from './sections/movements.js';
import { mountMoney } from './sections/money.js';
import { mountOps } from './sections/ops.js';
import { orders } from './sections/orders.js';
import { requests } from './sections/requests.js';
import { mountSearch } from './sections/search.js';
import { stock } from './sections/stock.js';
import { mountTrash } from './sections/trash.js';

const SECTIONS = { requests, stock, movements, orders };
const NAV = [['home', 'Сегодня', 'home'], ['requests', 'Заявки', 'requests'], ['stock', 'Остатки', 'stock'], ['ops', 'Операции', 'ops'], ['movements', 'Движения', 'moves'], ['orders', 'Заказы', 'orders'], ['money', 'Платёжный календарь', 'money']];
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
  const gs = h('input', { type: 'search', placeholder: 'Найти заявку, позицию, поставщика…', 'aria-label': 'Поиск по всему' });
  gs.addEventListener('keydown', (e) => { if (e.key === 'Enter' && gs.value.trim()) { go('search', { q: gs.value.trim() }); gs.blur(); } });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) { e.preventDefault(); gs.focus(); }
  });
  const initials = (session.name || '?').split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Меню' },
    h('a', { class: 'brand', href: '#' + DEFAULT }, h('img', { src: 'icon.svg', alt: '' }), h('span', null, 'Рабочее место', h('small', null, 'единая база'))),
    navLinks.home,
    h('div', { class: 'side-group' }, 'Снабжение'), navLinks.requests,
    h('div', { class: 'side-group' }, 'Склад'), navLinks.stock, navLinks.ops, navLinks.movements,
    h('div', { class: 'side-group' }, 'Деньги'), navLinks.orders, navLinks.money,
    h('div', { class: 'side-foot' },
      navLinks.trash,
      session.user?.role === 'admin' ? h('a', { class: 'side-link', href: PREFIX + '/admin/', title: 'Администрирование' }, icon('admin'), h('span', { class: 'lbl' }, 'Администрирование')) : null,
      // CRM живёт на том же домене в корне (https://kppdf-crm.ru/), приложение — под /db/; локально CRM нет
      PREFIX ? h('a', { class: 'side-link', href: '/', title: 'CRM' }, icon('crm'), h('span', { class: 'lbl' }, 'CRM')) : null,
      themeButton(),
      h('div', { class: 'side-user' }, h('span', { class: 'avatar' }, initials),
        h('div', { class: 'who' }, h('b', null, session.name), h('span', null, roleName(session.user?.role)))),
      h('a', { class: 'side-link', href: '#', title: 'Выйти', onclick: (e) => { e.preventDefault(); session.clear(); showLogin(); } }, icon('logout'), h('span', { class: 'lbl' }, 'Выйти'))));
  netBar = h('div', { class: 'net-off', hidden: true }, 'Нет связи с сервером — изменения сейчас не сохранятся. Проверьте интернет.');
  const topbar = h('header', { class: 'topbar' },
    h('button', { class: 'btn btn-ghost btn-icon burger', type: 'button', 'aria-label': 'Меню', onclick: () => shellEl.classList.toggle('nav-open') }, icon('menu')),
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
    const [r, s, o] = await Promise.all([api('/supply/requests', { query: { limit: 1 } }), api('/stock/items', { query: { limit: 1 } }), api('/incomes', { query: { limit: 1 } }).catch(() => null)]);
    if (o) set('orders', o.counts?.awaiting || 0);
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
    else if (section === 'trash') list = mountTrash();
    else if (section === 'search') list = mountSearch(params);
    else { go(DEFAULT, {}, { replace: true }); return; }
    ui.main.replaceChildren(list.el);
    mounted = { key, section, list };
    document.title = (sec?.title || ({ home: 'Сегодня', ops: 'Операции', money: 'Деньги', trash: 'Корзина', search: 'Поиск' })[section]) + ' · Рабочее место';
    window.scrollTo(0, 0);
  } else {
    mounted.list.update?.(params);
  }
  syncCard(section, params);
}

/** Открыть запись: в адрес (для «Назад» и ссылки), без нового шага истории на каждую запись. */
function openRecord(section, id) {
  go(section, { ...current().params, open: id, new: undefined }, { replace: !!current().params.open });
}

/** Карточка: open=<id> или new=1; of=<раздел записи>, если запись другого раздела (на «Сегодня», заявка из склада). */
function syncCard(section, params) {
  const ofName = params.of || (section === 'home' ? undefined : section);
  const sec = SECTIONS[ofName];
  const want = sec && (params.new ? 'new' : params.open ? 'open:' + params.open : null);
  if (!want) { closeCard(); return; }
  const key = ofName + want;
  if (card?.key === key) return;
  // Та же панель, другая запись (стрелки, клик по соседней строке) — меняем содержимое, без закрытия
  if (card && card.of === ofName && want.startsWith('open:') && card.key.includes('open:') && !card.handle.editing) {
    card.key = key;
    card.handle.load(params.open);
    return;
  }
  closeCard();
  const clear = { open: undefined, new: undefined, of: undefined, title: undefined, unit: undefined, categoryName: undefined };
  const ctx = {
    close: () => { card = null; patch(clear); },
    changed: () => { mounted?.list?.reload?.(); refreshCounts(); },
    opened: (id) => { card.key = ofName + 'open:' + id; patch({ ...clear, of: ofName !== section ? ofName : undefined, open: id }); },
  };
  if (params.new) {
    if (!session.canEdit || !sec.form) { patch({ new: undefined }); return; }
    const initial = { ...(sec.form.initial ? sec.form.initial() : {}) };
    for (const k of ['title', 'unit', 'categoryName']) if (params[k]) initial[k] = params[k];
    card = { key, of: ofName, handle: openCard(sec, { mode: 'create', initial }, ctx) };
  } else {
    card = { key, of: ofName, handle: openCard(sec, { id: params.open }, ctx) };
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
