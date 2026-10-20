import { h } from '../core/dom.js';
import { session } from '../core/api.js';
import { parseNum } from '../core/format.js';
import { photoField } from './photos.js';
import { attachCombo } from './combo.js';
import { attachSuggest } from './suggest.js';

/**
 * Форма из описания полей (CANON §2 «Карточка»). Поле:
 *   { key, label, type: text|number|money|date|select|combo|textarea|photos, required, wide, options, hint, min, placeholder }
 *   photos — значение [{ id, url, thumb }], в values — список id.
 *   options — массив строк или { value, label } (для select/combo); у combo можно вводить своё значение.
 *   { section: 'Название', tone: main|info|money|who, collapsed?, fixed? } — начинает цветной блок полей (сетка 4 колонки).
 *     Блок сворачивается кликом по заголовку (fixed — нельзя), состояние помнится; свёрнутый показывает, что в нём заполнено.
 *   type: 'pick' — «Категория → Позиция из базы» (TASKS В.1): { key: '_pick', type: 'pick', load: async () => [{ label, cat, sub, values }], target: 'title' };
 *     выбор заполняет поля из values, поле target становится «из базы» (только чтение, «изменить» — вернуть ручной ввод). В read() не попадает.
 *   type: 'segment' — кнопки-переключатель для 2–4 вариантов (options: { value, label, tone? }).
 *   span: 1|3 — ширина поля в блоке (из 4 колонок; по умолчанию 2, wide — вся строка).
 *   suggest — async () => [{ label, sub, cat, search, values }]: подсказки под полем, выбор заполняет несколько полей (ui/suggest.js).
 * Возвращает { el, read() → { values } | { errors }, dirty(), focus() }.
 */
export function buildForm(fields, initial = {}) {
  fields = fields.filter((f) => f && (!f.money || session.canMoney)); // суммы — только деньги-ролям
  const inputs = new Map();
  const root = fields.some((f) => f.section) ? h('div', { class: 'form-blocks' }) : null;
  let grid = h('div', { class: 'form-grid' });
  if (root && !fields[0]?.section) root.append(grid);
  const blocks = [];
  let blk = null;
  for (const f of fields) {
    if (f.section) {
      grid = h('div', { class: 'form-grid' });
      const block = h('section', { class: 'form-block', 'data-tone': f.tone || 'main' });
      const sum = h('span', { class: 'form-sec-sum' });
      const store = 'form-sec:' + f.section;
      let closed = !!f.collapsed;
      if (!f.fixed) { try { const x = localStorage.getItem(store); if (x !== null) closed = x === '1'; } catch { /* нет хранилища */ } }
      const title = h('span', { class: 'form-sec-t' }, f.section);
      const head = f.fixed
        ? h('div', { class: 'form-sec' }, title)
        : h('button', { type: 'button', class: 'form-sec', onclick: () => setOpen(b, b.block.classList.contains('closed'), true) },
          title, sum, h('span', { class: 'form-sec-chev', 'aria-hidden': 'true' }, '›'));
      block.append(head, grid);
      const b = { block, head, sum, store, keys: [] };
      blocks.push(b); blk = b;
      setOpen(b, !closed, false);
      root.append(block);
      continue;
    }
    const id = 'f-' + f.key + '-' + Math.random().toString(36).slice(2, 7);
    const v = initial[f.key];
    let input;
    const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
    if (f.type === 'photos') {
      // Фото: значение — список id; файлы грузятся сразу, привязка — при сохранении
      const pf = photoField(Array.isArray(v) ? v : []);
      input = { el: pf.el, get value() { return JSON.stringify(pf.ids()); }, focus: pf.focus };
      const err = h('div', { class: 'err', hidden: true });
      const label = h('div', { class: 'field wide' }, h('span', null, f.label), pf.el, f.hint ? h('div', { class: 'hint' }, f.hint) : null, err);
      grid.append(label);
      inputs.set(f.key, { f, input, err, label, blk });
      blk?.keys.push(f.key);
      continue;
    }
    if (f.type === 'pick') {
      let items = null; let catSel = '';
      const load = async () => { items ??= await f.load().catch(() => []); return items; };
      const cat = h('input', { placeholder: 'Все категории', 'aria-label': 'Категория' });
      const item = h('input', { placeholder: 'Начните печатать или выберите из списка…', 'aria-label': 'Позиция из базы' });
      const clear = h('button', { type: 'button', class: 'btn btn-ghost btn-sm pick-clear', hidden: true, title: 'Не из базы — ввести вручную' }, '× вручную');
      const row = h('div', { class: 'pick-row' }, h('label', { class: 'field' }, h('span', null, 'Категория'), cat), h('label', { class: 'field pick-item' }, h('span', null, 'Позиция из базы'), item), clear);
      const wrap = h('div', { class: 'field wide pick' }, row, h('div', { class: 'hint' }, f.hint || 'Уже заказывали или есть на складе — выберите, поля заполнятся сами. Нет в списке — заполните «Наименование» вручную.'));
      grid.append(wrap);
      const lock = (on) => {
        const tg = inputs.get(f.target || 'title');
        if (tg) { tg.input.readOnly = on; tg.label.classList.toggle('from-base', on); }
        clear.hidden = !on;
      };
      load().then(() => {
        const cats = [...new Set(items.map((x) => x.cat).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
        attachCombo(cat, { options: () => [{ label: 'Все категории', value: '' }, ...cats.map((c) => ({ label: c, value: c }))], onPick: (o) => { catSel = o.value; item.value = ''; item.focus(); } });
        cat.addEventListener('change', () => { const v = cat.value.trim(); catSel = !v || v === 'Все категории' ? '' : (cats.find((c) => c.toLowerCase() === v.toLowerCase()) || ''); });
        attachCombo(item, {
          options: () => items.filter((x) => !catSel || x.cat === catSel).map((x) => ({ label: x.label, sub: x.sub, group: catSel ? undefined : x.cat || 'Без категории', x })),
          onPick: (o) => {
            for (const [k, val] of Object.entries(o.x.values || {})) { const xx = inputs.get(k); if (xx && val != null && val !== '') xx.input.value = String(val); }
            lock(true); summarize();
          },
        });
      });
      clear.addEventListener('click', () => { lock(false); item.value = ''; const tg = inputs.get(f.target || 'title'); tg?.input.focus(); });
      continue;
    }
    if (f.type === 'segment') {
      let cur = String(v ?? opts[0]?.value ?? '');
      const btns = opts.map((o) => h('button', { type: 'button', role: 'radio', class: 'fseg-btn', 'data-v': String(o.value), 'data-tone': o.tone || '', onclick: () => set(o.value) }, o.label));
      const box = h('div', { class: 'fseg', role: 'radiogroup', id }, btns);
      const set = (x) => {
        cur = String(x ?? '');
        for (const b of btns) { const on = b.dataset.v === cur; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); }
        box.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set(cur);
      input = { el: box, get value() { return cur; }, set value(x) { set(x); }, focus: () => (btns.find((b) => b.dataset.v === cur) || btns[0])?.focus() };
    } else if (f.type === 'select') {
      const list = [...opts];
      if (v != null && v !== '' && !list.some((o) => String(o.value) === String(v))) list.push({ value: v, label: String(v) });
      input = h('select', { id, name: f.key, value: v ?? '' },
        f.required ? null : h('option', { value: '' }, '—'),
        list.map((o) => h('option', { value: String(o.value) }, o.label)));
    } else if (f.type === 'textarea') {
      input = h('textarea', { id, name: f.key, rows: f.rows || 3, maxlength: f.max || 2000 });
      input.value = v ?? '';
    } else {
      input = h('input', {
        id, name: f.key, placeholder: f.placeholder || (f.type === 'combo' ? 'Выберите или впишите' : undefined), autocomplete: 'off',
        type: f.type === 'date' ? 'date' : 'text',
        inputmode: f.type === 'number' || f.type === 'money' ? 'decimal' : undefined,
        maxlength: f.max || 500,
      });
      input.value = v ?? '';
    }
    const err = h('div', { class: 'err', hidden: true });
    const label = h(input.el ? 'div' : 'label', { class: 'field' + (f.wide ? ' wide' : '') + (f.span ? ' span-' + f.span : '') + (f.type === 'segment' ? ' is-seg' : ''), for: input.el ? undefined : id },
      h('span', null, f.label, f.required ? h('span', { class: 'req' }, ' *') : null), input.el || input, f.hint ? h('div', { class: 'hint' }, f.hint) : null, err);
    grid.append(label);
    inputs.set(f.key, { f, input, err, label, blk });
    blk?.keys.push(f.key);
    if (f.type === 'combo') attachCombo(input, { options: () => opts.map((o) => ({ label: String(o.label), value: o.value })) });
    if (f.suggest) {
      attachSuggest(input, { load: f.suggest, title: f.suggestTitle, onPick: (vals) => {
        for (const [k, v] of Object.entries(vals)) { const x = inputs.get(k); if (x && v != null && v !== '') x.input.value = String(v); }
        summarize();
      } });
    }
  }
  /** Свёрнутый блок показывает в заголовке то, что в нём уже заполнено. */
  function summarize() {
    for (const b of blocks) {
      const parts = [];
      for (const k of b.keys) {
        const { f, input } = inputs.get(k);
        const raw = String(input.value ?? '').trim();
        if (f.type === 'photos') { const n = JSON.parse(raw || '[]').length; if (n) parts.push(`фото: ${n}`); continue; }
        if (!raw) continue;
        if (f.type === 'select') parts.push(input.selectedOptions?.[0]?.textContent || raw);
        else if (f.type === 'segment') parts.push(input.el.querySelector('.on')?.textContent || raw);
        else if (f.type === 'date') parts.push(raw.split('-').reverse().join('.'));
        else parts.push(raw);
      }
      b.sum.textContent = parts.length ? parts.join(' · ') : 'не заполнено';
    }
  }
  if (root) { root.addEventListener('input', summarize); root.addEventListener('change', summarize); summarize(); }

  const snapshot = () => JSON.stringify([...inputs.values()].map(({ input }) => input.value));
  const start = snapshot();

  function read() {
    const values = {}, errors = {};
    for (const [key, { f, input, err, label }] of inputs) {
      const raw = input.value.trim();
      err.hidden = true; label.classList.remove('has-error');
      if (f.type === 'photos') { values[key] = JSON.parse(raw); continue; }
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
      for (const k of Object.keys(errors)) { const b = inputs.get(k).blk; if (b) setOpen(b, true, false); }
      const first = inputs.get(Object.keys(errors)[0]);
      first.input.focus();
      return { errors };
    }
    return { values };
  }

  return {
    el: root || grid,
    read,
    dirty: () => snapshot() !== start,
    focus: () => [...inputs.values()][0]?.input.focus(),
  };
}

function setOpen(b, open, remember) {
  b.block.classList.toggle('closed', !open);
  if (b.head.tagName === 'BUTTON') b.head.setAttribute('aria-expanded', String(open));
  if (remember) { try { localStorage.setItem(b.store, open ? '0' : '1'); } catch { /* нет хранилища */ } }
}
