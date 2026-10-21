import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { parseNum } from '../core/format.js';
import { attachCombo } from '../ui/combo.js';

/*
 * «Состав изделия» (TASKS БЗ-5) — правая панель: из каких материалов и метизов склада состоит изделие.
 * Открывается из карточки «Продукции» (действие «Изменить состав»); сервер — PUT /api/showcase/:id/composition.
 */
let target = null;
export const setCompositionTarget = (row) => { target = row; };

async function buildCompositionForm() {
  if (!target) throw new Error('Откройте изделие и нажмите «Изменить состав»');
  const prod = target;
  const items = (await api('/stock/items', { query: { limit: 10000 } })).items || [];
  const rows = (prod.composition || []).map((l) => ({ materialId: l.materialId, name: l.name, unit: l.unit, quantity: String(l.quantity), notes: l.notes || '' }));
  const list = h('div', { class: 'comp-lines' });
  const draw = () => {
    list.replaceChildren(...(rows.length ? rows.map((r, i) => {
      const q = h('input', { type: 'text', inputmode: 'decimal', value: r.quantity, 'aria-label': 'Количество' });
      q.addEventListener('input', () => { r.quantity = q.value; });
      return h('div', { class: 'field wide' }, h('span', null, `${r.name}, ${r.unit}`),
        h('div', null, q, h('button', { class: 'btn', type: 'button', title: 'Убрать из состава', onclick: () => { rows.splice(i, 1); draw(); } }, 'Убрать')));
    }) : [h('p', { class: 'muted' }, 'Состав пока пуст — добавьте материалы ниже')]));
  };
  const add = h('input', { type: 'text', placeholder: 'Добавить материал со склада: название или артикул…', autocomplete: 'off' });
  const addField = h('label', { class: 'field wide' }, h('span', null, 'Добавить'), add);
  attachCombo(add, {
    options: () => items.map((it) => ({ value: it.name, label: it.name, sub: [it.article, it.unit].filter(Boolean).join(' · '), id: it.id, unit: it.unit })),
    free: false,
    onPick: (o) => {
      if (!o?.id) return;
      if (rows.some((r) => r.materialId === o.id)) { add.value = ''; return; }
      rows.push({ materialId: o.id, name: o.value, unit: o.unit || 'шт', quantity: '1', notes: '' });
      add.value = ''; draw();
    },
  });
  draw();
  const el = h('div', null,
    h('p', { class: 'hint' }, `Изделие «${prod.name}»: из чего оно состоит. Количество — на одно изделие. Позиции заказов от этого не меняются.`),
    list, addField);
  return {
    el, focus: () => add.focus(), dirty: () => true,
    read: () => ({ values: { save: async () => {
      const lines = rows.map((r) => ({ materialId: r.materialId, quantity: parseNum(r.quantity), notes: r.notes }));
      if (lines.some((l) => !(l.quantity > 0))) throw new Error('Укажите количество больше нуля у каждой строки');
      return api(`/showcase/${prod.id}/composition`, { method: 'PUT', body: { lines } });
    } } }),
  };
}

export const composition = {
  id: 'composition', title: 'Состав изделия', newTitle: 'Состав изделия', card: { heading: () => 'Состав' }, get: async () => ({}),
  form: { build: buildCompositionForm, toBody: (v) => v, create: (v) => v.save(), saveLabel: 'Сохранить состав', closeAfterCreate: true },
};
