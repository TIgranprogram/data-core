import { h, fill } from '../../core/dom.js';
import { searchBox } from '../kit/searchbox.js';
import { atlasSearchIndex, findAtlasNodes } from './search-index.js';

export function atlasSearch(data, prefix, onSelect) {
  const index = atlasSearchIndex(data);
  const list = h('div', { id: prefix + '-results', class: 'am-search-options', role: 'listbox', 'aria-label': 'Результаты поиска по карте', hidden: true });
  const empty = h('p', { class: 'am-search-empty', role: 'status', hidden: true }, 'На карте ничего не найдено');
  let query, active = 0, results = [];
  const search = searchBox({
    label: 'Поиск по карте', placeholder: 'Поиск по карте', delay: 0,
    onSearch: update, onEnter: () => pick(active),
  });
  const { input } = search;
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-controls', list.id);
  const el = h('div', { class: 'am-search' }, search.el, list, empty);

  function display(show) {
    list.hidden = !show || !results.length;
    empty.hidden = !show || Boolean(results.length);
    input.setAttribute('aria-expanded', String(!list.hidden));
    if (!list.hidden) input.setAttribute('aria-activedescendant', list.children[active].id);
    else input.removeAttribute('aria-activedescendant');
  }

  function pick(i) {
    const item = results[i];
    if (!item) return;
    search.clear();
    onSelect(item.node.id);
  }

  function update(value) {
    if (value !== query) {
      query = value;
      results = findAtlasNodes(index, query);
      active = 0;
      fill(list, results.map(({ node, trail }, i) => h('button', {
        id: prefix + '-match-' + i, type: 'button', class: 'am-search-option', role: 'option',
        tabindex: -1, 'aria-selected': String(i === active),
        onmousedown: event => event.preventDefault(), onclick: () => pick(i),
      }, h('strong', null, node.title), trail || node.planned
        ? h('span', null, [trail, node.planned ? 'В планах' : ''].filter(Boolean).join(' · '))
        : null)));
    }
    display(Boolean(query) && el.contains(document.activeElement));
  }

  input.addEventListener('keydown', event => {
    if (list.hidden || !['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    list.children[active].setAttribute('aria-selected', 'false');
    active = (active + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length;
    list.children[active].setAttribute('aria-selected', 'true');
    list.children[active].scrollIntoView({ block: 'nearest' });
    display(true);
  });
  el.addEventListener('focusin', () => display(Boolean(query)));
  el.addEventListener('focusout', event => {
    if (!el.contains(event.relatedTarget)) display(false);
  });
  display(false);
  return el;
}
