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
  const cell = input.closest('td'), row = cell.parentElement, table = row.closest('table');
  const rows = [...table.querySelectorAll('tbody tr')].filter(node => node.closest('table') === table && !node.classList.contains('pg-worker-detail'));
  if (row.classList.contains('pg-worker-detail')) return false;
  const index = rows.indexOf(row);
  for (let step = 1; step <= (dy ? rows.length : row.children.length); step++) {
    const next = rows[index + dy * step]?.children[cell.cellIndex + dx * step];
    if (!next) return false;
    const fields = [...next.querySelectorAll('input:not([readonly]):not(:disabled)')].filter(node => node.getClientRects().length);
    const field = fields.find(node => node.classList.contains(input.classList.contains('pg-note') ? 'pg-note' : 'pg-in')) || fields[0];
    if (field) { field.focus(); field.select(); return true; }
  }
  return false;
}
export function gridField(cls, label, start, save, readOnly = false, confirm = null) {
  if (readOnly) return h('span', { 'aria-label': label }, start || '—');
  const { input } = textInput({ value: start, ...(cls === 'pg-in' ? { inputmode: 'decimal' } : {}) });
  input.classList.add(cls); input.readOnly = readOnly; input.setAttribute('aria-label', label);
  input.size = cls === 'pg-in' ? 8 : 24;
  noDrag(input);
  let was = start, saving = false, returnFocus = false;
  const restore = () => { if (input.isConnected && document.activeElement === document.body) { input.focus(); input.select(); } returnFocus = false; };
  input.addEventListener('focus', () => input.select());
  if (confirm) {
    input.addEventListener('input', () => confirm.input(input));
    input.addEventListener('blur', () => { if (!input.dataset.gridReplacing) confirm.review(input); });
    input.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); confirm.cancel(input); }
      else if (event.key === 'Enter') { event.preventDefault(); if (confirm.review(input) === false) moveCell(input, 0, 1); }
      else if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); moveCell(input, 0, event.key === 'ArrowDown' ? 1 : -1); }
      else if (['ArrowRight', 'ArrowLeft'].includes(event.key) && input.selectionStart === input.selectionEnd
        && input.selectionStart === (event.key === 'ArrowRight' ? input.value.length : 0)) { event.preventDefault(); moveCell(input, event.key === 'ArrowRight' ? 1 : -1, 0); }
    });
    return input;
  }
  input.addEventListener('blur', async () => {
    if (saving || input.dataset.gridReplacing || input.value.trim() === was) return;
    saving = true; input.disabled = true; input.classList.add('is-busy');
    try {
      await save(input.value.trim()); was = input.value = input.value.trim();
      input.dataset.saved = '1';
    } catch (error) { input.value = was; toastError(error, 'сохранить'); }
    finally { saving = false; input.disabled = false; input.classList.remove('is-busy'); if (returnFocus) restore(); }
  });
  const jump = (dx, dy) => { input.blur(); if (!moveCell(input, dx, dy)) { if (saving) returnFocus = true; else restore(); } };
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); jump(0, 1); }
    else if (event.key === 'Escape') { input.value = was; input.blur(); }
    else if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); jump(0, event.key === 'ArrowDown' ? 1 : -1); }
    else if (['ArrowRight', 'ArrowLeft'].includes(event.key) && input.selectionStart === input.selectionEnd
      && input.selectionStart === (event.key === 'ArrowRight' ? input.value.length : 0)) {
      event.preventDefault(); jump(event.key === 'ArrowRight' ? 1 : -1, 0);
    }
  });
  return input;
}
