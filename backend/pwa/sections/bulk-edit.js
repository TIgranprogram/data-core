import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { attachCombo } from '../ui/combo.js';
import { confirmDlg } from '../ui/dialog.js';
import { tagPick } from '../ui/tag-pick.js';
import { toast } from '../ui/toast.js';

/*
 * «Изменить выбранные» (БЗ-9) — правая панель массового изменения: у каждого поля галочка «менять»; меняется только
 * отмеченное, остальное у записей остаётся своё. Перед записью — подтверждение «у N записей: …», после — «Отменить».
 *   openBulk({ title, ids, fields: async () => [поле], apply: async (set, arrays) => { updated, failed, before }, restore: async (before) => …, done })
 * Поле: { key, label, type: select|combo|text|number|date|tags|list, options?, modes?: true (добавить / заменить — для tags, list), hint?, map?(raw) }
 */
let job = null;
export function openBulk(cfg) { job = cfg; patch({ of: 'bulkedit', new: '1', open: undefined }); }

async function build() {
  if (!job?.ids?.length) throw new Error('Отметьте записи галочками в списке');
  const cur = job;
  const fields = await cur.fields();
  const rows = [];
  const body = h('div', { class: 'bulk-form' });
  for (const f of fields) {
    let ctl; let read;
    const opts = (f.options || []).map((o) => (typeof o === 'object' ? o : { value: o, label: o }));
    if (f.type === 'select') {
      ctl = h('select', { 'aria-label': f.label }, ...opts.map((o) => h('option', { value: String(o.value) }, o.label)));
      read = () => ctl.value;
    } else if (f.type === 'tags') {
      const tp = tagPick({ options: opts, value: '[]', label: f.label }); ctl = tp.el;
      read = () => JSON.parse(tp.value);
    } else {
      ctl = h('input', { type: f.type === 'date' ? 'date' : 'text', inputmode: f.type === 'number' ? 'decimal' : undefined, 'aria-label': f.label, autocomplete: 'off',
        placeholder: f.type === 'list' ? 'Через запятую' : f.type === 'combo' ? 'Выберите или впишите' : '' });
      read = () => ctl.value.trim();
    }
    const wrap = h('div', { class: 'bulk-ctl' }, ctl);
    if (f.type === 'combo') attachCombo(ctl, { options: () => opts.map((o) => ({ label: String(o.label), value: o.value, sub: o.sub })) });
    let mode = 'replace';
    const modeBox = f.modes ? h('div', { class: 'fseg', role: 'radiogroup', 'aria-label': 'Как менять' }) : null;
    const paintMode = () => modeBox?.replaceChildren(...[['add', 'Добавить к своим'], ['replace', 'Заменить']].map(([v, l]) => h('button', { type: 'button', role: 'radio', class: 'fseg-btn' + (mode === v ? ' on' : ''), 'aria-checked': String(mode === v), onclick: () => { mode = v; paintMode(); } }, l)));
    if (modeBox) { mode = 'add'; paintMode(); wrap.append(modeBox); }
    const use = h('input', { type: 'checkbox', 'aria-label': `Менять: ${f.label}` });
    const row = h('div', { class: 'bulk-row' }, h('label', { class: 'check bulk-use' }, use, h('span', null, f.label)), wrap, f.hint ? h('div', { class: 'hint' }, f.hint) : null);
    const paint = () => { row.classList.toggle('on', use.checked); wrap.inert = !use.checked; };
    use.addEventListener('change', () => { paint(); if (use.checked) setTimeout(() => (ctl.querySelector?.('input,select,button') || ctl).focus?.()); });
    // правка значения — сразу отмечает «менять»
    ctl.addEventListener('input', () => { if (!use.checked) { use.checked = true; paint(); } });
    ctl.addEventListener('change', () => { if (!use.checked) { use.checked = true; paint(); } });
    paint();
    rows.push({ f, use, read: () => (f.map ? f.map(read()) : read()), mode: () => mode });
    body.append(row);
  }
  const el = h('div', null,
    h('p', { class: 'hint' }, `Отмечено записей: ${cur.ids.length}. Поставьте галочку у поля, которое меняете, — у записей изменится только оно, остальное останется своим.`),
    body);
  return {
    el, dirty: () => rows.some((r) => r.use.checked), focus: () => rows[0]?.use.focus(),
    read: () => ({ values: { save: async () => {
      const used = rows.filter((r) => r.use.checked);
      if (!used.length) throw new Error('Отметьте галочкой, что изменить');
      const set = {}; const arrays = {};
      for (const r of used) { set[r.f.key] = r.read(); if (r.f.modes) arrays[r.f.key] = r.mode(); }
      const what = used.map((r) => r.f.label + (r.f.modes ? (r.mode() === 'add' ? ' (добавить)' : ' (заменить)') : '')).join(', ');
      if (!(await confirmDlg(`Изменить у ${cur.ids.length} записей?`, `Поля: ${what.replace(/\.$/, '')}. Остальное у записей не меняется. Сразу после — можно «Отменить».`, { okText: 'Изменить' }))) throw new Error('Отменено — ничего не изменено');
      const res = await cur.apply(set, arrays);
      const fail = res.failed?.length ? ` · не изменено: ${res.failed.length} (${res.failed[0].message})` : '';
      toast(`Изменено: ${res.updated}${fail}`, res.before?.length ? { undo: async () => { await cur.restore(res.before); toast('Отменено — вернули как было'); cur.done?.(); } } : {});
      cur.done?.();
      return res;
    } } }),
  };
}

export const bulkEdit = {
  id: 'bulkedit', title: 'Изменить выбранные', newTitle: 'Изменить выбранные', card: { heading: () => 'Изменить выбранные' }, get: async () => ({}),
  form: { build, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Изменить выбранные', closeAfterCreate: true },
};
