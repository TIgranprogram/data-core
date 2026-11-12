import { h } from '../../core/dom.js';
import { photoField } from './photos.js';

/**
 * C095: варианты модуля сборного изделия (поле `type: 'widget'` формы паспорта). На каждый вариант — название,
 * габариты одной строкой, количество (шт.) и один рисунок. Пустой список — обычный паспорт.
 *   moduleVariantsBox({ value, dims }) → { el, value — JSON [{ name, size, qty, photoId }], focus }
 *   dims() — габариты изделия строкой («2500 × 1200 × 60 мм») для первого варианта.
 */
export function moduleVariantsBox({ value, dims = () => '' }) {
  const list = h('div', { class: 'mv-list' });
  const total = h('p', { class: 'mv-total muted', 'aria-live': 'polite' });
  const items = [];
  const parse = (v) => { if (Array.isArray(v)) return v; try { return JSON.parse(v || '[]') || []; } catch { return []; } };
  const changed = () => { recount(); el.dispatchEvent(new Event('input', { bubbles: true })); };

  function add(m = {}) {
    const name = h('input', { value: m.name ?? '', placeholder: 'Например: Секция 2500', maxlength: 200 });
    const size = h('input', { value: m.size ?? '', placeholder: 'Например: 2500 × 1200 × 60 мм', maxlength: 200 });
    const qty = h('input', { value: m.qty ?? '', inputmode: 'numeric', class: 'num', placeholder: '1' });
    const pic = photoField(m.photoId && m.url ? [{ id: String(m.photoId), url: m.url, thumb: m.url }] : []);
    const row = h('div', { class: 'mv-item' },
      h('div', { class: 'mv-head' }, h('b', { 'data-mv-no': '' }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { items.splice(items.indexOf(it), 1); row.remove(); renum(); changed(); } }, 'Убрать вариант')),
      h('div', { class: 'mv-fields' },
        h('label', { class: 'mv-f', 'data-mv': 'name' }, h('span', { class: 'mv-l' }, 'Название варианта'), name),
        h('label', { class: 'mv-f', 'data-mv': 'size' }, h('span', { class: 'mv-l' }, 'Габариты'), size),
        h('label', { class: 'mv-f', 'data-mv': 'qty' }, h('span', { class: 'mv-l' }, 'Количество, шт.'), qty)),
      h('div', { class: 'mv-f' }, h('span', { class: 'mv-l' }, 'Рисунок варианта (если есть)'), pic.el));
    const it = {
      row, name, focus: () => name.focus(),
      read: () => {
        const ids = pic.ids();
        return { name: name.value.trim(), size: size.value.trim(), qty: Number(qty.value.trim()), ...(ids[0] ? { photoId: ids[0] } : {}) };
      },
    };
    row.addEventListener('input', changed);
    row.addEventListener('click', (e) => { if (e.target.closest('.pf-del')) setTimeout(changed); });
    items.push(it);
    list.append(row);
    renum();
    return it;
  }
  const renum = () => items.forEach((it, i) => { it.row.querySelector('[data-mv-no]').textContent = `Вариант ${i + 1}`; });
  const filled = () => items.map((it) => it.read()).filter((m) => m.name || m.size || m.qty);
  function recount() {
    const ok = filled().filter((m) => m.name && Number.isInteger(m.qty) && m.qty > 0);
    const bad = filled().length - ok.length;
    const sum = ok.reduce((s, m) => s + m.qty, 0);
    total.textContent = !items.length ? 'Вариантов нет — обычный паспорт изделия.'
      : `${ok.length > 1 ? `Всего модулей: ${sum} шт.` : ok.length ? `Модулей: ${sum} шт.` : ''}${bad ? `${ok.length ? ' · ' : ''}Не заполнено у ${bad}: нужно название и целое количество больше нуля` : ''}`;
  }
  const set = (v) => { items.splice(0); list.replaceChildren(); parse(v).forEach((m) => add(m)); recount(); };
  const addBtn = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { const it = add(items.length ? {} : { size: dims() }); recount(); it.focus(); } }, '+ Вариант модуля');
  const el = h('div', { class: 'mv' },
    h('p', { class: 'hint' }, 'Для сборного изделия: на каждый вариант — габариты, рисунок и количество. В PDF — таблица «Варианты модуля»; при нескольких вариантах — строка «Всего модулей».'),
    list, h('div', { class: 'mv-foot' }, addBtn, total));
  set(value);
  return {
    el,
    get value() { return JSON.stringify(filled()); },
    set value(v) { set(v); },
    focus: () => (items[0] ? items[0].focus() : addBtn.focus()),
  };
}
