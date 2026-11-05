import { h } from '../../core/dom.js';
import { parseNum } from '../../core/format.js';
import { mark } from './mark.js';
import { actions, iconButton } from './index.js';

/**
 * qtyInput — поле «Сколько» в ячейке kit.table (вариант «ввод количества»): число + кнопка «+1», при фокусе выделяется.
 *   qtyInput({ value, label (aria), plusLabel, max, onInput(n, text) }) → узел (.k-actions); .input — само поле (value/title правит экран).
 *   max — свободно: при n > max в title поля подсказка `maxText(max)` (по умолчанию «Свободно только N»).
 */
export function qtyInput({ value = '', label, plusLabel, max, maxText, onInput } = {}) {
  const input = h('input', { inputmode: 'decimal', placeholder: '0', 'aria-label': label || 'Сколько', value });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => {
    const n = parseNum(input.value);
    input.title = max != null && n > max && maxText ? maxText(max) : '';
    if (onInput) onInput(n, input.value);
  });
  const plus = iconButton({ icon: '+', label: plusLabel || 'Добавить', size: 'S', onClick: () => { input.value = String((parseNum(input.value) || 0) + 1); input.dispatchEvent(new Event('input')); } });
  const el = mark(actions(input, plus), 'qtyInput');
  el.input = input;
  return el;
}
