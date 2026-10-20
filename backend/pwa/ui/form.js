import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { parseNum } from '../core/format.js';
import { attachSuggest } from './suggest.js';

/**
 * Форма из описания полей (CANON §2 «Карточка»). Поле:
 *   { key, label, type: text|number|money|date|select|combo|textarea, required, wide, options, hint, min, placeholder }
 *   options — массив строк или { value, label } (для select/combo); у combo можно вводить своё значение.
 *   suggest — async () => [{ label, sub, cat, search, values }]: подсказки под полем, выбор заполняет несколько полей (ui/suggest.js).
 * Возвращает { el, read() → { values } | { errors }, dirty(), focus() }.
 */
export function buildForm(fields, initial = {}) {
  fields = fields.filter((f) => !f.money || session.canMoney); // суммы — только деньги-ролям
  const inputs = new Map();
  const grid = h('div', { class: 'form-grid' });
  for (const f of fields) {
    const id = 'f-' + f.key + '-' + Math.random().toString(36).slice(2, 7);
    const v = initial[f.key];
    let input;
    const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
    if (f.type === 'select') {
      const list = [...opts];
      if (v != null && v !== '' && !list.some((o) => String(o.value) === String(v))) list.push({ value: v, label: String(v) });
      input = h('select', { id, name: f.key, value: v ?? '' },
        f.required ? null : h('option', { value: '' }, '—'),
        list.map((o) => h('option', { value: String(o.value) }, o.label)));
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, name: f.key, rows: f.rows || 3, maxlength: f.max || 2000 });
      input.value = v ?? '';
    } else {
      const listId = f.type === 'combo' ? id + '-l' : undefined;
      input = h('input', {
        id, name: f.key, list: listId, placeholder: f.placeholder, autocomplete: 'off',
        type: f.type === 'date' ? 'date' : 'text',
        inputmode: f.type === 'number' || f.type === 'money' ? 'decimal' : undefined,
        maxlength: f.max || 500,
      });
      input.value = v ?? '';
      if (listId) grid.append(h('datalist', { id: listId }, opts.map((o) => h('option', { value: String(o.label) }))));
    }
    const err = h('div', { class: 'err', hidden: true });
    const label = h('label', { class: 'field' + (f.wide ? ' wide' : ''), for: id },
      h('span', null, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), input, f.hint ? h('div', { class: 'hint' }, f.hint) : null, err);
    grid.append(label);
    inputs.set(f.key, { f, input, err, label });
    if (f.suggest) {
      attachSuggest(input, { load: f.suggest, title: f.suggestTitle, onPick: (vals) => {
        for (const [k, v] of Object.entries(vals)) { const x = inputs.get(k); if (x && v != null && v !== '') x.input.value = String(v); }
      } });
    }
  }
  const snapshot = () => JSON.stringify([...inputs.values()].map(({ input }) => input.value));
  const start = snapshot();

  function read() {
    const values = {}, errors = {};
    for (const [key, { f, input, err, label }] of inputs) {
      const raw = input.value.trim();
      err.hidden = true; label.classList.remove('has-error');
      let val = raw === '' ? null : raw;
      if (val !== null && (f.type === 'number' || f.type === 'money')) {
        val = parseNum(raw);
        if (Number.isNaN(val)) errors[key] = 'Введите число';
        else if (f.min !== undefined && val < f.min) errors[key] = `Не меньше ${f.min}`;
      }
      if (f.required && (val === null || val === '')) errors[key] = 'Заполните поле';
      if (errors[key]) { err.textContent = errors[key]; err.hidden = false; label.classList.add('has-error'); }
      values[key] = val;
    }
    if (Object.keys(errors).length) {
      const first = inputs.get(Object.keys(errors)[0]);
      first.input.focus();
      return { errors };
    }
    return { values };
  }

  return {
    el: grid,
    read,
    dirty: () => snapshot() !== start,
    focus: () => [...inputs.values()][0]?.input.focus(),
  };
}
