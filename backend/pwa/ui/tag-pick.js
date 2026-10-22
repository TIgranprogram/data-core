import { h } from '../core/dom.js';

/**
 * Выбор нескольких значений метками (поле формы `type: 'widget'`; паспорт v2 — элементы, материалы; БЗ-6 Э5a1).
 * Метки — общий класс `.tag` (`.active` — выбрано), подпись снизу — `small`. Значение — JSON-список value.
 *   tagPick({ options: [{ value, label, sub? }], value }) → { el, value, set value, focus }
 */
export function tagPick({ options, value }) {
  const parse = (v) => { if (Array.isArray(v)) return v.map(String); try { return (JSON.parse(v || '[]') || []).map(String); } catch { return []; } };
  let cur = new Set(parse(value));
  const box = h('div', { class: 'tag-pick', role: 'group' });
  const btns = options.map((o) => {
    const b = h('button', { type: 'button', class: 'tag', 'aria-pressed': 'false', title: o.sub || '', onclick: () => { cur.has(String(o.value)) ? cur.delete(String(o.value)) : cur.add(String(o.value)); paint(); box.dispatchEvent(new Event('input', { bubbles: true })); } },
      o.label, o.sub ? h('small', null, o.sub) : null);
    b.dataset.v = String(o.value);
    return b;
  });
  const paint = () => btns.forEach((b) => { const on = cur.has(b.dataset.v); b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); });
  box.append(...(btns.length ? btns : [h('span', { class: 'muted' }, 'Справочник пуст — заполните его в «Справочники → Паспорта»')]));
  paint();
  return {
    el: box,
    get value() { return JSON.stringify([...cur]); },
    set value(v) { cur = new Set(parse(v)); paint(); },
    focus: () => btns[0]?.focus(),
  };
}
