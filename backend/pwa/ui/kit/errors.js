/**
 * Ошибки — человеку только по-русски «что случилось + что сделать» (ОШ, CANON §1). Один разборщик для всплывашек,
 * форм и глобальных ошибок. Технические детали (TypeError, стек) — в консоль, не пользователю.
 *   errText(e) → текст для показа;  installGlobalErrors(show) — window error / unhandledrejection → show(e)
 *   actionText('сохранить паспорт', e) → «Не удалось сохранить паспорт: нет связи с сервером. Проверьте интернет…» (ОШ2.4)
 *   isFailure(e) — сбой (сеть, 5xx, ошибка кода/разбора), а не ответ сервера «так нельзя» (400/401/403/404/409/422/429)
 */
const GENERIC = 'Ошибка в приложении — она уже записана для разбора. Обновите страницу и повторите.'; // ОШ2: сбой уходит в /client-errors
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

const ANSWER = [400, 401, 403, 404, 409, 422, 429];
export function isFailure(e) {
  if (e == null) return true;
  const st = Number(e?.status);
  if (ANSWER.includes(st)) return false;
  if (st === 0 || st >= 500) return true;
  const msg = String(e?.message ?? e).trim();
  // наша проверка «Укажите…» (Error по-русски) — не сбой; внутренние TypeError и пр. — сбой
  return !(msg && ru(msg) && !INTERNAL.includes(e?.name || ''));
}

/** «Не удалось <действие>: <причина с маленькой>» — для ошибок действия человека; без действия — просто причина. */
export function actionText(action, e) {
  const t = errText(e);
  if (!action || !isFailure(e)) return t; // ответ сервера («Укажите артикул») — как есть, он уже про действие
  return `Не удалось ${String(action).replace(/^./, (c) => c.toLowerCase())}: ${t.replace(/^./, (c) => c.toLowerCase())}`;
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
