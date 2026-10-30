/* «Рабочее место» — вход, шапка, разделы (docs/PRODUCT.md, docs/CANON.md).
 * Раздел = описание в sections/*.js; список, карточка и форма — общие компоненты из ui/. */
import { api, canEditSection, events, login, PREFIX, session, trackLoad } from './core/api.js';
import { $, h } from './core/dom.js';
import { closeStep, current, go, onChange, onNav, patch, setGuard } from './core/router.js';
import { confirmDlg, modal } from './ui/dialog.js';
import { searchBox } from './ui/searchbox.js';
import { openCard } from './ui/card.js';
import { installGlobalErrors } from './ui/errors.js';
import { toast, toastError } from './ui/toast.js';
import { icon } from './ui/icons.js';
import { closePopMenu, isOpenFor, openPopMenu } from './ui/pop-menu.js';
import { mountList } from './ui/list.js';
import { mountHome } from './sections/home.js';
import { lookups } from './sections/lookups.js';
/** Включаемые разделы: ФОТ — презентационный (TASKS Д3.6), false — пропадёт из меню и не откроется. */
const FEATURES = { payroll: true };
// раздел «История» — под своим именем: иначе импорт перекрывает window.history и ‹ › ломаются (НВ.1)
import { versionLabel, watchUpdates } from './core/update-check.js';
import { avatarNode } from './ui/avatars.js';
import { bellButton } from './ui/bell.js';
import { chatButton } from './ui/chat-button.js';
import { serverPrefs, startPrefs } from './core/prefs.js';
import { makeResizable } from './ui/resizer.js';
import { reportError } from './core/errors.js';
import { failBlock } from './ui/busy.js';
import { setCrumbs, crumbsEl } from './ui/crumbs.js';
// ОШ2: сбой запроса (сеть, 5xx, ответ не разобрался) — в сборщик; GET — фоновая загрузка, запись — действие человека
events.onFail = (e, { url, method }) => reportError(e, { kind: method === 'GET' ? 'background' : 'action', action: method === 'GET' ? 'загрузка' : 'запись', url });
// ОШ: любая необработанная ошибка — в сборщик и понятным русским текстом (детали — в консоль), без повторов;
// нет связи — уже видна полоса «нет связи», всплывашка не нужна
installGlobalErrors((e) => { reportError(e, { kind: 'unhandled' }); if (e?.status !== 0) toastError(e); });

// Скорость: разделы грузятся при первом открытии (import() с кэшем промиса), а не все сразу при старте (канал медленный).
const SECTIONS = {};   // имя раздела -> описание (заполняется по мере загрузки)
const FN = {};         // имя функции монтирования -> функция
// ключ загрузчика -> [загрузчик модуля, [[имя в SECTIONS или @функция, экспорт]]]
const LAZY = {
  requests: [() => import('./sections/requests.js'), [['requests','requests'],['reqreceive','reqReceive']]],
  stock: [() => import('./sections/stock.js'), [['stock','stock']]],
  movements: [() => import('./sections/movements.js'), [['movements','movements']]],
  orders: [() => import('./sections/orders.js'), [['orders','orders'],['incpay','incPay'],['incprice','incPrice']]],
  salesorders: [() => import('./sections/salesorders.js'), [['salesorders','salesorders'],['salesorder','salesorder']]],
  design: [() => import('./sections/design.js'), [['design','design']]],
  work: [() => import('./sections/work.js'), [['work','work']]],
  offers: [() => import('./sections/offers.js'), [['offers','offers']]],
  designorder: [() => import('./sections/design-order.js'), [['designorder','designOrder']]],
  profile: [() => import('./sections/profile.js'), [['profile','profile']]],
  matching: [() => import('./sections/matching-queue.js'), [['@mountMatchingQueue','mountMatchingQueue'], ['matching','matching']]],
  designsettings: [() => import('./sections/design-settings.js'), [['designsettings','designSettings']]],
  chat: [() => import('./sections/chat.js'), [['chat','chat']]],
  help: [() => import('./sections/help.js'), [['help','help']]],
  shipdo: [() => import('./sections/order-shipments.js'), [['shipdo','shipdo']]],
  partners: [() => import('./sections/partners.js'), [['partners','partners']]],
  contract: [() => import('./sections/contracts.js'), [['contract','contract'],['contracts','contracts']]],
  invoice: [() => import('./sections/invoice.js'), [['invoice','invoice'],['pasteorder','pasteOrder']]],
  reqstep: [() => import('./sections/request-step.js'), [['reqstep','reqStep']]],
  dicts: [() => import('./sections/dicts.js'), [['dict','dict'],['@mountDicts','mountDicts']]],
  history: [() => import('./sections/history.js'), [['history','history']]],
  products: [() => import('./sections/products.js'), [['products','products']]],
  passports: [() => import('./sections/passports.js'), [['passports','passports']]],
  docs: [() => import('./sections/docs.js'), [['doctpl','doctpl'],['passarchive','passarchive'],['@mountDocs','mountDocs']]],
  kp: [() => import('./sections/kp.js'), [['kp','kp'],['catalogimport','catalogImport'],['fromorders','fromOrders'],['frompassports','fromPassports']]],
  suppliercatalog: [() => import('./sections/supplier-catalog.js'), [['suppliercatalog','supplierCatalog'],['pricelist','priceList']]],
  composition: [() => import('./sections/composition.js'), [['composition','composition']]],
  bulkedit: [() => import('./sections/bulk-edit.js'), [['bulkedit','bulkEdit']]],
  stockop: [() => import('./sections/stock-ops.js'), [['stockop','stockOp']]],
  resedit: [() => import('./sections/reservation-edit.js'), [['resedit','resEdit']]],
  specimport: [() => import('./ui/spec-import.js'), [['specimport','specImport']]],
  compsug: [() => import('./ui/composition-suggest.js'), [['compsug','compSuggest']]],
  ptext: [() => import('./sections/passport-texts.js'), [['ptext','ptext'],['ptextview','ptextview']]],
  ptnode: [() => import('./sections/passport-tree.js'), [['ptnode','ptnode']]],
  money: [() => import('./sections/money.js'), [['@mountMoney','mountMoney'],['finstart','finStart']]],
  payroll: [() => import('./sections/payroll.js'), [['@mountPayroll','mountPayroll'],['payout','payout']]],
  staff: [() => import('./sections/staff.js'), [['@mountStaff','mountStaff'],['staffcard','staffCard'],['zonecard','zoneCard']]],
  trash: [() => import('./sections/trash.js'), [['@mountTrash','mountTrash']]],
  fill: [() => import('./sections/fill.js'), [['@mountFill','mountFill']]],
  search: [() => import('./sections/search.js'), [['@mountSearch','mountSearch']]],
  reqtabs: [() => import('./sections/requests-tabs.js'), [['@mountRequests','mountRequests']]],
};
// имя раздела (адрес / ?of=) -> ключ загрузчика, если они различаются
const LOADER_OF = { salesorder: 'salesorders', pasteorder: 'invoice', dict: 'dicts', dicts: 'dicts', doctpl: 'docs', passarchive: 'docs', catalogimport: 'kp', fromorders: 'kp', frompassports: 'kp', ptextview: 'ptext', staffcard: 'staff', zonecard: 'staff', contracts: 'contract', incpay: 'orders', incprice: 'orders', payout: 'payroll', finstart: 'money', reqreceive: 'requests', pricelist: 'suppliercatalog' };
const loading = {};
let warmed = false;
/** Прогрев (скорость): после входа, в простое, подтянуть частые разделы — первое открытие без ожидания. Один раз, ошибки молча. */
function warmUp() {
  if (warmed) return;
  warmed = true;
  const run = () => { ['salesorders', 'requests', 'stock', 'design', 'products'].forEach((k) => { loadSec(k).catch(() => {}); }); };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 5000 }); else setTimeout(run, 2500);
}
/** Загрузить модуль раздела (один раз; при сбое промис сбрасывается — повтор по «Повторить»). */
function loadSec(key) {
  const def = LAZY[key];
  if (!def) return Promise.resolve();
  return (loading[key] ??= def[0]().then((m) => {
    for (const [name, exp] of def[1]) { if (name[0] === '@') FN[name.slice(1)] = m[exp]; else SECTIONS[name] = m[exp]; }
  }).catch((e) => { delete loading[key]; throw e; }));
}
/** Какие модули ещё нужны экрану: сам раздел + раздел панели справа (?of=). */
function needed(section, params) {
  const keys = new Set();
  const add = (n) => { const k = LOADER_OF[n] || n; if (LAZY[k]) keys.add(k); };
  add(section); add(params?.of);
  if (section === 'requests') keys.add('reqtabs');
  if (section === 'money' && params?.tab === 'debts') keys.add('orders'); // «Долги» — список из orders.js
  return [...keys].filter((k) => LAZY[k][1].some(([n]) => (n[0] === '@' ? !FN[n.slice(1)] : !SECTIONS[n])));
}
const NAV = [['home', 'Сегодня', 'home'], ['requests', 'Заявки', 'requests'], ['stock', 'Остатки', 'stock'], ['suppliercatalog', 'Каталог поставщиков', 'partners'], ['contracts', 'Договоры', 'orders'], ['salesorders', 'Заказы', 'orders'], ['matching', 'Сопоставление', 'orders'], ['design', 'Проектирование', 'board'], ['work', 'В работе', 'ops'], ['products', 'Продукция', 'stock'], ['offers', 'КП', 'orders'], ['docs', 'Документация', 'orders'], ['partners', 'Контрагенты', 'partners'], ['money', 'Платёжный календарь', 'money'], ['payroll', 'ФОТ', 'partners'], ['staff', 'Сотрудники', 'partners']];
const DEFAULT = 'home';
// SK-8b: экраны, которые по адресу (#…) принадлежат пункту меню, — закрыты вместе с ним. Панели справа (?of=…) не фильтруются.
const OWNER = { salesorder: 'salesorders', designorder: 'design', designsettings: 'design', profile: 'home', shipdo: 'salesorders', movements: 'stock', stockop: 'stock', resedit: 'stock', ops: 'stock', pasteorder: 'requests', reqstep: 'requests', invoice: 'requests', contract: 'partners', staffcard: 'staff', zonecard: 'staff', incpay: 'money', incprice: 'money', payout: 'payroll', finstart: 'money', reqreceive: 'requests', pricelist: 'suppliercatalog',
  kp: 'products', catalogimport: 'products', fromorders: 'products', frompassports: 'products', composition: 'products', ptext: 'docs', ptextview: 'docs', ptnode: 'docs', passports: 'docs', passarchive: 'docs', doctpl: 'docs' };
// ЦВ-1: раздел данных → цвет (--sec-*)
const SEC_OF = { requests: 'supply', suppliercatalog: 'supply', contracts: 'supply', stock: 'stock', movements: 'stock', salesorders: 'orders', matching: 'orders', design: 'orders', work: 'orders', docs: 'orders', products: 'products', offers: 'products', orders: 'money', money: 'money' };
// Группа меню по разделу — для хлебных крошек (те же группы, что в боковом меню)
const GROUP_OF = { salesorders: 'Производство', matching: 'Производство', design: 'Производство', work: 'Производство', products: 'Продукция', offers: 'Продукция', docs: 'Продукция', stock: 'Склад', requests: 'Снабжение', suppliercatalog: 'Снабжение', contracts: 'Снабжение', orders: 'Деньги', money: 'Деньги', payroll: 'Деньги', staff: 'Управление' };
const NAV_IDS = new Set(NAV.map(([id]) => id));
/** Открыт ли экран по адресу для этой роли (не пункт меню и не принадлежит ему — открыт). */
const allowed = (section) => { const id = OWNER[section] || section; return !NAV_IDS.has(id) || session.sees(id); };
const root = $('#root');

// ---------- Вход ----------
function showLogin(message) {
  let last = ''; try { last = localStorage.getItem('dca_last_user') || ''; } catch { /* приватный режим */ }
  closeCard();
  const err = h('div', { class: 'form-error', hidden: !message }, message || '');
  const user = h('input', { name: 'username', autocomplete: 'username', required: true, value: last });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true });
  const remember = h('input', { type: 'checkbox', name: 'remember', checked: true });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Войти');
  const form = h('form', { class: 'login-card' },
    h('img', { src: 'icon.svg', alt: '' }), h('h1', null, 'Вход'), h('div', { class: 'muted' }, 'Логин и пароль сотрудника — те же, что в CRM.'),
    err, h('label', { class: 'field' }, h('span', null, 'Логин'), user), h('label', { class: 'field' }, h('span', null, 'Пароль'), pass),
    h('label', { class: 'check' }, remember, ' Запомнить меня'), btn);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true; btn.textContent = 'Вход…'; err.hidden = true;
    try { await login(user.value.trim(), pass.value, remember.checked); showApp(); serverPrefs(session.user?.uiPrefs); }
    catch (ex) { err.textContent = ex.message; err.hidden = false; btn.disabled = false; btn.textContent = 'Войти'; pass.select(); }
  });
  root.replaceChildren(h('div', { class: 'login' },
    h('div', { class: 'login-art' }, h('img', { src: 'icon.svg', alt: '', style: { width: '48px', height: '48px' } }),
      h('h2', null, 'Рабочее место — ', h('span', { class: 'gold' }, 'заявки, склад и учёт'), ' в одном окне'),
      h('p', null, 'Все данные — в единой базе компании: заявки снабжения, остатки и движения склада.')),
    h('div', { class: 'login-side' }, form)));
  (last && message ? pass : user).focus(); // сессия завершилась: логин подставлен, фокус на пароле
}
events.onAuthLost = () => { session.clear(); showLogin('Сессия завершена — войдите снова'); };

// ---------- «Обновить приложение» (2026-10-22): у установленного приложения нет кнопки браузера «обновить» ----------
// 2026-10-24: пункта «Обновить приложение» нет — новая версия приходит в колокольчик; внизу меню — тихий номер «v1.245»
function appVersion() {
  const el = h('div', { class: 'side-ver-foot' });
  versionLabel(el);
  return el;
}

// ---------- «Установить на телефон» (TASKS МП.2–МП.3) ----------
// Android Chrome отдаёт событие установки — кнопка сразу ставит приложение; иначе (iPhone, другой браузер) — короткая инструкция.
// Уже установленное (открыто как приложение) кнопку не показывает.
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
const isInstalled = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
/** Пункт «Установить на телефон»: null, если уже установлено. */
function installItem() {
  if (isInstalled()) return null;
  return { label: 'Установить на телефон', icon: 'phone', onSelect: async () => {
    if (installEvt) { installEvt.prompt(); await installEvt.userChoice.catch(() => null); installEvt = null; return; }
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
    modal({ title: 'Установить на телефон', okText: 'Понятно', cancelText: 'Закрыть', body: h('div', null,
      h('p', null, 'Приложение ставится прямо из браузера — значок появится на экране телефона, открывается как обычное приложение и работает без связи (изменения уйдут, когда связь появится).'),
      ios
        ? h('ol', null, h('li', null, 'Откройте этот адрес в Safari.'), h('li', null, 'Нажмите «Поделиться» (квадрат со стрелкой).'), h('li', null, 'Выберите «На экран „Домой“».'))
        : h('ol', null, h('li', null, 'Откройте этот адрес в Chrome на телефоне и войдите.'), h('li', null, 'Нажмите ⋮ (три точки справа сверху).'), h('li', null, 'Выберите «Установить приложение» или «Добавить на главный экран».')),
      h('p', { class: 'hint' }, 'Адрес: ' + location.origin + location.pathname)) });
  } };
}

// ---------- Каркас: меню слева, сверху поиск ----------
let navLinks = {};
let netBar;
let shellEl;
function shell() {
  const link = (id, label, ico) => h('a', { class: 'side-link' + (SEC_OF[id] ? ' sec-' + SEC_OF[id] : ''), href: '#' + id, title: label, onclick: () => shellEl.classList.remove('nav-open') },
    icon(ico), h('span', { class: 'lbl' }, label), h('span', { class: 'cnt', hidden: true }));
  // SK-8b: только разделы, отмеченные у роли (нет отметок — все, как раньше)
  navLinks = Object.fromEntries(NAV.filter(([id]) => session.sees(id)).map(([id, label, ico]) => [id, link(id, label, ico)]));
  const group = (title, ...links) => (links.some(Boolean) ? [h('div', { class: 'side-group' }, title), ...links] : null);
  let gsb;
  // Ищет сразу при вводе (от 2 знаков, пауза 0,4 с); в истории — один шаг «Поиск», а не каждая буква. Enter — сразу.
  // ПО.1: стёрли строку — назад на экран, с которого начали искать (без новой записи истории); 1 знак — не ищем
  let searchFrom = null;
  const runSearch = (raw) => {
    const q = String(raw ?? '').trim();
    if (!q) { if (current().section === 'search') { const [sec, qs = ''] = (searchFrom || '#home').replace(/^#/, '').split('?'); go(sec || 'home', Object.fromEntries(new URLSearchParams(qs)), { replace: true }); } searchFrom = null; return; }
    if (q.length < 2) return;
    if (current().section !== 'search') searchFrom = location.hash || '#home';
    go('search', { q }, { replace: current().section === 'search' });
  };
  // общий поиск (ПО.3): от 2 знаков (1 — подсказка), пауза 0,4 с, крестик / Esc — очистить и вернуться
  gsb = searchBox({ placeholder: 'Найти заявку, позицию, поставщика…', label: 'Поиск по всему', delay: 400, minLength: 2, className: 'gs-box', onSearch: runSearch, onEnter: (q) => { if (q.length >= 2) gsb.input.blur(); } });
  const gs = gsb.input;
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) { e.preventDefault(); gs.focus(); }
  });
  const sidebar = h('aside', { class: 'sidebar', 'aria-label': 'Меню' },
    h('a', { class: 'brand', href: '#' + DEFAULT }, h('img', { src: 'icon.svg', alt: '' }), h('span', null, 'Рабочее место', h('small', null, 'единая база'))),
    navLinks.home,
    // порядок разделов — пользователь 2026-10-28: Производство, Продукция, Склад, Снабжение, Деньги
    group('Производство', navLinks.salesorders, navLinks.matching, navLinks.design, navLinks.work), // «Контрагенты» — только в «Справочниках» (пользователь 2026-10-25: дубль в меню); в NAV остаются ради прав роли
    group('Продукция', navLinks.products, navLinks.offers, session.canEdit ? navLinks.docs : null),
    group('Склад', navLinks.stock),
    group('Снабжение', navLinks.requests, navLinks.suppliercatalog, navLinks.contracts),
    session.canMoney ? group('Деньги', navLinks.money, FEATURES.payroll && session.canPayroll ? navLinks.payroll : null) : null,
    group('Управление', navLinks.staff),
    h('div', { class: 'side-foot' }, settingsButton(), appVersion()));
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
    h('div', { class: 'gsearch' }, gsb.el, h('kbd', null, '/')),
    chatButton(),
    bellButton(),
    h('a', { class: 'btn btn-ghost btn-icon', href: '#help', title: 'Работа с сайтом: с чего начать', 'aria-label': 'Работа с сайтом' }, icon('help')),
    themeButton(),
    avatarButton());
  const main = h('main', { class: 'page', id: 'page' });
  makeResizable(sidebar, { prefKey: 'sidebarW', edge: 'right', label: 'Ширина меню' }); // ШП
  shellEl = h('div', { class: 'shell' }, sidebar, h('div', { class: 'side-back', onclick: () => shellEl.classList.remove('nav-open') }),
    h('div', { class: 'main' }, topbar, crumbsEl, netBar, main));
  root.replaceChildren(shellEl);
  refreshCounts();
  return { main, gs, gsb };
}
const roleName = (r) => ({ admin: 'администратор', director: 'руководитель', manager: 'менеджер', user: 'просмотр' })[r] || r || '';
events.onNet = (ok) => { if (netBar) netBar.hidden = ok; };

const logout = () => { session.clear(); showLogin(); };

/** Низ меню: один пункт «Настройки» → всплывающее меню вверх (DESIGN §4 «Всплывающее меню»). */
function settingsButton() {
  const btn = h('button', { class: 'side-link side-settings', type: 'button', title: 'Настройки', 'aria-label': 'Настройки', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: () => {
      if (isOpenFor(btn)) { closePopMenu(); return; }
      shellEl.classList.remove('nav-open');
      const seesHistory = session.user?.isOwner === true || ['admin', 'director'].includes(session.role);
      const nav = (id) => ({ label: id === 'dicts' ? 'Справочники' : id === 'trash' ? 'Корзина' : 'История', icon: id, href: '#' + id });
      const sys = [session.role === 'admin' ? { label: 'Администрирование', icon: 'admin', href: PREFIX + '/admin/' } : null,
        PREFIX ? { label: 'CRM', icon: 'crm', href: '/' } : null].filter(Boolean);
      openPopMenu({ anchor: btn, side: 'up', cls: 'pm-settings', groups: [
        { title: 'Данные', items: [nav('dicts'), nav('trash'), seesHistory ? nav('history') : null].filter(Boolean) },
        sys.length ? { title: 'Система', items: sys } : null,
        { title: 'Приложение', items: [installItem()] },
        { sep: true, items: [{ label: 'Выйти', icon: 'logout', danger: true, onSelect: logout }] },
      ] });
    } }, icon('settings'), h('span', { class: 'lbl' }, 'Настройки'));
  return btn;
}

const historyButton = () => h('a', { class: 'btn btn-ghost btn-icon', href: '#history', title: 'История', 'aria-label': 'История' }, icon('history'));

/** Иконка темы в шапке: система → светлая → тёмная (theme.js). */
function themeButton() {
  const btn = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', onclick: () => { window.dcTheme?.cycle(); upd(); } }, icon('theme'));
  const upd = () => { const t = 'Тема: ' + (window.dcTheme?.name() || 'как в системе'); btn.title = t; btn.setAttribute('aria-label', t); };
  upd();
  return btn;
}

/** Аватар в шапке → меню: имя, роль, «Мой профиль», тема, «Выйти». */
function avatarButton() {
  const btn = h('button', { class: 'avatar-btn avatar-wrap', type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false',
    onclick: () => {
      if (isOpenFor(btn)) { closePopMenu(); return; }
      openPopMenu({ anchor: btn, side: 'down', cls: 'pm-user',
        head: h('div', { class: 'pm-who' }, h('b', null, session.name || ''), h('span', null, session.user?.roleLabel || roleName(session.user?.role))),
        groups: [
          { items: [{ label: 'Мой профиль', icon: 'admin', onSelect: () => go(current().section, { ...current().params, of: 'profile', open: 'me' }) },
            { label: 'Тема: ' + (window.dcTheme?.name() || 'как в системе'), icon: 'theme', onSelect: () => window.dcTheme?.cycle() }] },
          { sep: true, items: [{ label: 'Выйти', icon: 'logout', danger: true, onSelect: logout }] }] });
    } });
  const paint = () => {
    btn.title = session.name || 'Профиль'; btn.setAttribute('aria-label', 'Профиль: ' + (session.name || ''));
    btn.replaceChildren(avatarNode(session.user || {}, 32));
  };
  paint();
  window.addEventListener('dc:profile', () => { if (btn.isConnected) paint(); });
  return btn;
}

/** Счётчики в меню: активные заявки; позиции к закупке и без остатка. */
let noCounters = false;
async function refreshCounts(only) {
  const set = (id, n) => { const c = navLinks[id]?.querySelector('.cnt'); if (c) { c.textContent = String(n); c.hidden = !n; } };
  // SK-8d: только по разделам, открытым роли (закрытые сервер отдаёт 403); каждый запрос — сам по себе, сбой одного не гасит другие
  const get = (id, path) => (session.sees(id) && (!only || only.has(id)) ? api(path, { query: { limit: 1 } }).catch(() => null) : Promise.resolve(null));
  // SPEED-2: один лёгкий запрос; сервер без /me/counters (404) — прежние шесть
  if (!noCounters) {
    try {
      const c = await api('/me/counters');
      const put = (id, key, n) => { if ((!only || only.has(id)) && n != null) set(id, n); };
      put('requests', 'requests', c.requests); put('stock', 'stockLow', c.stockLow); put('money', 'awaiting', c.awaiting);
      put('salesorders', 'salesorders', c.salesorders); put('design', 'design', c.design); put('work', 'work', c.work);
      return;
    } catch (e) { if (e?.status === 404) noCounters = true; /* иное — пробуем по-старому */ }
  }
  try {
    const [r, s, o, so, dz, wk] = await Promise.all([get('requests', '/supply/requests'), get('stock', '/stock/items'), get('money', '/incomes'), get('salesorders', '/salesorders'), get('design', '/design-tasks'), get('work', '/work-tasks')]);
    if (o) set('money', o.counts?.awaiting || 0); // «ждём оплату» — на пункте «Платёжный календарь»
    if (so) set('salesorders', so.counts?.active || 0);
    if (dz) set('design', (dz.counts?.queue || 0) + (dz.counts?.work || 0));
    if (wk) set('work', (wk.counts?.waiting || 0) + (wk.counts?.work || 0));
    if (r) { const c = r.counts || {}; set('requests', (c.requested || 0) + (c.in_progress || 0) + (c.ordered || 0) + (c.paid || 0)); }
    if (s) set('stock', (s.counts?.low || 0) + (s.counts?.none || 0));
  } catch { /* счётчики не критичны */ }
}

// ---------- Разделы ----------
let ui = null;            // { main, gs }
let mounted = null;       // { key, section, list }
let card = null;          // { key, handle }

function closeCard() { if (card) { card.handle.close(); card = null; } }
/** Экран пересоздаётся только при смене раздела (и поиска по всему — у него свой запрос); остальное — update(). */
const screenKey = (section, params) => (section === 'passports' ? 'docs' : section) + (section === 'search' ? '?' + (params.q || '') : '');

function render(c) {
  const { section, params } = c;
  if (!section) { go(DEFAULT, {}, { replace: true }); return; }
  // старый раздел «Позиции и оплаты» (#orders) ушёл из меню: список — «Деньги → Долги», карточка позиции — справа (of=orders)
  if (section === 'orders') { const { open, new: isNew, ...rest } = params; go('money', { ...rest, tab: 'debts', ...(open || isNew ? { of: 'orders', ...(open ? { open } : { new: isNew }) } : {}) }, { replace: true }); return; }
  // разделы грузятся при первом открытии: пока модуль едет — прежний экран на месте, потом тот же render
  const miss = allowed(section) ? needed(section, params) : [];
  if (miss.length) {
    trackLoad(Promise.all(miss.map(loadSec))).then(() => render(current())).catch((e) => {
      reportError(e, { kind: 'unhandled', action: 'загрузить раздел' });
      ui.main.replaceChildren(failBlock(e, () => { mounted = null; render(current()); }, { cls: 'panel state', text: 'Раздел не открылся' }));
      mounted = null;
    });
    return;
  }
  // старый раздел «Операции» (SK-4b): адреса #ops?mode=… открывают «Склад» с нужной панелью справа
  // SK-8b: раздел снят с роли — прямой адрес ведёт на «Сегодня» с подсказкой, без ошибки
  if (!allowed(section)) {
    toast(`Раздел «${titleOf(OWNER[section] || section) || 'этот'}» для вашей роли закрыт — открыто «Сегодня».`);
    go(DEFAULT, {}, { replace: true }); return;
  }
  // старый адрес #passports (ссылки из изделия, заказа, истории): «Архив паспортов» в «Документации», карточка — только просмотр и печать
  if (section === 'passports') { go('docs', { tab: 'archive', ...(params.open ? { of: 'passarchive', open: params.open } : {}) }, { replace: true }); return; }
  if (section === 'ops') { go('stock', { of: 'stockop', new: '1', op: { in: 'in', reserve: 'reserve', count: 'count' }[params.mode] || 'out' }, { replace: true }); return; }
  for (const [id, a] of Object.entries(navLinks)) a.classList.toggle('active', id === (section === 'movements' ? 'stock' : section));
  if (SEC_OF[OWNER[section] || section]) document.body.dataset.sec = SEC_OF[OWNER[section] || section]; else delete document.body.dataset.sec;
  ui.gsb.set(section === 'search' ? params.q || '' : '', section !== 'search');

  const key = screenKey(section, params);
  if (!mounted || mounted.key !== key) { const own = OWNER[section] || section; setCrumbs({ group: GROUP_OF[own] || '', title: titleOf(own) || '', href: '#' + own }); }
  const sec = SECTIONS[section];
  if (!mounted || mounted.key !== key) {
    mounted?.list?.destroy?.();
    let list = null;
    // ОШ2: раздел упал при отрисовке — в сборщик и «Не открылось · Повторить» на его месте, а не пустой экран
    try {
    if (section === 'docs') list = FN.mountDocs(params, { onChanged: () => refreshCounts() });
    else if (section === 'requests') list = FN.mountRequests(params, (p) => mountList(sec, p, {
      onOpen: (row) => openRecord(section, row.id),
      onCreate: () => go(section, { ...current().params, new: '1', open: undefined }, { replace: true }),
      quick: sec.quick ? sec.quick(() => { mounted?.list?.reload?.(); refreshCounts(); }) : null,
      onChanged: () => { /* счётчики и список обновит dc:changed после записи */ },
    }));
    else if (sec?.mount) {
      const el = h('div', { class: 'panel' });
      const handle = sec.mount(el, { params, setTitle: (t) => { if (ui.heading) ui.heading.textContent = t; } });
      list = { ...(handle || {}), el }; // mount может вернуть { update(params), destroy() }
    } else if (sec?.list) { // «Сопоставление»: sec — только правая панель, экран — mountMatchingQueue ниже
      list = mountList(sec, params, {
        onOpen: (row) => openRecord(section, row.id),
        onCreate: () => go(section, { ...current().params, new: '1', open: undefined }, { replace: true }),
        quick: sec.quick ? sec.quick(() => { mounted?.list?.reload?.(); refreshCounts(); }) : null,
        onChanged: () => { /* счётчики и список обновит dc:changed после записи */ },
      });
    } else if (section === 'home') list = mountHome({ open: (of, id) => go('home', { ...current().params, of, open: id }, { replace: true }), refreshCounts });
    else if (section === 'money') list = FN.mountMoney(params);
    else if (section === 'payroll' && FEATURES.payroll && session.canPayroll) list = FN.mountPayroll();
    else if (section === 'staff') list = FN.mountStaff(params);
    else if (section === 'trash') list = FN.mountTrash();
    else if (section === 'dicts') list = FN.mountDicts(params);
    else if (section === 'fill') list = FN.mountFill(params);
    else if (section === 'search') list = FN.mountSearch(params);
    else if (section === 'matching') list = FN.mountMatchingQueue(params);
    else { go(DEFAULT, {}, { replace: true }); return; }
    } catch (e) {
      reportError(e, { kind: 'unhandled', action: 'открыть раздел' });
      ui.main.replaceChildren(failBlock(e, () => { mounted = null; render(current()); }, { cls: 'panel state', text: 'Раздел не открылся' }));
      mounted = null;
      return;
    }
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
const titleOf = (n) => SECTIONS[n]?.title || NAMES[n] || NAV.find(([id]) => id === n)?.[1];
const NAMES = { chat: 'Чат', home: 'Сегодня', docs: 'Документация', payroll: 'ФОТ', dicts: 'Справочники', staff: 'Сотрудники', fill: 'Требуют заполнения', money: 'Деньги', trash: 'Корзина', search: 'Поиск' };
function screenTitle(url) {
  const [sec, qs = ''] = String(url || '').replace(/^#\/?/, '').split('?');
  const name = titleOf(sec) || 'Сегодня';
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
  const invTab = section === 'requests' && params.tab === 'invoices' && !params.of; // open= там — id счёта, не карточка заявки
  const want = sec && !invTab && (params.new ? 'new' : params.open ? 'open:' + params.open : null);
  if (!want) { closeCard(); return; }
  const key = ofName + want + (params.fill ? '~' + params.fill : '') + (['stockop', 'resedit', 'specimport', 'compsug'].includes(ofName) ? '@' + (params.op || '') + (params.materialId || '') + (params.rid || '') + (params.orderId || '') + (params.lid || '') : '');
  if (card?.key === key) return;
  // Та же панель, другая запись (стрелки, клик по соседней строке) — меняем содержимое, без закрытия
  if (card && card.of === ofName && !params.fill && want.startsWith('open:') && card.key.includes('open:') && !card.key.includes('~') && !card.handle.editing) {
    card.key = key;
    card.handle.load(params.open);
    return;
  }
  closeCard();
  const clear = { open: undefined, new: undefined, of: undefined, fill: undefined, title: undefined, unit: undefined, categoryName: undefined, op: undefined, materialId: undefined, rid: undefined, orderId: undefined, productionNo: undefined, lid: undefined, dstatus: undefined, lineId: undefined, article: undefined, supplierName: undefined, supplierId: undefined, priceHint: undefined, productUrl: undefined };
  const ctx = {
    close: () => { card = null; closeStep(clear); }, // открыта шагом — «назад», иначе убрать open= без нового шага (НВ.2)
    changed: () => onDataChanged(), // тот же debounce, что у dc:changed: запись + это событие = одно обновление
    opened: (id) => { card.key = ofName + 'open:' + id; patch({ ...clear, of: ofName !== section ? ofName : undefined, open: id }); },
  };
  if (params.new) {
    if (!canEditSection(sec) || !sec.form) { patch({ new: undefined }); return; }
    // initial() может быть async (паспорта: поставщик по умолчанию с сервера) — карточка дождётся
    const initial = Promise.resolve(sec.form.initial ? sec.form.initial() : {}).then((b) => {
      const x = { ...b };
      for (const k of ['title', 'unit', 'categoryName', 'orderNo', 'productionNo', 'customer', 'companyName', 'orderId', 'article', 'supplierName', 'priceHint', 'productUrl', 'salesOrderRef', 'qty', 'supplierId']) if (params[k]) x[k] = params[k];
      return x;
    });
    card = { key, of: ofName, handle: openCard(sec, { mode: 'create', initial }, ctx) };
  } else {
    card = { key, of: ofName, handle: openCard(sec, { id: params.open, fill: params.fill }, ctx) };
  }
}

async function showApp() {
  startPrefs(session.user); // ШП: ширины панелей этого пользователя из браузера — до первой отрисовки
  ui = shell();
  mounted = null; card = null;
  render(current());
  warmUp();
  // Свежие данные о пользователе (роль могла измениться)
  // SK-8b: изменились разделы роли — перестроить меню и проверить текущий экран
  api('/auth/me').then((me) => {
    if (!(me?.id || me?.username)) return;
    const was = JSON.stringify(session.user?.sections ?? null);
    session.user = { ...session.user, ...me };
    serverPrefs(me.uiPrefs); // ШП: с сервера перекрывают локальные (с другого ПК)
    if (JSON.stringify(session.user?.sections ?? null) !== was) { closeCard(); ui = shell(); mounted = null; render(current()); }
  }).catch(() => {});
}
onChange((c) => { if (ui && session.refresh) render(c); });
// «Отменить» во всплывающем сообщении и другие изменения вне списка — обновить текущий экран и счётчики меню
// Единый механизм «данные изменились»: core/api.js шлёт dc:changed после каждой успешной записи (POST/PATCH/PUT/DELETE),
// старое data-changed — то же самое вручную. Debounce 300 мс склеивает пачку записей в одно обновление:
// список, плитки/«Уточнить» слева (list.reload), счётчики меню, «Сегодня» и кэш справочников.
let changedTimer = 0;
let countsTimer = 0;
let lastRow = null;       // запись из ответа последней одиночной записи (PATCH) — для точечного обновления доски
let rowsMixed = false;    // за окно склейки было больше одной записи — обновляем всё
const countsOf = new Set();
const LOOKUP_PATH = /^\/(partners|dicts|materials|supply\/catalog|supply\/lookups)(\/|$|\?)/;
const COUNT_SECTION = [[/^\/supply\/(requests|invoices)/, 'requests'], [/^\/stock/, 'stock'], [/^\/incomes/, 'money'], [/^\/(salesorders|production-orders)/, 'salesorders'], [/^\/design-tasks/, 'design'], [/^\/work-tasks/, 'work']];
function onDataChanged(e) {
  const d = e?.detail;
  const path = d?.path || '';
  if (!path || LOOKUP_PATH.test(path)) lookups.reset(); // справочники сбрасываем только при записи в них
  // счётчики меню — только затронутых разделов и не чаще раза в 2 с
  const hit = path ? COUNT_SECTION.filter(([re]) => re.test(path)).map(([, id]) => id) : [];
  if (!path) ['requests', 'stock', 'money', 'salesorders', 'design', 'work'].forEach((id) => countsOf.add(id)); else hit.forEach((id) => countsOf.add(id));
  if (countsOf.size && !countsTimer) countsTimer = setTimeout(() => { countsTimer = 0; const ids = new Set(countsOf); countsOf.clear(); refreshCounts(ids); }, 2000);
  const one = d?.method === 'PATCH' && d.result && d.result.id && !d.result.items ? d.result : null;
  if (changedTimer) rowsMixed = true;
  lastRow = one;
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => {
    changedTimer = 0;
    const row = !rowsMixed ? lastRow : null;
    rowsMixed = false; lastRow = null;
    mounted?.list?.reload?.(row);
  }, 300);
}
window.addEventListener('data-changed', onDataChanged);
document.addEventListener('dc:changed', onDataChanged);
window.addEventListener('online', () => events.onNet(true));
window.addEventListener('offline', () => events.onNet(false));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* без офлайн-оболочки */ });
watchUpdates(); // новая выкладка — уведомление «Вышла новая версия · Обновить»
if (session.refresh) showApp(); else showLogin();
