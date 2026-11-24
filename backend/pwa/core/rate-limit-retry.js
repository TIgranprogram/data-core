/** Срок HTTP 429: обычный Retry-After и именованные окна NestJS; выбираем самый поздний. */
export function rateLimitDeadline(headers, now = Date.now()) {
  let deadline;
  headers?.forEach((value, name) => {
    if (!/^retry-after(?:-.+)?$/i.test(name)) return;
    const raw = String(value).trim();
    const at = /^\d+(?:\.\d+)?$/.test(raw) ? now + Number(raw) * 1000 : /[a-z]/i.test(raw) ? Date.parse(raw) : NaN;
    if (Number.isFinite(at)) deadline = Math.max(deadline ?? now, at, now);
  });
  return deadline;
}

const cancelled = () => Object.assign(new Error('Запрос отменён'), { name: 'AbortError' });
const check = (signal, current) => { if (signal?.aborted || !current()) throw cancelled(); };
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(cancelled()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}

/** Только чтение доски: один повтор по сроку сервера, ожидание отменяется при смене контекста. */
export async function retryRateLimitedRead(send, { signal, current = () => true, onWait } = {}) {
  check(signal, current);
  try { const result = await send(); check(signal, current); return result; }
  catch (error) {
    check(signal, current);
    const wait = Number.isFinite(error?.retryAt) ? Math.max(0, error.retryAt - Date.now()) : NaN;
    // Нет срока или он слишком далёк — оставляем явную кнопку, а не быстрый/бесконечный повтор.
    if (error?.status !== 429 || !Number.isFinite(wait) || wait > 120000) throw error;
    onWait?.(error, wait);
    await pause(wait, signal);
    check(signal, current);
    const result = await send(); check(signal, current); return result;
  }
}
