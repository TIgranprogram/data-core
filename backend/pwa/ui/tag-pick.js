import { h } from '../core/dom.js';

/**
 * Выбор нескольких значений метками (поле формы `type: 'widget'`; паспорт v2 — элементы, материалы; БЗ-6 Э5a1).
 * Метки — общий класс `.tag` (`.active` — выбрано), подпись снизу — `small`. Значение — JSON-список value.
 *   tagPick({ options: [{ value, label, sub?, cats? }], value, label? }) → { el, value, set value, focus, setScope(code) → [чужие выбранные] }
 * cats — коды категорий, к которым относится значение (пусто — ко всем). setScope(code): видны только свои;
 * уже выбранные чужие остаются с пометкой «не для этой категории» (`.tag.foreign`); «Показать все» — под списком (ФП).
 */
export function tagPick({ options, value, label }) {
  const parse = (v) => { if (Array.isArray(v)) return v.map(String); try { return (JSON.parse(v || '[]') || []).map(String); } catch { return []; } };
  let cur = new Set(parse(value));
  let scope = ''; let showAll = false;
  const box = h('div', { class: 'tag-pick', role: 'group', 'aria-label': label || 'Выбор' });
  const mine = (o) => !scope || !(o.cats || []).length || o.cats.includes(scope);
  const items = options.map((o) => {
    const note = h('small', null, o.sub || '');
    const b = h('button', { type: 'button', class: 'tag', 'aria-pressed': 'false', title: o.sub || '', onclick: () => { cur.has(String(o.value)) ? cur.delete(String(o.value)) : cur.add(String(o.value)); paint(); box.dispatchEvent(new Event('change', { bubbles: true })); } },
      o.label, note);
    b.dataset.v = String(o.value);
    return { o, b, note };
  });
  const more = h('button', { type: 'button', class: 'link-btn', hidden: true, onclick: () => { showAll = !showAll; paint(); } });
  const paint = () => {
    let hidden = 0;
    for (const { o, b, note } of items) {
      const on = cur.has(b.dataset.v); const own = mine(o);
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('foreign', !own);
      note.textContent = !own && on ? 'не для этой категории' : o.sub || '';
      b.hidden = !own && !on && !showAll;
      if (!own && !on) hidden++;
    }
    more.hidden = !scope || (!hidden && !showAll);
    more.textContent = showAll ? 'Только для этой категории' : `Показать все (ещё ${hidden})`;
  };
  box.append(...(items.length ? [...items.map((x) => x.b), more] : [h('span', { class: 'muted' }, 'Справочник пуст — заполните его в «Справочники → Паспорта»')]));
  paint();
  return {
    el: box,
    get value() { return JSON.stringify([...cur]); },
    set value(v) { cur = new Set(parse(v)); paint(); },
    focus: () => items.find((x) => !x.b.hidden)?.b.focus(),
    /** Категория паспорта сменилась: показать свои; вернуть подписи выбранных, что к ней не относятся. */
    setScope(code) { scope = code || ''; showAll = false; paint(); return items.filter((x) => cur.has(x.b.dataset.v) && !mine(x.o)).map((x) => x.o.label); },
  };
}
