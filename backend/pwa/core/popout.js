/**
 * Правая панель в отдельном окне браузера (пользователь 2026-11-10: «окно продукции как окно Windows — перемещать по мониторам,
 * закрывать только крестиком, не перекрывать основное меню»).
 *   isSolo() — эта вкладка и есть отдельное окно (имя окна `dc-solo-<раздел>`): панель на всё окно, ✕ закрывает окно.
 *   popoutWanted(id) — пользователь выбрал «в отдельном окне» для раздела (запоминается в браузере).
 *   popout(id, { remember }) — открыть текущий адрес в отдельном окне раздела (одно окно на раздел, переиспользуется);
 *     место и размер окна запоминаются (soloGeometry). Окно заблокировано браузером → false (панель остаётся как была).
 *   setPopout(id, on) — включить/выключить «открывать в отдельном окне».
 */
const KEY = (id) => `dc-popout-${id}`;
// место и размер — свои у каждого раздела (14.11: справочник открывался во весь экран — размер был общий с большим окном «Продукции»)
const GEO = (id) => `dc-popout-geo-${id}`;
const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* хранилище недоступно — без памяти */ } };

export const isSolo = () => String(window.name || '').startsWith('dc-solo-');
export const popoutWanted = (id) => !isSolo() && get(KEY(id)) === '1';
export const setPopout = (id, on) => set(KEY(id), on ? '1' : null);

function features(id) {
  let g = null; try { g = JSON.parse(get(GEO(id)) || 'null'); } catch { g = null; }
  const w = g?.w || Math.min(1100, screen.availWidth - 40), hgt = g?.h || Math.min(950, screen.availHeight - 40);
  const pos = g ? `,left=${g.x},top=${g.y}` : '';
  return `popup,width=${w},height=${hgt}${pos}`;
}

/** Открыть текущий адрес (панель уже в адресе: ?of=…&open=…) в отдельном окне раздела. */
export function popout(id, { remember = true } = {}) {
  const win = window.open(location.href, `dc-solo-${id}`, features(id));
  if (!win) return false;
  try { win.focus(); } catch { /* другое окно — фокус может не дать */ }
  if (remember) setPopout(id, true);
  return true;
}

/** Вернуть открытую запись в панель приложения из прежнего отдельного окна. */
export function returnToPanel(id) {
  setPopout(id, false);
  const opener = window.opener;
  let reopened = false;
  try {
    if (opener && !opener.closed && opener.location.origin === location.origin
      && opener.location.pathname === location.pathname && !String(opener.name).startsWith('dc-solo-')) {
      opener.location.hash = location.hash;
      reopened = true;
    }
  } catch { /* Главное окно недоступно — открываем оболочку приложения в текущем. */ }
  if (reopened) {
    try { opener.focus(); } catch { /* Браузер может запретить фокус. */ }
    window.close();
    return;
  }
  window.name = '';
  location.reload();
}

/** В отдельном окне: запоминать место и размер (на следующие открытия). */
export function soloGeometry() {
  if (!isSolo()) return;
  const id = String(window.name).slice('dc-solo-'.length);
  const save = () => set(GEO(id), JSON.stringify({ x: window.screenX, y: window.screenY, w: window.outerWidth, h: window.outerHeight }));
  let t = null;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(save, 400); });
  window.addEventListener('beforeunload', save);
  setInterval(save, 5000); // перетаскивание окна не даёт событий — сохраняем раз в 5 с
}
