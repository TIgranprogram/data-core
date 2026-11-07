import { stockList } from '../core/stock-list.js';
import { TYPE_ALL, typeValues } from '../core/facets.js';
import { h } from '../core/dom.js';
import { plural } from '../core/format.js';
import { busyBlock, button, card, failBlock, hint, tileGrid, typeArt } from '../ui/kit/index.js';

/*
 * Плитки типов выбранной категории («Болт», «Гайка»…) для посадочной «Склада»: kit card S artCover в tileGrid, как категории.
 * Типы читаются по действию (раскрыли категорию) из общего списка склада; нажатие на плитку → onPick(тип).
 */
const nPos = (n) => `${n} ${plural(n, 'позиция', 'позиции', 'позиций')}`;
const art = (t, cat) => { const el = h('span'); el.innerHTML = typeArt(t, cat); return el; }; // свой статичный SVG, данных пользователя нет

/** typeTiles({ categoryId, categoryName, onPick(type) }) → { el, load } — el кладётся в тело раскрывающейся плитки, load() вызывают при раскрытии. */
export function typeTiles({ categoryId, categoryName, onPick }) {
  const el = h('div', null, hint('Загружаю типы…'));
  async function load() {
    el.replaceChildren(busyBlock('типы'));
    try {
      const items = (await stockList()).filter((it) => it.categoryId === categoryId);
      const types = typeValues(items).filter((t) => t.id !== TYPE_ALL);
      el.replaceChildren(types.length ? tileGrid(...types.map((t) => card({ size: 'S', artCover: true, art: art(t.label, categoryName), title: t.label, meta: nPos(t.count), onClick: () => onPick(t.id) }))) : hint('Типы не определены — откройте всю категорию.'));
    } catch (e) { el.replaceChildren(failBlock(e, load)); }
  }
  return { el, load };
}

/** Поля expand/onToggle для card S категории: раскрыли — плитки типов; «Вся категория →» и плитка типа вызывают onPick('' | тип). */
export function typeExpand({ categoryId, categoryName, onPick }) {
  const tt = typeTiles({ categoryId, categoryName, onPick });
  let loaded = false;
  return {
    expand: { title: 'Типы: ' + categoryName, action: button({ label: 'Вся категория →', kind: 'ghost', size: 'S', onClick: () => onPick('') }), body: tt.el },
    onToggle: (isOpen) => { if (isOpen && !loaded) { loaded = true; tt.load(); } },
  };
}
