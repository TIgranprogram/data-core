import { h } from '../../core/dom.js';
import { hint, row } from '../../ui/kit/index.js';

/** Тексты справочника «Элементы» по выбранным id: фраза для описания и правила пользования. */
const asIds = (raw) => {
  if (Array.isArray(raw)) return raw.map(String).filter(Boolean);
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v.map(String).filter(Boolean) : []; } catch { return []; }
};
const lines = (v) => String(v || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

export function elementsTexts(rows) {
  let list = rows || [];
  let last = [];
  const el = h('div');
  const paint = () => {
    const byId = new Map(list.map((d) => [String(d.id || d._id || ''), d]));
    if (!last.length) {
      el.replaceChildren(hint('Элементы не выбраны. Отметьте «Что это за изделие» — здесь будут фраза для описания и правила пользования.'));
      return;
    }
    el.replaceChildren(...last.map((id) => {
      const d = byId.get(id);
      const desc = String(d?.inDescription || '').trim();
      const rules = lines(d?.usageRules);
      return row({
        title: d?.name || 'Элемент не найден в справочнике',
        wrap: true,
        below: h('div', null,
          h('p', null, desc || 'В описании текста нет — допишите в справочнике «Элементы»'),
          rules.length
            ? h('div', null, hint('Правила пользования'), ...rules.map((t) => h('p', null, t)))
            : hint('Правил пользования нет')),
      });
    }));
  };
  const setIds = (raw) => { last = asIds(raw); paint(); };
  return { el, setIds, setRows: (next) => { list = next || []; paint(); } };
}

/** Метки выбора и тексты под ними. value и setScope остаются у меток. */
export function withElementTexts(pick, rows, ids) {
  const view = elementsTexts(rows);
  view.setIds(ids ?? pick.value);
  pick.el.addEventListener('change', () => view.setIds(pick.value));
  return {
    el: h('div', null, pick.el, view.el),
    get value() { return pick.value; },
    set value(v) { pick.value = v; view.setIds(v); },
    focus: () => pick.focus?.(),
    setScope: (code) => pick.setScope?.(code),
  };
}
