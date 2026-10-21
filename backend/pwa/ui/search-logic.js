/**
 * Логика строки поиска без браузера (TASKS ПО.3–ПО.4; тесты: search-logic.test.mjs). Одна для всех экранов:
 *  пусто → «без поиска» (clear) — список целиком; меньше minLength знаков → не искать, подсказка (hint);
 *  иначе → search(q). Одинаковое значение подряд не повторяется.
 */
export function searchDecider(minLength = 1) {
  let last = null;
  return function decide(raw) {
    const q = String(raw ?? '').replace(/\s+/g, ' ').trim();
    if (!q) { if (last === '') return { action: 'none', q }; last = ''; return { action: 'clear', q: '' }; }
    if (q.length < minLength) return { action: 'hint', q, hint: `Введите минимум ${minLength} ${minLength >= 2 && minLength <= 4 ? 'символа' : 'символов'}` };
    if (q === last) return { action: 'none', q };
    last = q; return { action: 'search', q };
  };
}

/**
 * Только последний ответ (ПО.2: быстрый ввод-стирание — старый медленный ответ не перезаписывает новый).
 *   const latest = onlyLatest();  const r = await latest(api(...));  if (r === latest.STALE) return;
 */
export function onlyLatest() {
  let n = 0;
  const STALE = Symbol('stale');
  const run = async (promise) => { const my = ++n; const v = await promise; return my === n ? v : STALE; };
  run.STALE = STALE;
  return run;
}
