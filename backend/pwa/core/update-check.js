import { h } from './dom.js';

/**
 * Новая версия приложения (замечание 2026-10-22: установленное на Windows приложение «не обновилось»).
 * Открытое окно держит загруженный код, пока его не перезагрузить; у установленного приложения нет адресной строки,
 * поэтому сами проверяем выкладку: HEAD main.js (ETag меняется при каждой выкладке) — при возврате в окно и раз в 10 минут.
 * Новая — полоса «Вышла новая версия · Обновить» (перезагрузка). Версия (дата выкладки) — в меню.
 */
const probe = () => fetch('main.js', { method: 'HEAD', cache: 'no-store' }).then((r) => (r.ok ? r : null)).catch(() => null);

export function watchUpdates() {
  let base = null; let shown = false;
  probe().then((r) => { base = r?.headers.get('etag') || r?.headers.get('last-modified') || null; });
  const check = async () => {
    if (shown) return;
    navigator.serviceWorker?.getRegistration?.().then((reg) => reg?.update()).catch(() => {});
    const r = await probe();
    const v = r?.headers.get('etag') || r?.headers.get('last-modified');
    if (base && v && v !== base) { shown = true; showBar(); }
  };
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
  window.addEventListener('focus', check);
  setInterval(check, 10 * 60 * 1000);
}

function showBar() {
  const bar = h('div', { class: 'update-bar', role: 'status' },
    h('span', null, 'Вышла новая версия приложения'),
    h('button', { type: 'button', class: 'btn btn-primary btn-sm', onclick: () => location.reload() }, 'Обновить'),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Позже', 'aria-label': 'Закрыть', onclick: () => bar.remove() }, '×'));
  document.body.append(bar);
}

/** «Версия от 22.10.2026 04:46» — дата выкладки (Last-Modified оболочки). */
export async function versionLabel() {
  const r = await probe();
  const lm = r?.headers.get('last-modified');
  if (!lm) return '';
  const d = new Date(lm);
  return Number.isNaN(d.getTime()) ? '' : `Версия от ${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
}
