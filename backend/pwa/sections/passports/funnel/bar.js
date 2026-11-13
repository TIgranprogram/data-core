/** Текст закреплённой полосы воронки (Ф1, C112): «Осталось N: <что> →» и причина, почему «Выпустить» неактивна.
 *  Чистая логика без DOM — проверяется node:test.
 *    barText(required[{label}], status{ ready, why, need[{label}] }) → { ready, left, ok, title }
 *  left — ссылка «Осталось N …» (пусто, если осталось 0); ok — слова при 0; title — подсказка кнопки «Выпустить». */
export function barText(required = [], status = { ready: false, why: '', need: [] }) {
  const items = [...(required || []).map((m) => String(m?.label || '').trim()), ...((status?.need) || []).map((m) => String(m?.label || '').trim())].filter(Boolean);
  const n = items.length;
  if (n) {
    const more = n > 1 ? ` и ещё ${n - 1}` : '';
    return { ready: false, left: `Осталось ${n}: ${items[0]}${more} →`, ok: '', title: `Сначала: ${items[0]}${more}` };
  }
  return { ready: !!status?.ready, left: '', ok: status?.ready ? 'Всё заполнено — можно выпускать' : (status?.why || ''), title: status?.why || '' };
}
