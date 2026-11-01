/** Сторож «мусора на экране»: «[object …]», слова undefined / NaN / null, «Invalid Date», метки {…}.
 *  scrubText(text, where) → text или '' (мусор не показываем); сообщает в console.error и событие dc-garbage
 *  (core/errors.js отправляет его в /client-errors). Слова — только целые: «nullable», «Нет данных» не задеваются. */
const W = '[^\\p{L}\\p{N}_]';
export const GARBAGE = new RegExp(
  `\\[object [A-Za-z]|(?:^|${W})(?:undefined|NaN|null)(?=$|${W})|Invalid Date|\\{\\{?[A-Za-z_][\\w.]{0,40}\\}\\}?`, 'u');

export function isGarbage(text) {
  return typeof text === 'string' && text.length > 0 && GARBAGE.test(text);
}

export function scrubText(text, where = '') {
  if (!isGarbage(text)) return text;
  const msg = `[мусор на экране] ${where}: «${text.slice(0, 80)}»`;
  try { console.error(msg); } catch { /* нет консоли */ }
  try {
    if (typeof window !== 'undefined' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('dc-garbage', { detail: msg }));
  } catch { /* не в браузере */ }
  return '';
}
