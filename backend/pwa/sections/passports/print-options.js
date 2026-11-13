
/** Настройки печати паспорта (C104): форматы и сбор запроса — чистые функции. Окно настроек — printOptions в dialogs.js. */

// Значки форматов (замечание пользователя 2026-10-22: «показать визуально, книжная или альбомная»)
export const FORMATS = [
  { mode: 'pages', title: 'Файл A5', sub: 'книжный, постранично — отправить по почте', icon: 'sheetA5' },
  { mode: 'print', title: 'Буклет A4', sub: 'альбомный лист, сложить пополам; печать с двух сторон, переворот по короткому краю', icon: 'sheetBooklet' },
  { mode: 'stand', title: 'Лист для стенда A3', sub: 'правила пользования, книжный, без печати', icon: 'sheetA3' },
];
/** Для заказа лист для стенда не нужен. */
export const ORDER_FORMATS = FORMATS.filter((f) => f.mode !== 'stand');

/**
 * Параметры GET …/pdf по выбору в окне. Одинаково для паспорта и заказа.
 * `ids` — только для заказа (отмеченные паспорта).
 */
export function printQuery({ variant, mode = 'print', seal = false, sign = false, bw = false, ids = null }) {
  return {
    variant,
    ...(seal || sign ? { stamp: 1, ...(seal ? {} : { seal: 0 }), ...(sign ? {} : { sign: 0 }) } : {}),
    ...(mode === 'print' ? { mode: 'print' } : {}),
    ...(bw ? { bw: 1 } : {}),
    ...(ids ? { ids: ids.join(',') } : {}),
  };
}
