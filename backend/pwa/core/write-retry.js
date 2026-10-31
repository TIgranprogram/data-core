/** SW-6: запись (не GET) переживает короткое переключение сервера. Ключ Idempotency-Key один на все повторы — сервер не выполнит запись дважды.
 *  Чистая логика (без DOM и fetch) — проверяется node:test; подключается в core/api.js. */

/** Паузы между попытками, мс; после последней повторяем каждые 30 с. Общий срок ожидания — 3 минуты. */
export const WRITE_WAIT = [3000, 5000, 10000, 15000, 30000];
export const WRITE_LIMIT = 180000;
export const writeDelay = (i) => WRITE_WAIT[Math.min(i, WRITE_WAIT.length - 1)];

/** Фоновые записи (вход, служебные, сборщик ошибок, настройки вида) в ожидание не ставим — только действия пользователя. */
export const isBackgroundPath = (path) => /^\/(auth|meta|client|prefs)(\/|$|\?)|\/me(\/|$|\?)|ui-?prefs/i.test(path);

/** Случайный ключ запроса. */
export function newKey() {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b); else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Ждать ли: сервер на паузе записи (503 READ_ONLY) или нет связи / шлюз моргнул. Долгий ответ (timeout, 504) — не ждём: запрос мог дойти и выполняться. */
export const waitable = (e) => !!e && (e.readOnly === true || (e.status === 0 && !e.timeout) || e.status === 502 || e.status === 503);

/**
 * Выполнить attempt() с повторами. Ошибка не из «ждём» или срок вышел — бросаем её как есть (форма не теряет данные).
 * hooks: sleep(ms), now(), onStart(), onEnd(ok) — для теста и для полосы «Нет соединения».
 */
export async function withWriteRetry(attempt, { sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now, limit = WRITE_LIMIT, onStart = () => {}, onEnd = () => {} } = {}) {
  const t0 = now();
  let waited = false;
  for (let i = 0; ; i++) {
    try {
      const out = await attempt(i);
      if (waited) onEnd(true);
      return out;
    } catch (e) {
      const left = limit - (now() - t0);
      if (!waitable(e) || left <= 0) { if (waited) onEnd(false); throw e; }
      if (!waited) { waited = true; onStart(); }
      await sleep(Math.min(writeDelay(i), left));
    }
  }
}
