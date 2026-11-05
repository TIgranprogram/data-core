/** Отметка происхождения (site-audit A1): каждая фабрика kit ставит на корень data-k="<эталон>".
 *  Аудит считает элементы экрана без data-k на себе и на предках — «не из kit». */
export const mark = (el, name) => { if (el && el.setAttribute) el.setAttribute('data-k', name); return el; };
/** То же для фабрик, возвращающих { el, … }: помечается el (или сам узел). Результат — как был. */
export const markEl = (res, name) => { mark(res && res.el ? res.el : res, name); return res; };
