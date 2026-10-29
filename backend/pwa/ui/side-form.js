import { h } from '../core/dom.js';
import { patch } from '../core/router.js';

/*
 * Ввод в правой панели вместо окна (аудит П3). Раздел `of=<id>&open=<ключ>`: сразу форма, «Сохранить» → запись → панель закрывается.
 *   sideForm({ id, title, entityType?, noun?, get(key) → row, heading(row), subheading?(row), fields(row) → поля,
 *              toInitial?(row), toBody?(values,row), save(body,row) → сохранённая запись | любое, saveLabel, canEdit?() })
 *   openSide(id, key) — открыть панель (key попадает в get).
 *   noteField(el) — служебное поле-подсказка (виджет без значения).
 * После сохранения шлёт `data-changed` — списки обновятся сами. Данные API не меняются — только оболочка.
 */
export function openSide(id, key) { patch({ of: id, open: String(key ?? 'x'), new: undefined }); }

export function noteField(el, key = '_note') {
  return { key, type: 'widget', label: '', wide: true, widget: () => ({ el, get value() { return ''; }, set value(_) { /* только показ */ } }) };
}

export function sideForm(cfg) {
  let cur = null;
  return {
    id: cfg.id,
    title: cfg.title,
    newTitle: cfg.title,
    noun: cfg.noun || 'запись',
    entityType: cfg.entityType,
    canEdit: cfg.canEdit,
    get: async (key) => ({ id: key, ...(await cfg.get(key)) }),
    card: {
      heading: cfg.heading,
      subheading: cfg.subheading,
      editTitle: cfg.editTitle || (() => cfg.title),
      noHistory: true,
      startEdit: () => true,
      view: () => [],
    },
    form: {
      saveLabel: cfg.saveLabel || 'Сохранить',
      fields: (row) => cfg.fields(row),
      toInitial: cfg.toInitial || ((r) => r),
      toBody: (v, row) => { cur = row; return cfg.toBody ? cfg.toBody(v, row) : v; },
      update: async (key, body) => {
        const saved = await cfg.save(body, cur);
        window.dispatchEvent(new Event('data-changed'));
        setTimeout(() => patch({ of: undefined, open: undefined }), 0); // форма уже сброшена — панель закрывается без вопроса
        return { id: key, ...(saved && typeof saved === 'object' ? saved : {}) , ...(saved?.id ? { id: saved.id } : {}) };
      },
    },
  };
}

/** Строка-сводка для верха формы. */
export const sideNote = (...parts) => h('div', { class: 'fill-note' }, ...parts);
