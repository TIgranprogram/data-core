/* guide — эталон-путеводитель (страница «Работа с сайтом» и обучающие схемы):
 * cat — крупная сворачиваемая категория (аккордеон; одинаковый name — открыта одна),
 * unit — подраздел с описанием и цепочкой шагов, chain — шаги «что за чем»
 * (номер, действие, где в меню, пояснение), flow — полоса-обзор «как идти в целом»,
 * note — строка «Порядок важен / Можно потом», toggle — галочка-переключатель.
 * Вид — kit.css (классы g-…), цвета и размеры — токены. */
import { h } from '../../core/dom.js';
import { mark } from './mark.js';

/** Категория-аккордеон: в шапке название, подпись, метки разделов и счётчик; body — содержимое. */
export function cat({ title, what, chips, count, open = false, name, body }) {
  return mark(h('details', { class: 'g-cat', ...(name ? { name } : {}), ...(open ? { open: true } : {}) },
    h('summary', null,
      h('span', { class: 'g-sum' },
        h('span', { class: 'g-sum-t' }, title),
        what ? h('span', { class: 'g-sum-w' }, what) : null,
        chips?.length ? h('span', { class: 'g-chips' }, chips.map((c) => h('span', { class: 'g-chip' }, c))) : null),
      count != null ? h('span', { class: 'g-sum-n' }, String(count)) : null,
      h('span', { class: 'g-sum-a', 'aria-hidden': 'true' })),
    h('div', { class: 'g-body' }, body)), 'guide');
}

/** Подраздел: название (ссылка в раздел) + одной строкой «что это» + цепочка шагов и примечания. */
export function unit({ name, href, what, steps, strict, later, foot }) {
  return mark(h('div', { class: 'g-unit' },
    h('div', { class: 'g-unit-h' },
      h('b', { class: 'g-uname' }, href ? h('a', { href }, name) : name),
      what ? h('span', { class: 'g-uwhat' }, what) : null),
    steps?.length ? chain(steps) : null,
    strict ? note({ label: 'Порядок важен', text: strict, tone: 'warn' }) : null,
    later ? note({ label: 'Можно потом', text: later }) : null,
    foot || null), 'guide');
}

/** Цепочка «что за чем»: { t — действие, where — где в меню, d — пояснение }. Номера ставит CSS. */
export function chain(steps) {
  return mark(h('ol', { class: 'g-chain' }, steps.map((st) => h('li', null,
    h('b', { class: 'g-t' }, st.t),
    st.where ? h('span', { class: 'g-where' }, 'Меню: ' + st.where) : null,
    st.d ? h('span', { class: 'g-d' }, st.d) : null))), 'guide');
}

/** Полоса-обзор: пункты-пилюли со стрелками; клик — раскрыть свою категорию ниже. */
export function flow(items) {
  return mark(h('nav', { class: 'g-flow', 'aria-label': 'Порядок работы по группам' },
    items.flatMap((it, i) => [
      i ? h('i', { class: 'g-flow-sep', 'aria-hidden': 'true' }, '→') : null,
      h('button', { type: 'button', class: 'g-flow-chip', onclick: it.onClick, title: it.title || it.label }, it.label)])), 'guide');
}

/** Карточка «Я хочу…»: tok — цветовой токен раздела (--sec-*, полоса слева), menu — где в меню, href — ссылка в раздел. */
export function want({ tok, want, menu, href, start }) {
  const el = h('article', { class: 'g-want k-toned' },
    h('h3', null, want),
    menu ? h('div', { class: 'g-want-menu' }, h('span', { class: 'g-k' }, 'Раздел'), href ? h('a', { href }, menu) : h('span', null, menu)) : null,
    start ? h('p', null, start) : null);
  if (tok) el.style.setProperty('--tone', `var(--sec-${tok})`); // custom-свойства — только setProperty (h() их не ставит)
  return mark(el, 'guide');
}

/** Примечание: «Порядок важен: …» (tone warn) или «Можно потом: …». */
export function note({ label, text, tone }) {
  return mark(h('p', { class: 'g-note' + (tone ? ' g-note-warn' : '') }, h('b', null, label + ': '), text), 'guide');
}

/** Галочка-переключатель вида (например «Показать все разделы»). */
export function toggle({ label, checked = false, onChange }) {
  const input = h('input', { type: 'checkbox', ...(checked ? { checked: true } : {}) });
  input.addEventListener('change', () => onChange?.(input.checked));
  return mark(h('label', { class: 'check' }, input, ' ', label), 'guide');
}

/** Схема с текстовым дублем у потребителя: на узком экране оставляем читаемый список вместо миниатюрных кнопок. */
export function diagram(body) { return mark(h('div', { class: 'k-guide-diagram' }, body), 'guide'); }

export const guide = { cat, unit, chain, flow, want, note, toggle, diagram };
