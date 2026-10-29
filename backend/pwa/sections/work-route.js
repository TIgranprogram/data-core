import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { failBlock } from '../ui/busy.js';
import { enhanceSelect } from '../ui/select.js';
import { toast, toastError } from '../ui/toast.js';

/*
 * «Как делается» в карточке изделия: маршрут по видам работ (сварка → покраска → сборка). По нему «Запустить в работу»
 * ведёт карточку изделия по доске «В работе». GET /work-routes/:productId, PUT — записать маршрут целиком (пустой — убрать).
 * Нет маршрута — сервер даёт подсказку из модулей изделия («Взять подсказку»); без маршрута изделие запускается одной работой «Изготовление».
 */
let typesP = null, typesAt = 0;
/** Виды работ из справочника: [{ value, label }], один запрос на минуту. */
export const workTypes = () => {
  if (!typesP || Date.now() - typesAt > 60000) {
    typesAt = Date.now();
    typesP = api('/dicts/worktypes').then((r) => (r.items || []).map((x) => ({ value: String(x.id), label: x.name || '' })).filter((x) => x.label).sort((a, b) => a.label.localeCompare(b.label, 'ru'))).catch(() => { typesP = null; return []; });
  }
  return typesP;
};

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const cut = (steps) => steps.map((s) => ({ workTypeId: s.workTypeId || '', lineId: s.lineId || '', note: (s.note || '').trim() }));

export function routeBlock(product) {
  const box = h('div', { class: 'wk-route' });
  const can = session.canEdit;
  let data = null, types = [], steps = [], saved = [];

  async function load() {
    box.replaceChildren(h('div', { class: 'section-title' }, 'Как делается'), h('div', { class: 'skel', style: { width: '60%' } }));
    try { [data, types] = await Promise.all([api('/work-routes/' + product.id), workTypes()]); }
    catch (e) { box.replaceChildren(h('div', { class: 'section-title' }, 'Как делается'), failBlock(e, load)); return; }
    steps = data.steps.map((s) => ({ workTypeId: s.workTypeId, lineId: s.lineId || '', note: s.note || '' }));
    saved = cut(steps);
    paint();
  }

  function sel(options, value, onChange, { empty, label }) {
    const el = h('select', { 'aria-label': label },
      empty ? h('option', { value: '' }, empty) : null,
      ...options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(value) }, o.label)));
    // вид работ, которого нет в справочнике (удалён), остаётся выбранным, а не подменяется первым в списке
    el.value = value || '';
    el.addEventListener('change', () => onChange(el.value));
    return el;
  }

  function paint() {
    const dirty = !same(cut(steps), saved);
    const parts = (data.parts || []).map((p, i) => ({ value: p.id, label: `${i + 1}. ${p.name || 'часть состава'}` }));
    const move = (i, d) => { const j = i + d; if (j < 0 || j >= steps.length) return; [steps[i], steps[j]] = [steps[j], steps[i]]; paint(); };
    const rows = steps.map((s, i) => {
      const used = new Set(steps.filter((_, k) => k !== i).map((x) => x.workTypeId));
      const opts = types.filter((t) => !used.has(t.value) || t.value === s.workTypeId);
      const typeSel = sel(opts, s.workTypeId, (v) => { s.workTypeId = v; paint(); }, { empty: 'Выберите вид работ', label: `Шаг ${i + 1}: вид работ` });
      const partSel = parts.length ? sel(parts, s.lineId, (v) => { s.lineId = v; paint(); }, { empty: 'Вся часть изделия', label: `Шаг ${i + 1}: часть состава` }) : null;
      const note = h('input', { type: 'text', value: s.note, maxlength: 300, placeholder: 'Примечание (необязательно)', 'aria-label': `Шаг ${i + 1}: примечание`, oninput: (e) => { s.note = e.target.value; markDirty(); } });
      if (!can) return h('li', { class: 'wk-rt-row' }, h('span', { class: 'wk-rt-n' }, i + 1), h('div', { class: 'wk-rt-main' }, h('b', null, types.find((t) => t.value === s.workTypeId)?.label || data.steps[i]?.name || '—'), s.note ? h('span', { class: 'muted' }, ' · ' + s.note) : null));
      const row = h('li', { class: 'wk-rt-row' }, h('span', { class: 'wk-rt-n' }, i + 1),
        h('div', { class: 'wk-rt-main' }, typeSel, partSel, note),
        h('div', { class: 'wk-rt-btns' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Выше', 'aria-label': 'Шаг выше', disabled: i === 0, onclick: () => move(i, -1) }, '↑'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Ниже', 'aria-label': 'Шаг ниже', disabled: i === steps.length - 1, onclick: () => move(i, 1) }, '↓'),
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Убрать шаг', 'aria-label': 'Убрать шаг', onclick: () => { steps.splice(i, 1); paint(); } }, '✕')));
      enhanceSelect(typeSel, { force: true }); if (partSel) enhanceSelect(partSel, { force: true });
      return row;
    });
    const saveBtn = h('button', { type: 'button', class: 'btn btn-primary btn-sm', disabled: !dirty, onclick: (e) => save(e.currentTarget) }, 'Сохранить');
    const hint = h('span', { class: 'muted' }, dirty ? 'Есть несохранённые изменения' : '');
    function markDirty() { const d = !same(cut(steps), saved); saveBtn.disabled = !d; hint.textContent = d ? 'Есть несохранённые изменения' : ''; }
    const free = types.filter((t) => !steps.some((s) => s.workTypeId === t.value));
    const sug = (data.suggested || []).filter((x) => types.some((t) => t.value === x.workTypeId));
    const acts = can ? h('div', { class: 'spec-acts' },
      h('button', { type: 'button', class: 'btn btn-sm', disabled: !free.length, title: free.length ? '' : 'Все виды работ уже в маршруте', onclick: () => { steps.push({ workTypeId: '', lineId: '', note: '' }); paint(); box.querySelector('.wk-rt-row:last-child select, .wk-rt-row:last-child .sel-input')?.focus(); } }, '+ Добавить работу'),
      !steps.length && sug.length ? h('button', { type: 'button', class: 'btn btn-sm', title: 'Виды работ из модулей изделия', onclick: () => { steps = sug.map((x) => ({ workTypeId: x.workTypeId, lineId: x.lineId || '', note: '' })); paint(); } }, 'Взять подсказку: ' + sug.map((x) => x.name).join(' → ')) : null,
      saveBtn, hint) : null;
    box.replaceChildren(h('div', { class: 'section-title' }, 'Как делается'),
      rows.length ? h('ol', { class: 'wk-rt-list' }, ...rows)
        : h('p', { class: 'muted' }, (data.note || 'Не задано, как делается') + '. ' + (can ? 'Без маршрута изделие запускается одной работой «Изготовление». Добавьте работы по порядку или возьмите подсказку.' : '')),
      data.droppedSteps ? h('p', { class: 'hint' }, `Виды работ, удалённые из справочника, в маршруте не показаны: ${data.droppedSteps}. После сохранения они уйдут.`) : null,
      acts);
  }

  async function save(btn) {
    const body = steps.map((s) => ({ workTypeId: s.workTypeId, ...(s.lineId ? { lineId: s.lineId } : {}), ...(s.note.trim() ? { note: s.note.trim() } : {}) }));
    if (body.some((s) => !s.workTypeId)) { toast('У шага не выбран вид работ — выберите или уберите шаг'); return; }
    btn.disabled = true; btn.classList.add('is-busy');
    try {
      await api('/work-routes/' + product.id, { method: 'PUT', body: { steps: body } });
      toast(body.length ? 'Маршрут сохранён' : 'Маршрут убран');
      await load(); // перечитать: так видно, что записалось
    } catch (e) { toastError(e, 'сохранить маршрут'); btn.disabled = false; btn.classList.remove('is-busy'); }
  }

  load();
  return box;
}
