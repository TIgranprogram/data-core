import { h } from '../core/dom.js';

/*
 * Общее для выпадающих списков (TASKS ВС, DESIGN §4 «Выпадающий список»): текст не режем — панель шире поля,
 * пункт переносится; у края экрана панель разворачивается влево / вверх; на телефоне — лист снизу во всю ширину.
 */
const phone = () => window.matchMedia('(max-width: 720px)').matches;

/** Ближайший предок, который обрезает/прокручивает содержимое (окно .modal, тело правой панели и т. п.), или null. */
function clipper(el) {
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll|hidden)/.test(s.overflowY + ' ' + s.overflowX)) return p;
  }
  return null;
}

/**
 * Разместить открытую панель списка относительно поля: classes drop-up / align-right / sheet.
 * Поле внутри окна или панели с прокруткой — список «плавающий» поверх всего (position: fixed по месту поля): иначе
 * он раздувает окно полосами прокрутки справа и снизу и обрезается (замечание 2026-10-23, окно «Выдать из брони»).
 */
const GAP = 76; // ≈2 см до края экрана

export function placeList(box) {
  if (!box.parentElement) return; // окно уже закрыто — список вне страницы (ошибка с сайта 2026-10-29)
  box.classList.remove('drop-up', 'align-right', 'sheet', 'floating');
  for (const k of ['left', 'top', 'bottom', 'minWidth', 'maxHeight']) box.style[k] = '';
  if (phone()) { box.classList.add('sheet'); return; }
  if (clipper(box)) {
    const a = (box.previousElementSibling || box.parentElement).getBoundingClientRect();
    box.classList.add('floating');
    box.style.minWidth = a.width + 'px';
    const vw = window.innerWidth, vh = window.innerHeight, w = box.offsetWidth;
    box.style.left = Math.max(12, Math.min(a.left, vw - 12 - w)) + 'px';
    const below = vh - a.bottom - 10, above = a.top - 10, up = below < 220 && above > below;
    box.style.maxHeight = Math.max(120, (up ? above : below) - GAP) + 'px';
    if (up) box.style.bottom = (vh - a.top + 2) + 'px'; else box.style.top = (a.bottom + 2) + 'px';
    return;
  }
  // высота — до низа экрана с отступом GAP (≈2 см), меньше прокрутки (пользователь 2026-10-28)
  const anchor = box.parentElement.getBoundingClientRect();
  const below = window.innerHeight - anchor.bottom - GAP, above = anchor.top - GAP;
  const up = below < 220 && above > below;
  if (up) box.classList.add('drop-up');
  box.style.maxHeight = Math.max(120, up ? above : below) + 'px';
  const r = box.getBoundingClientRect();
  if (r.right > window.innerWidth - 12) box.classList.add('align-right');
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

// плавающие списки едут вместе с полем при прокрутке окна/страницы и при смене размера
const reflow = (e) => {
  if (e?.target?.classList?.contains?.('combo-list') || e?.target?.classList?.contains?.('suggest')) return; // прокрутка самого списка
  document.querySelectorAll('.combo-list.floating:not([hidden]), .suggest.floating:not([hidden])').forEach(placeList);
};
window.addEventListener('scroll', reflow, true);
window.addEventListener('resize', reflow);
