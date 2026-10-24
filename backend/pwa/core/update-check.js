import { h } from './dom.js';
import { toast } from '../ui/toast.js';
import { addNotice } from '../ui/notices.js';

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

let loaded = null; let latest = null; let shown = false;
const subs = new Set();
const notify = () => subs.forEach((fn) => fn());
/** Есть ли версия новее открытой (меню показывает «Обновить приложение» только тогда). */
export const hasNewer = () => !!(latest?.v && loaded?.v && latest.v !== loaded.v);
export const onVersion = (fn) => { subs.add(fn); fn(); };
/** Открытая версия (для сборщика ошибок, ОШ2): коммит выкладки или ETag main.js; не узнали — ''. */
export const currentVersion = () => String(loaded?.v || '');

export function watchUpdates() {
  probe().then((r) => {
    loaded = latest = r; notify();
    if (!r?.v) return;
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
    if (r.v !== loaded.v && !shown) { shown = true; showBar(r); }
  };
  // ОШ2.4: service worker нашёл новую оболочку (уже работал до этого — не первая установка) — та же полоса, без перезагрузки
  navigator.serviceWorker?.getRegistration?.().then((reg) => reg?.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'activated' && navigator.serviceWorker.controller && !shown) { shown = true; showBar(latest || {}); }
    });
  })).catch(() => {});
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  setInterval(check, 10 * 60 * 1000);
}

/** Новая версия — сообщение в колокольчике (не полоса поверх экрана). */
export async function reloadApp() {
  try { const reg = await navigator.serviceWorker?.getRegistration?.(); await reg?.update(); } catch { /* без service worker */ }
  location.reload();
}
function showBar(r) {
  addNotice({ id: 'app-update', text: 'Вышла новая версия приложения', sub: fmt(r.date) ? 'от ' + fmt(r.date) + ' · данные не теряются' : 'данные не теряются', action: { label: 'Обновить', run: reloadApp } });
}

/** Подпись в меню: «Версия от 22.10.2026 09:01 · последняя» (открытая версия) или «· есть новее». */
export function versionLabel(el) {
  const render = () => {
    if (!loaded) { el.textContent = ''; return; }
    const newer = latest?.v && loaded.v && latest.v !== loaded.v;
    el.textContent = `Версия${fmt(loaded.date) ? ' от ' + fmt(loaded.date) : ''} · ${newer ? 'есть новее' : 'последняя'}`;
  };
  subs.add(render); render();
}
