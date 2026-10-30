import { api } from './api.js';

/**
 * Обновление без F5 (СМ.9): раз в 20 с лёгкий запрос версий данных, только в открытой вкладке, и сразу при возврате в окно.
 * Изменился раздел — `onChange(ключи)`. Если человек сейчас вводит данные (`busy`), обновление ждёт следующей проверки и не теряется.
 * Своя запись не считается чужой: экран уже обновился, новые версии просто запоминаются.
 */
const EVERY = 20000, AFTER_OWN_WRITE = 1500;
let timer = 0, last = null, waiting = new Set(), hooks = null;

async function tick({ quiet = false } = {}) {
  if (!hooks || document.hidden) return;
  let now;
  try { now = await api('/me/versions'); } catch { return; } // старый сервер или нет связи — как раньше, без обновления
  if (!now?.live) return;
  if (last && last.epoch === now.epoch && !quiet) for (const k of Object.keys(now.v)) if (now.v[k] !== last.v[k]) waiting.add(k);
  last = now;
  if (waiting.size && !hooks.busy()) { const keys = waiting; waiting = new Set(); hooks.onChange(keys); }
}

const onVisible = () => { if (!document.hidden) tick(); };
let ownTimer = 0;
const onOwnWrite = () => { clearTimeout(ownTimer); ownTimer = setTimeout(() => tick({ quiet: true }), AFTER_OWN_WRITE); };

export function startLiveSync(h) {
  if (hooks) return;
  hooks = h;
  timer = setInterval(tick, EVERY);
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('focus', onVisible);
  document.addEventListener('dc:changed', onOwnWrite);
  tick();
}

export function stopLiveSync() {
  clearInterval(timer); clearTimeout(ownTimer);
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('focus', onVisible);
  document.removeEventListener('dc:changed', onOwnWrite);
  hooks = null; last = null; waiting = new Set();
}
