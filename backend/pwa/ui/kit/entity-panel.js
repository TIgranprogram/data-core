import { mark } from './mark.js';
import { h } from '../../core/dom.js';

/**
 * entityPanel — единое представление сущности в правой панели (ПМ-1, docs/roles/tz/RIGHT-PANEL-V2.md).
 *   entityPanel({ section, title, kind?, main: Node|() => Node, related: [{ key, title, meta?, count?, node?, onOpen }],
 *                 active?, history?: () => Promise<Node>, onClose? }) → { el, setMain(node), setActive(key) }
 * Сверху вниз: «где мы» (раздел › сущность), главный блок раздела, карточки связей (сетка от 240 px),
 * история — внизу, всегда свёрнута, грузится по нажатию. Карточка связи — .tile (card S) с k-hover.
 */
export function entityPanel({ section, title, kind, main, related = [], active, history, onClose } = {}) {
  const where = h('div', { class: 'ep-where' }, section ? h('span', { class: 'ep-sec' }, section) : null, section ? h('span', { class: 'ep-sep', 'aria-hidden': 'true' }, '›') : null, h('b', null, title));
  const head = h('div', { class: 'drawer-head' }, h('div', { class: 't' }, kind ? h('div', { class: 'drawer-kind' }, kind) : null, where),
    onClose ? h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Закрыть панель', 'aria-label': 'Закрыть', onclick: onClose }, '✕') : null);
  const mainBox = h('section', { class: 'ep-main form-block', 'data-tone': 'main' });
  const setMain = (node) => { mainBox.replaceChildren(...[].concat(typeof node === 'function' ? node() : node).filter(Boolean)); };
  setMain(main);
  const tiles = related.map((r) => h('div', { class: 'tile k-s k-hover' + (r.key === active ? ' is-active' : ''), tabindex: '0', role: 'button', dataset: { key: String(r.key) },
    onclick: () => r.onOpen?.(r), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); r.onOpen?.(r); } } },
  h('b', { title: r.title }, r.title), r.meta ? h('span', { class: 'muted' }, r.meta) : null, r.count != null ? h('span', { class: 'ep-count' }, String(r.count)) : null, r.node || null));
  const rel = tiles.length ? h('section', { class: 'ep-related', 'aria-label': 'Связанные разделы' }, h('div', { class: 'form-sec-t' }, 'Связано'), h('div', { class: 'ep-grid' }, ...tiles)) : null;
  let hist = null;
  if (history) {
    const box = h('div', { class: 'ep-hist-body' });
    let loaded = false;
    hist = h('details', { class: 'ep-hist', ontoggle: async (e) => {
      if (!e.target.open || loaded) return;
      loaded = true; box.textContent = 'Загрузка…';
      try { box.replaceChildren(await history()); } catch (err) { loaded = false; box.textContent = 'Не удалось загрузить историю'; }
    } }, h('summary', null, 'История изменений'), box);
  }
  const body = h('div', { class: 'drawer-body ep-body' }, mainBox, rel, hist);
  const setActive = (key) => tiles.forEach((t) => t.classList.toggle('is-active', t.dataset.key === String(key)));
  const el = mark(h('aside', { class: 'drawer docked k-panel k-entity', role: 'region', 'aria-label': title }, head, body), 'entityPanel');
  return { el, setMain, setActive };
}
