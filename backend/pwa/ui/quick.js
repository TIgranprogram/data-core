import { h } from '../core/dom.js';
import { parseNum } from '../core/format.js';
import { toast, toastError } from './toast.js';

/**
 * Быстрое добавление одной строкой (CANON §2): «что нужно · сколько · ед. · Enter».
 * Полная форма не нужна для 90% записей; остальное дописывается в карточке.
 * cfg = { placeholder, unitOptions, defaultUnit, create({ title, qty, unit }) → запись, after(row) }
 */
export function quickAdd(cfg) {
  const title = h('input', { class: 'q-title', placeholder: cfg.placeholder, 'aria-label': 'Наименование', maxlength: 500 });
  const qtyIn = h('input', { class: 'q-qty', inputmode: 'decimal', placeholder: 'Кол-во', value: '1', 'aria-label': 'Количество' });
  const listId = 'q-units-' + Math.random().toString(36).slice(2, 7);
  const unit = h('input', { class: 'q-unit', list: listId, value: cfg.defaultUnit || 'шт', 'aria-label': 'Единица', maxlength: 30 });
  const btn = h('button', { class: 'btn btn-primary', type: 'submit' }, 'Добавить');
  const form = h('form', { class: 'quick', autocomplete: 'off' },
    h('span', { class: 'q-plus', 'aria-hidden': 'true' }, '+'), title, qtyIn, unit, btn,
    h('datalist', { id: listId }, (cfg.unitOptions || []).map((u) => h('option', { value: u }))));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const t = title.value.trim();
    if (!t) { title.focus(); return; }
    const n = parseNum(qtyIn.value);
    if (n === undefined || Number.isNaN(n) || n <= 0) { qtyIn.focus(); qtyIn.select(); toast('Количество — число больше нуля', { error: true }); return; }
    btn.disabled = true;
    try {
      const row = await cfg.create({ title: t, qty: n, unit: unit.value.trim() || 'шт' });
      title.value = ''; qtyIn.value = '1';
      title.focus();
      cfg.after?.(row);
    } catch (ex) { toastError(ex); } finally { btn.disabled = false; }
  });
  return form;
}
