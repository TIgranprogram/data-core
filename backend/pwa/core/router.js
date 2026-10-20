/** Адрес = состояние экрана (CANON §2): #раздел?page=2&status=…&open=<id>.
 *  «Назад», обновление страницы и ссылка коллеге открывают то же самое. */
const listeners = new Set();

export function current() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [section, qs = ''] = raw.split('?');
  return { section: section || '', params: Object.fromEntries(new URLSearchParams(qs)) };
}

function build(section, params) {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
  return '#' + section + (qs ? '?' + qs : '');
}

/** Перейти: replace=true — без новой записи в истории (фильтры, страницы). */
export function go(section, params = {}, { replace = false } = {}) {
  const url = build(section, params);
  if (url === location.hash) return;
  if (replace) { history.replaceState(null, '', url); emit(); } else location.hash = url;
}

/** Поменять часть параметров текущего экрана. */
export function patch(changes, opts = { replace: true }) {
  const { section, params } = current();
  go(section, { ...params, ...changes }, opts);
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit() { const c = current(); listeners.forEach((fn) => fn(c)); }
window.addEventListener('hashchange', emit);
