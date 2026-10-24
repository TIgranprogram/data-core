/** ШП: ширины боковых панелей пользователя (меню, правая панель, фильтры) — docs/roles/tz/SHP.md.
 *  Хранятся в двух местах: этот браузер (localStorage 'dc-ui-<userId>' — сразу и без сети) и сервер
 *  (users.uiPrefs — переходит между ПК). После /auth/me серверные значения перекрывают локальные.
 *  Сохранённое не затирается, когда окно сузили: на экран идёт значение, ограниченное по окну. */
import { api } from './api.js';

/** На экране от 1400 px правая панель пристыкована справа (ui/card.js), уже — поверх списка. */
export const DOCK_MIN = 1400;
const NARROW = 720; // ≤ — телефон: панели во весь экран, ширины пользователя не применяются
const ICONS = 1100; // ≤ — меню иконками (ширина --sidebar-icons-w), ручки у меню нет
const ICONS_W = 72;
const MAIN_MIN = 480; // основной области всегда остаётся не меньше

/** Ключ uiPrefs → CSS-переменная, пределы и стандарт (null — стандарт задаёт CSS). */
const PREFS = {
  sidebarW: { css: '--sidebar-w', min: 200, max: 360, std: 248 },
  detailW: { css: '--detail-w', min: 420, max: 1400, std: null },
  filterW: { css: '--filter-w', min: 280, max: 520, std: 340 },
};
const OVER = '--detail-over'; // ширина правой панели в режиме «поверх» (< DOCK_MIN)

let uid = '';
let saved = {}; // сохранённые значения пользователя
let shown = {}; // то, что на экране (во время перетаскивания — живое значение)
const dirty = new Set(); // изменены здесь, на сервер ещё не ушли: ответ /auth/me их не перекрывает
let timer = null;

const storeKey = () => 'dc-ui-' + uid;
const clean = (o) => {
  const out = {};
  for (const k of Object.keys(PREFS)) if (Number.isFinite(o?.[k])) out[k] = Math.round(o[k]);
  return out;
};
/** { ...ширины, _p: [ключи, ещё не ушедшие на сервер] } — чтобы перезагрузка сразу после перетаскивания не потеряла запись. */
function readLocal() {
  try {
    const o = JSON.parse(localStorage.getItem(storeKey()) || '{}');
    return { vals: clean(o), pend: Array.isArray(o?._p) ? o._p.filter((k) => k in PREFS) : [] };
  } catch { return { vals: {}, pend: [] }; }
}
function writeLocal() {
  try { localStorage.setItem(storeKey(), JSON.stringify(dirty.size ? { ...saved, _p: [...dirty] } : saved)); } catch { /* приватный режим — только до перезагрузки */ }
}

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/** Ширина меню на экране сейчас (для пределов соседних панелей). */
function sideNow(src) {
  const W = window.innerWidth;
  if (W <= NARROW) return 0;
  if (W <= ICONS) return ICONS_W;
  const v = src.sidebarW ?? PREFS.sidebarW.std;
  return clamp(v, PREFS.sidebarW.min, Math.min(PREFS.sidebarW.max, W - MAIN_MIN));
}

/** Пределы ширины панели при текущем окне: { min, max }. */
export function limits(key, src = shown) {
  const p = PREFS[key];
  const W = window.innerWidth;
  let max = p.max;
  if (key === 'sidebarW') max = Math.min(max, W - MAIN_MIN);
  else if (key === 'detailW') max = W >= DOCK_MIN ? Math.min(max, Math.floor(W * 0.6), W - sideNow(src) - MAIN_MIN) : Math.min(max, W - 24);
  else if (key === 'filterW') max = Math.min(max, W - sideNow(src) - MAIN_MIN);
  max = Math.max(p.min, max); // нижний предел важнее: панель уже него не бывает
  return { min: p.min, max };
}

/** Применить значения к странице (CSS-переменные на <html>), ограничив их по окну. */
function paint(src) {
  const st = document.documentElement.style;
  const off = window.innerWidth <= NARROW;
  for (const [key, p] of Object.entries(PREFS)) {
    const v = src[key];
    const vars = key === 'detailW' ? [p.css, OVER] : [p.css];
    if (off || v == null) { vars.forEach((n) => st.removeProperty(n)); continue; }
    const { min, max } = limits(key, src);
    const px = clamp(v, min, max) + 'px';
    if (key !== 'detailW') st.setProperty(p.css, px);
    else if (window.innerWidth >= DOCK_MIN) { st.setProperty(p.css, px); st.removeProperty(OVER); }
    else { st.setProperty(OVER, px); st.removeProperty(p.css); }
  }
}

let listening = false;
let rq = 0;
/** Вход пользователя: его локальные ширины — сразу, до первой отрисовки. */
export function startPrefs(user) {
  uid = String(user?.id || user?._id || user?.username || '');
  const loc = uid ? readLocal() : { vals: {}, pend: [] };
  saved = loc.vals;
  shown = { ...saved };
  dirty.clear(); clearTimeout(timer); timer = null;
  for (const k of loc.pend) dirty.add(k);
  if (dirty.size) timer = setTimeout(sendPrefs, 1000); // не ушло в прошлый раз — отправить
  paint(shown);
  if (!listening) {
    listening = true;
    window.addEventListener('resize', () => { if (!rq) rq = requestAnimationFrame(() => { rq = 0; paint(shown); }); });
  }
}

/** Ответ сервера (/auth/me, вход): его значения перекрывают локальные. Старый сервер без uiPrefs — ничего. */
export function serverPrefs(uiPrefs) {
  if (!uiPrefs || typeof uiPrefs !== 'object') return;
  const s = clean(uiPrefs);
  let changed = false;
  for (const k of Object.keys(PREFS)) {
    if (dirty.has(k) || s[k] === saved[k]) continue;
    // ключа нет на сервере — ширину сбросили «по умолчанию» на другом ПК: сбрасываем и здесь
    if (s[k] === undefined) delete saved[k]; else saved[k] = s[k];
    changed = true;
  }
  if (!changed) return;
  writeLocal();
  shown = { ...saved };
  paint(shown);
}

/** Во время перетаскивания: только CSS-переменная, без записи. */
export function livePref(key, px) {
  shown = { ...shown, [key]: px };
  paint(shown);
}

/** Отпустили мышь / клавиша: сохранить (null — стандарт). На сервер — один PATCH через 1 с. */
export function commitPref(key, px) {
  const v = px == null ? undefined : Math.round(px);
  shown = { ...saved };
  if (v === saved[key]) { paint(shown); return; }
  if (v === undefined) delete saved[key]; else saved[key] = v;
  shown = { ...saved };
  paint(shown);
  if (!uid) return;
  dirty.add(key);
  writeLocal();
  clearTimeout(timer);
  timer = setTimeout(sendPrefs, 1000);
}

function sendPrefs() {
  timer = null;
  if (!dirty.size) return;
  const body = {};
  for (const k of dirty) body[k] = saved[k] ?? null; // null — вернуть стандарт
  dirty.clear();
  writeLocal();
  // ошибки — молча: ширина уже сохранена в этом браузере. Нет сети, 429, сбой сервера — ключи остаются «не отправлены»
  // (уйдут со следующим изменением или при следующем открытии, а /auth/me их пока не перекроет); 404 старого сервера, 400, 403 — не повторяем
  const keys = Object.keys(body);
  api('/auth/me/prefs', { method: 'PATCH', body }).catch((e) => {
    if (!(e?.status === 0 || e?.status >= 429)) return;
    for (const k of keys) dirty.add(k);
    writeLocal();
  });
}
