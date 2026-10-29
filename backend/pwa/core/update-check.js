import { h } from './dom.js';
import { toast } from '../ui/toast.js';

/**
 * Новая версия приложения (замечание 2026-10-22: установленное на Windows приложение «не обновилось»; затем —
 * «непонятно, какая версия и обновилось ли», «постоянно пишет обновить»).
 * Версия — `version.json` ({ v: коммит, date }), его кладёт выкладка (`release.sh`) по последнему коммиту, менявшему
 * само приложение: выкладка без правок приложения версию не меняет. Без файла (локально, стенд) — ETag main.js.
 * Проверка — при возврате в окно и раз в 10 минут; новая — сообщение в колокольчике «Вышла новая версия · Обновить»
 * (2026-10-24: вместо полосы; без новой версии колокольчик пуст, в меню — просто подпись версии).
 * В меню — «Версия от … · последняя / есть новее»; после обновления — всплывашка «Приложение обновлено».
 */
const KEY = 'dc-app-ver';
const head = () => fetch('main.js', { method: 'HEAD', cache: 'no-store' }).then((r) => (r.ok ? { v: r.headers.get('etag') || r.headers.get('last-modified'), date: r.headers.get('last-modified') } : null));
const probe = () => fetch('version.json', { cache: 'no-store' })
  .then((r) => (r.ok ? r.json() : null)).then((j) => (j?.v ? j : head())).catch(() => head().catch(() => null));

const fmt = (date) => {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
};

let loaded = null; let latest = null; let shown = false; let swNew = false;
const subs = new Set();
const notify = () => subs.forEach((fn) => fn());
/** Есть ли версия новее открытой (меню показывает «Обновить приложение» только тогда). */
export const hasNewer = () => swNew || !!(latest?.v && loaded?.v && latest.v !== loaded.v);
export const onVersion = (fn) => { subs.add(fn); fn(); };
/** Открытая версия (для сборщика ошибок, ОШ2): коммит выкладки или ETag main.js; не узнали — ''. */
export const currentVersion = () => String(loaded?.v || '');

/** Сообщение service worker'у (свой канал ответа; нет SW / нет ответа за 4 с — null). */
const askSw = (msg) => new Promise((resolve) => {
  const w = navigator.serviceWorker?.controller;
  if (!w) { resolve(null); return; }
  const ch = new MessageChannel(); const t = setTimeout(() => resolve(null), 4000);
  ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data ?? null); };
  w.postMessage(msg, [ch.port2]);
});

export function watchUpdates() {
  // страница открыта из кэша — «открытая версия» это версия кэша (её знает SW), а не то, что сейчас на сервере
  Promise.all([probe(), askSw({ type: 'ver' })]).then(([r, own]) => {
    latest = r; loaded = own?.v ? own : r; notify();
    if (!r?.v) return;
    r = loaded;
    try {
      const prev = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (prev?.v && prev.v !== r.v) toast(`Приложение обновлено${fmt(r.date) ? ' · версия от ' + fmt(r.date) : ''}`);
      localStorage.setItem(KEY, JSON.stringify(r));
    } catch { /* без хранилища — без всплывашки */ }
  });
  const check = async () => {
    navigator.serviceWorker?.getRegistration?.().then((reg) => reg?.update()).catch(() => {});
    const r = await probe();
    if (!r?.v || !loaded?.v) return;
    latest = r; notify();
    if (r.v !== loaded.v && !shown) { shown = true; }
  };
  // ОШ2.4: service worker нашёл новую оболочку (уже работал до этого — не первая установка) — та же полоса, без перезагрузки
  navigator.serviceWorker?.getRegistration?.().then((reg) => reg?.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'activated' && navigator.serviceWorker.controller && !shown) { shown = true; swNew = true; notify(); }
    });
  })).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  setInterval(check, 10 * 60 * 1000);
}

/** Обновить: проверить service worker и перезагрузить. */
export async function reloadApp() {
  try { const reg = await navigator.serviceWorker?.getRegistration?.(); await reg?.update(); } catch { /* без service worker */ }
  await askSw({ type: 'apply' }); // SW собирает и включает новую версию целиком — только потом перезагрузка
  location.reload();
}
/** Номер версии внизу меню (2026-10-24): «v1.245» — тихо, без дат и призывов; при новой версии рядом ссылка «Обновить систему». */
export function versionLabel(el) {
  const render = () => {
    if (!loaded) { el.replaceChildren(); return; }
    const num = loaded.n ? `v1.${loaded.n}` : `v${String(loaded.v).slice(0, 7)}`;
    el.title = fmt(loaded.date) ? 'Версия приложения от ' + fmt(loaded.date) : 'Версия приложения';
    el.replaceChildren(h('span', { class: 'ver-num' }, num), ...(hasNewer() ? [h('a', { href: '#', class: 'ver-update', title: 'Вышла новая версия — данные не теряются', onclick: (e) => { e.preventDefault(); reloadApp(); } }, 'Обновить систему')] : []));
  };
  subs.add(render); render();
}
