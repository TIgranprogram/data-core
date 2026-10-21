import { h } from '../core/dom.js';
import { searchDecider } from './search-logic.js';

/*
 * Строка поиска — одна на всё приложение (TASKS ПО.3, CANON §2 «поиск: пусто = всё»): шапка, списки, справочники,
 * «Операции». Поле + свой крестик (браузерный type=search рисуется по-разному — не используем), пауза ввода,
 * Esc — очистить, минимум знаков с подсказкой. Пусто = «без поиска»: onSearch('') — экран возвращает всё.
 *   const sb = searchBox({ value, placeholder, delay: 300, minLength: 1, onSearch: (q) => …, onEnter: (q) => … });
 *   sb.el · sb.input · sb.set(v) (без события) · sb.focus() · sb.clear()
 */
export function searchBox({ value = '', placeholder = 'Поиск…', label = 'Поиск', delay = 300, minLength = 1, onSearch, onEnter, className = '' }) {
  const decide = searchDecider(minLength);
  decide(value); // текущее значение — уже применено
  const input = h('input', { type: 'text', inputmode: 'search', enterkeyhint: 'search', autocomplete: 'off', placeholder, 'aria-label': label, value });
  const x = h('button', { type: 'button', class: 'sb-x', title: 'Очистить (Esc)', 'aria-label': 'Очистить поиск', hidden: !value, onclick: () => { clear(); input.focus(); } }, '×');
  const hint = h('div', { class: 'sb-hint', hidden: true, role: 'status' });
  const el = h('div', { class: ('sb ' + className).trim() }, input, x, hint);
  let t;
  const apply = () => {
    clearTimeout(t);
    const d = decide(input.value);
    hint.hidden = d.action !== 'hint'; hint.textContent = d.hint || '';
    if (d.action === 'search' || d.action === 'clear') onSearch?.(d.q);
  };
  input.addEventListener('input', () => { x.hidden = !input.value; if (!input.value.trim()) apply(); else { clearTimeout(t); t = setTimeout(apply, delay); } }); // стёрли — сразу
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && input.value) { e.stopPropagation(); clear(); }
    else if (e.key === 'Enter') { e.preventDefault(); apply(); onEnter?.(input.value.trim()); }
  });
  function clear() { input.value = ''; x.hidden = true; apply(); }
  return {
    el, input,
    /** Поставить значение без поиска (адрес поменялся извне). */
    set(v, force = false) { if (!force && document.activeElement === input) return; input.value = v || ''; x.hidden = !input.value; hint.hidden = true; decide(input.value); },
    focus: () => input.focus(),
    clear,
  };
}
