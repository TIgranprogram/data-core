import { textInput } from '../ui/kit/index.js';
import { h } from '../core/dom.js';
import { toastError } from '../ui/kit/toast.js';

/** Штатный табличный ввод: только клавиатура, без перетаскивания значений. */
export function noDrag(input) {
  for (const type of ['dragstart', 'dragover', 'drop']) input.addEventListener(type, event => {
    event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'none';
  });
  input.draggable = false; return input;
}
export function moveCell(input, dx, dy) {
  const cell = input.closest('td'), row = cell.parentElement, rows = [...row.closest('table').querySelectorAll('tbody tr')];
  const next = rows[rows.indexOf(row) + dy]?.children[cell.cellIndex + dx];
  const field = next?.querySelector('input:not([readonly])');
  if (field) { field.focus(); field.select(); }
}
export function gridField(cls, label, start, save, readOnly = false) {
  if (readOnly) return h('span', { 'aria-label': label }, start || '—');
  const { input } = textInput({ value: start, ...(cls === 'pg-in' ? { inputmode: 'decimal' } : {}) });
  input.classList.add(cls); input.readOnly = readOnly; input.setAttribute('aria-label', label);
  input.size = cls === 'pg-in' ? 8 : 24;
  noDrag(input);
  let was = start, saving = false;
  input.addEventListener('focus', () => input.select());
  input.addEventListener('blur', async () => {
    if (saving || input.value.trim() === was) return;
    saving = true; input.disabled = true; input.classList.add('is-busy');
    try {
      await save(input.value.trim()); was = input.value = input.value.trim();
      input.dataset.saved = '1';
    } catch (error) { input.value = was; toastError(error, 'сохранить'); }
    finally { saving = false; input.disabled = false; input.classList.remove('is-busy'); }
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); moveCell(input, 0, 1); }
    else if (event.key === 'Escape') { input.value = was; input.blur(); }
    else if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); input.blur(); moveCell(input, 0, event.key === 'ArrowDown' ? 1 : -1); }
  });
  return input;
}
