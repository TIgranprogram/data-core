import { api, patchVersioned } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { actions, button, enhanceSelect, hint, section, select, sideForm, stack, table, textInput, toast } from '../ui/kit/index.js';
import { workTypes } from './work-route.js';

/*
 * C122: виды работ детали (materials.materialKind='part' → workTypes [{ workTypeId, hours, days }]).
 * Просмотр — блок на карточке детали (partWorkBlock), правка — правая панель 'partwork' (ввод только справа, CLAUDE.md).
 */

/** Блок «Виды работ» на карточке детали. full — GET /materials/:id. */
export function partWorkBlock(full) {
  const box = h('div');
  const list = full?.workTypes || [];
  const edit = button({ label: list.length ? 'Изменить' : 'Указать виды работ', size: 'S', onClick: () => openPartWork(full.id) });
  if (!list.length) {
    box.append(section({ title: 'Виды работ', tone: 'main', side: edit,
      body: hint('Видов работ нет. Укажите, какие работы нужны для детали и сколько часов на 1 шт — они подставятся в маршрут изделия.') }));
    return box;
  }
  const tbl = h('div');
  box.append(section({ title: 'Виды работ', tone: 'main', count: list.length, side: edit, body: tbl }));
  workTypes().then((types) => {
    const name = (id) => types.find((t) => t.value === String(id))?.label || 'вид работы удалён';
    tbl.replaceChildren(table({
      columns: [{ label: 'Вид работы' }, { label: 'Часов на 1 шт', num: true }, { label: 'Дней в плане', num: true }],
      rows: list.map((w) => ({ cells: [name(w.workTypeId), w.hours != null ? qty(w.hours) : '—', w.days != null ? qty(w.days) : 'как у вида работы'] })),
    }));
  });
  return box;
}

const openPartWork = (id) => import('../ui/kit/side-form.js').then((m) => m.openSide('partwork', id));

const num = (v) => { const s = String(v ?? '').replace(',', '.').trim(); if (!s) return undefined; const n = Number(s); return Number.isFinite(n) && n >= 0 ? n : NaN; };

/** Редактор строк: вид работы (из справочника) · часы · дни · убрать. value — массив для PATCH. */
function rowsWidget(types, initial) {
  const body = stack();
  const rows = [];
  const add = (w = {}) => {
    const sel = select({ label: 'Вид работы', options: [['', 'Выберите вид работы'], ...types.map((t) => [t.value, t.label])], value: w.workTypeId ? String(w.workTypeId) : '' });
    const hours = textInput({ label: 'Часов на 1 шт', value: w.hours ?? '', inputmode: 'decimal', short: true, placeholder: 'часы' });
    const days = textInput({ label: 'Дней в плане', value: w.days ?? '', inputmode: 'decimal', short: true, placeholder: 'дни' });
    const row = { sel, hours, days, el: null };
    const del = button({ label: 'Убрать', size: 'S', kind: 'ghost', title: 'Убрать вид работы', onClick: () => { row.el.remove(); rows.splice(rows.indexOf(row), 1); } });
    row.el = stack(sel, actions(hours.el, days.el, del)); // вид работы — во всю строку, иначе название обрезано
    rows.push(row);
    body.append(row.el);
    enhanceSelect(sel, { force: true });
  };
  (initial.length ? initial : [{}]).forEach(add);
  const el = stack(body, button({ label: '+ Вид работы', size: 'S', onClick: () => add() }),
    hint('Дни пустые — берутся из справочника видов работ.'));
  return {
    el,
    get value() { // форма ждёт строку JSON (ui/kit/form.js); числа проверяет toBody
      return JSON.stringify(rows.filter((r) => r.sel.value).map((r) => ({ workTypeId: r.sel.value, hours: r.hours.input.value, days: r.days.input.value })));
    },
    set value(_) { /* строки задаются при открытии */ },
  };
}

export const partWork = sideForm({
  id: 'partwork', title: 'Виды работ детали', entityType: 'Material', noun: 'деталь',
  get: async (id) => ({ ...(await api(`/materials/${id}`)), _types: await workTypes() }),
  heading: (r) => r.name || '—',
  subheading: (r) => r.article || '',
  saveLabel: 'Сохранить',
  fields: (r) => {
    return [{ key: 'workTypes', type: 'widget', label: 'Виды работ', wide: true, summary: () => '', widget: () => rowsWidget(r._types || [], r.workTypes || []) }];
  },
  toInitial: () => ({}),
  toBody: (v) => {
    const list = (Array.isArray(v.workTypes) ? v.workTypes : []).map((x, i) => {
      const hv = num(x.hours), dv = num(x.days);
      if (Number.isNaN(hv) || Number.isNaN(dv)) throw new Error('Часы и дни — числа не меньше нуля');
      return { workTypeId: x.workTypeId, ...(hv !== undefined ? { hours: hv } : {}), ...(dv !== undefined ? { days: dv } : {}), sortOrder: i };
    });
    if (new Set(list.map((x) => x.workTypeId)).size !== list.length) throw new Error('Вид работы повторяется — оставьте одну строку');
    return { workTypes: list };
  },
  save: async (body, r) => { const saved = await patchVersioned(`/materials/${r.id}`, r, body); toast(body.workTypes.length ? `Видов работ: ${body.workTypes.length}` : 'Виды работ убраны'); return saved; },
});
