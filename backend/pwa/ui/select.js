import { h } from '../core/dom.js';
import { attachCombo } from './combo.js';

/*
 * Выбор из списка без обрезки (TASKS ВС.6): нативный <select> рисует браузер — длинное значение обрезается,
 * открытый список не стилизуется. enhanceSelect(sel) прячет <select> и ставит рядом поле с общим списком (ui/combo.js):
 * можно печатать для поиска, группы <optgroup> — заголовками. Значение по-прежнему в <select> (код раздела не меняется):
 * выбор ставит sel.value и шлёт change. Короткие списки (да/нет, статус, ед.) не трогаем — только длинные (isLong).
 */
export const isLong = (sel, { chars = 28, count = 12 } = {}) => sel.options.length > count || [...sel.options].some((o) => o.textContent.length > chars);

export function enhanceSelect(sel, { force = false } = {}, tries = 0) {
  if (sel.dataset.enhanced || (!force && !isLong(sel))) return sel;
  // поле ещё не в документе (форма собирается) — подождать, пока встанет на место
  if (!sel.parentElement) { if (tries < 60) requestAnimationFrame(() => enhanceSelect(sel, { force }, tries + 1)); return sel; }
  sel.dataset.enhanced = '1';
  const empty = [...sel.options].find((o) => o.value === '');
  const input = h('input', { class: 'sel-input' + (sel.className ? ' ' + sel.className : ''), autocomplete: 'off', placeholder: empty?.textContent || 'Выберите', 'aria-label': sel.getAttribute('aria-label') || '' });
  const wrap = h('span', { class: 'sel-wrap' }, input);
  sel.insertAdjacentElement('afterend', wrap);
  sel.hidden = true;
  const label = () => { const o = sel.selectedOptions[0]; return o && o.value !== '' ? o.textContent : ''; };
  const sync = () => { input.value = label(); input.title = input.value; };
  const opts = () => [...sel.options].map((o) => ({ value: o.value, label: o.value === '' ? (o.textContent || '—') : o.textContent, group: o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement.label : undefined }));
  attachCombo(input, {
    options: opts,
    onPick: (o) => { sel.value = o.value; sync(); sel.dispatchEvent(new Event('change', { bubbles: true })); },
    empty: () => 'Ничего не нашлось — сотрите и выберите из списка',
  });
  // только из списка: ушли с поля с чужим текстом — вернуть выбранное
  input.addEventListener('blur', () => setTimeout(() => { if (input.value !== label()) sync(); }, 150));
  // программная смена sel.value (сброс фильтров, загрузка опций) — подхватить
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true });
  sel.addEventListener('change', sync);
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(); } });
  sync();
  return sel;
}
