import { h } from '../../core/dom.js';
import { makeResizable } from '../resizer.js';
import { mark } from './mark.js';
import { button } from './index.js';

let nextId = 0;

/** Общая левая панель. Поля остаются в DOM, поиск и кнопка доступны в обоих состояниях. */
export function filterPanel({ key, fields, search, content, count = 0, reset }) {
  const id = 'list-filters-' + ++nextId;
  const pref = 'dc:filters:open:' + key;
  const mobile = () => matchMedia('(max-width: 720px)').matches;
  let open = false;
  try { open = !mobile() && localStorage.getItem(pref) === '1'; } catch { /* приватный режим */ }
  const toggle = button({ label: 'Фильтры', size: 'S', onClick: () => setOpen(!open) });
  toggle.setAttribute('aria-controls', id);
  const close = () => { setOpen(false); toggle.focus(); };
  const side = h('aside', { class: 'list-side', id, 'aria-label': 'Фильтры' },
    h('div', { class: 'ls-head' }, h('b', null, 'Фильтры'), button({ label: 'Закрыть', kind: 'ghost', size: 'S', onClick: close })),
    h('div', { class: 'ls-body' }, fields),
    h('div', { class: 'ls-foot' }, button({ label: 'Показать', kind: 'primary', onClick: close })));
  makeResizable(side, { prefKey: 'filterW', edge: 'right', label: 'Ширина панели фильтров' });
  const shade = h('div', { class: 'ls-shade', onclick: close });
  const grid = h('div', { class: 'ls-grid' }, side, h('div', { class: 'ls-main' }, content));
  // C266: «Сбросить всё» — вверху рядом с «Фильтры», не внизу панели (сливалось с текстом)
  const el = h('div', { class: 'filter-layout', onkeydown: (e) => {
    if (e.key === 'Escape' && open && !e.defaultPrevented) { e.stopPropagation(); close(); }
  } }, h('div', { class: 'filter-tools' }, toggle, reset || null, search), grid, shade);
  function sync() {
    side.hidden = shade.hidden = !open;
    side.classList.toggle('open', open);
    grid.classList.toggle('filters-closed', !open);
    toggle.setAttribute('aria-expanded', String(open));
  }
  function setOpen(value) {
    open = value;
    if (!mobile()) { try { localStorage.setItem(pref, open ? '1' : '0'); } catch { /* приватный режим */ } }
    sync();
    if (open && mobile()) side.querySelector('button')?.focus();
  }
  function setCount(n) { toggle.textContent = 'Фильтры' + (n ? ' · ' + n : ''); }
  setCount(count);
  sync();
  return { el: mark(el, 'filter'), side, close, setCount };
}
