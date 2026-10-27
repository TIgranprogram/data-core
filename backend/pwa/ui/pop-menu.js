/** Всплывающее меню (DESIGN §4 «Всплывающее меню»): «Настройки» внизу меню (вверх) и меню аватара в шапке (вниз).
 *  На телефоне (≤ 760) — нижний лист с подложкой. Один открытый за раз. Esc / клик вне / выбор пункта закрывают, фокус — на кнопку. */
import { h } from '../core/dom.js';
import { icon } from './icons.js';

let current = null;
const isPhone = () => window.matchMedia?.('(max-width: 760px)').matches;

export function closePopMenu(refocus = false) { if (current) current.close(refocus); }

/** groups: [{ title?, items:[{ label, icon?, href?, onSelect?, danger?, sub? }], sep?: true }]; head: узел сверху (имя/роль). */
export function openPopMenu({ anchor, groups, head, side = 'up', cls = '' }) {
  closePopMenu();
  const phone = isPhone();
  const items = [];
  const done = (refocus) => { close(refocus); };
  const mkItem = (it) => {
    const attrs = { class: 'pm-item' + (it.danger ? ' danger' : ''), role: 'menuitem', tabindex: '-1' };
    const kids = [it.icon ? icon(it.icon) : null, h('span', { class: 'pm-lbl' }, it.label)];
    const el = it.href
      ? h('a', { ...attrs, href: it.href, onclick: () => done(false) }, ...kids)
      : h('button', { ...attrs, type: 'button', onclick: (e) => { e.preventDefault(); done(false); it.onSelect?.(); } }, ...kids);
    items.push(el);
    return el;
  };
  const body = [];
  if (phone) body.push(h('div', { class: 'pm-grip', 'aria-hidden': 'true' }));
  if (head) body.push(head);
  groups.filter((g) => g && g.items.some(Boolean)).forEach((g) => {
    body.push(h('div', { class: 'pm-group' + (g.sep ? ' sep' : ''), role: 'group', 'aria-label': g.title || null },
      g.title ? h('div', { class: 'pm-title' }, g.title) : null, ...g.items.filter(Boolean).map(mkItem)));
  });
  const pop = h('div', { class: 'pm ' + cls + (phone ? ' pm-sheet' : ''), role: 'menu', 'aria-label': 'Меню' }, ...body);
  const back = phone ? h('div', { class: 'pm-back', onclick: () => done(true) }) : null;
  document.body.append(...[back, pop].filter(Boolean));
  anchor.setAttribute('aria-expanded', 'true');
  if (!phone) {
    const r = anchor.getBoundingClientRect();
    const narrow = r.width < 60 && side === 'up'; // узкое меню — выезжает вправо от иконок
    if (side === 'up') {
      pop.style.bottom = Math.max(8, window.innerHeight - r.bottom + (narrow ? 0 : r.height + 8)) + 'px';
      pop.style.left = (narrow ? r.right + 8 : Math.max(8, r.left)) + 'px';
      if (narrow) pop.classList.add('pm-narrow');
    } else {
      pop.style.top = r.bottom + 6 + 'px';
      pop.style.right = Math.max(8, window.innerWidth - r.right) + 'px';
    }
  }
  const onKey = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); done(true); return; }
    if (!['ArrowDown', 'ArrowUp', 'Tab', 'Home', 'End'].includes(e.key) || !items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement);
    const step = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + step + items.length) % items.length;
    items[next].focus();
  };
  const onDoc = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) done(false); };
  const onResize = () => done(false);
  setTimeout(() => document.addEventListener('click', onDoc), 0);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', onResize);
  window.addEventListener('hashchange', onResize);
  function close(refocus) {
    if (current?.pop !== pop) return;
    document.removeEventListener('click', onDoc);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('hashchange', onResize);
    pop.remove(); back?.remove();
    anchor.setAttribute('aria-expanded', 'false');
    current = null;
    if (refocus) anchor.focus();
  }
  current = { pop, anchor, close };
  items[0]?.focus();
  return close;
}

/** Кнопка-переключатель: повторное нажатие закрывает. */
export const isOpenFor = (anchor) => current?.anchor === anchor;
