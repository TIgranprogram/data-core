/**
 * Ошибки — человеку только по-русски «что случилось + что сделать» (ОШ, CANON §1). Один разборщик для всплывашек,
 * форм и глобальных ошибок. Технические детали (TypeError, стек) — в консоль, не пользователю.
 *   errText(e) → текст для показа;  installGlobalErrors(show) — window error / unhandledrejection → show(e)
 */
const GENERIC = 'Что-то пошло не так в приложении. Обновите страницу; если повторится — сообщите администратору.';
const NET = 'Нет связи с сервером. Проверьте интернет и повторите.';
const SLOW = 'Сервер долго не отвечает. Повторите через минуту.';
const INTERNAL = ['TypeError', 'ReferenceError', 'SyntaxError', 'RangeError', 'URIError', 'EvalError'];
const ru = (s) => /[а-яё]/i.test(s);

export function errText(e) {
  if (e == null) return GENERIC;
  const msg = String(e?.message ?? e).trim();
  const name = e?.name || '';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return NET;
  if (name === 'AbortError' || /aborted|timeout/i.test(msg)) return SLOW;
  if (e?.status === 401) return msg && ru(msg) ? msg : 'Сессия закончилась — войдите снова.';
  if (e?.status === 429) return 'Слишком много запросов — подождите минуту.';
  // ответ сервера (ApiError) и наши проверки (throw new Error('Укажите…')) — уже по-русски
  if (msg && ru(msg) && !INTERNAL.includes(name)) return msg;
  console.error('[приложение] внутренняя ошибка:', e);
  return GENERIC;
}

export function installGlobalErrors(show) {
  window.addEventListener('error', (ev) => {
    const m = String(ev.message || '');
    if (!ev.error && (/^Script error\.?$/i.test(m) || /ResizeObserver loop/i.test(m))) return; // чужие скрипты / безвредное предупреждение браузера
    show(ev.error || new Error(m));
  });
  window.addEventListener('unhandledrejection', (ev) => {
    const r = ev.reason;
    if (r?.status === 401) return; // сессия — уже показано окно входа
    show(r);
  });
}
