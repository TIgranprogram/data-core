import { h } from '../core/dom.js';

/*
 * Общее для выпадающих списков (TASKS ВС, DESIGN §4 «Выпадающий список»): текст не режем — панель шире поля,
 * пункт переносится; у края экрана панель разворачивается влево / вверх; на телефоне — лист снизу во всю ширину.
 */
const phone = () => window.matchMedia('(max-width: 720px)').matches;

/** Разместить открытую панель списка относительно поля: classes drop-up / align-right / sheet. */
export function placeList(box) {
  box.classList.remove('drop-up', 'align-right', 'sheet');
  if (phone()) { box.classList.add('sheet'); return; }
  const r = box.getBoundingClientRect();
  if (r.right > window.innerWidth - 12) box.classList.add('align-right');
  const anchor = box.parentElement.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 8 && anchor.top > window.innerHeight - anchor.bottom) box.classList.add('drop-up');
}

/** Подпись с выделенными совпадениями слов запроса (без innerHTML): «Болт **М10**». */
export function highlight(text, query) {
  const s = String(text ?? '');
  const words = String(query ?? '').toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter((w) => w.length > 0);
  if (!words.length) return s;
  const low = s.toLowerCase().replace(/ё/g, 'е');
  const marks = new Array(s.length).fill(false);
  for (const w of words) for (let i = low.indexOf(w); i >= 0; i = low.indexOf(w, i + 1)) for (let k = 0; k < w.length; k++) marks[i + k] = true;
  const out = []; let i = 0;
  while (i < s.length) { let j = i; while (j < s.length && marks[j] === marks[i]) j++; out.push(marks[i] ? h('mark', null, s.slice(i, j)) : s.slice(i, j)); i = j; }
  return out;
}
