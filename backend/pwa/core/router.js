import { createNav } from './nav-stack.js';

/** Адрес = состояние экрана (CANON §2): #раздел?page=2&status=…&open=<id>.
 *  «Назад», обновление страницы и ссылка коллеге открывают то же самое.
 *  Правила истории (TASKS НВ.2): новый шаг — смена раздела, открытие карточки, переход по ссылке;
 *  без шага (replace) — фильтры, страницы, сортировка, вкладки, смена записи в открытой карточке.
 *  Шаги считаются в history.state ({ dcIdx, kind }) — кнопки ‹ › знают, есть ли куда (core/nav-stack.js). */
const listeners = new Set();
const navListeners = new Set();
const KEY = 'dc-nav';
const nav = createNav((() => { try { return JSON.parse(sessionStorage.getItem(KEY) || 'null'); } catch { return null; } })());
const persist = () => { try { sessionStorage.setItem(KEY, JSON.stringify(nav.save())); } catch { /* приватный режим */ } };
window.history.replaceState(nav.init(location.hash || '#', window.history.state), '', location.hash || '#');
persist();

export function current() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [section, qs = ''] = raw.split('?');
  return { section: section || '', params: Object.fromEntries(new URLSearchParams(qs)) };
}

function build(section, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return '#' + section + (qs ? '?' + qs : '');
}

/**
 * Защита ввода (НВ.4): guard(next) → true / false (или Promise) перед сменой экрана по «Назад»/«Вперёд»/ссылке.
 * false — остаёмся: адрес возвращается обратно, данные формы не теряются.
 */
let guard = null;
export function setGuard(fn) { guard = fn; }

/** Перейти: replace=true — без новой записи в истории (фильтры, страницы); kind 'card' — шаг «открыта карточка». */
export function go(section, params = {}, { replace = false, kind } = {}) {
  const url = build(section, params);
  if (url === location.hash) return;
  if (replace) window.history.replaceState(nav.replace(url, kind ?? window.history.state?.kind), '', url);
  else window.history.pushState(nav.push(url, kind), '', url);
  persist(); emit();
}

/** Поменять часть параметров текущего экрана. */
export function patch(changes, opts = { replace: true }) {
  const { section, params } = current();
  go(section, { ...params, ...changes }, opts);
}

/** Закрыть то, что открыли шагом (карточку): «назад», если этот шаг наш; иначе — убрать параметры без нового шага. */
export function closeStep(clearParams) {
  if (window.history.state?.kind === 'card' && nav.info().canBack) { window.history.back(); return; }
  patch(clearParams);
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function onNav(fn) { navListeners.add(fn); fn(nav.info()); return () => navListeners.delete(fn); }
export const navInfo = () => nav.info();
function emit() { const c = current(); listeners.forEach((fn) => fn(c)); const i = nav.info(); navListeners.forEach((fn) => fn(i)); }

// «Назад» / «Вперёд» браузера и ссылки-якоря: hashchange (popstate без смены адреса не бывает — go() не пишет одинаковые)
let restoring = false;
window.addEventListener('hashchange', async () => {
  if (restoring) { restoring = false; return; }
  const before = nav.info().idx;
  const r = nav.pop(window.history.state, location.hash);
  if (r.adopt) window.history.replaceState(r.adopt, '', location.hash);
  persist();
  if (guard && !(await guard(current()))) {
    // остаёмся: вернуть адрес туда, откуда ушли (тем же числом шагов)
    restoring = true;
    if (r.adopt) { window.history.back(); } else window.history.go(-r.delta);
    nav.pop({ dcIdx: before }, nav.save().stack[before]); persist();
    return;
  }
  emit();
});
