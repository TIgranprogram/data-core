import { h } from '../core/dom.js';
import { afterDrag, board as mountBoard, button, layout } from '../ui/kit/index.js';
import { designSide } from './design-side.js';

const ARCHIVE = new Set(['done', 'cancelled']);

export function mountDesignBoard(board, path, initialQuery, options) {
  let query = initialQuery;
  const archiveColumns = board.columns.filter((col) => ARCHIVE.has(col.key));
  const active = mountBoard({ ...board, cls: 'design-board', columns: board.columns.filter((col) => !ARCHIVE.has(col.key)) }, path, query, options);
  const side = designSide({ query, board: active.el, env: board.env, onBoard: () => active.reload() });
  const views = new Map();
  const panel = h('section', { class: 'design-archive-panel', id: 'design-archive-panel', hidden: true });
  let shown;

  const tabs = archiveColumns.map((col) => {
    const tab = button({ label: col.label, size: 'S', kind: 'ghost', cls: 'design-archive-tab', onClick: () => show(shown === col ? null : col) });
    tab.id = `design-archive-tab-${col.key}`;
    tab.setAttribute('aria-controls', panel.id);
    tab.setAttribute('aria-expanded', 'false');
    return tab;
  });
  const rail = h('div', { class: 'design-archive-rail', role: 'group', 'aria-label': 'Архив задач' }, ...tabs);
  const main = h('div', { class: 'design-board-area' }, active.el, rail, panel);
  const el = layout.split({ side: side.el, main, sideLabel: 'Заказы в проектировании' });
  el.classList.add('design-board-layout');

  function show(col) {
    shown = col;
    tabs.forEach((tab, i) => tab.setAttribute('aria-expanded', String(archiveColumns[i] === shown)));
    panel.hidden = !col;
    for (const [key, view] of views) view.el.hidden = key !== col?.key;
    if (!col) return;

    panel.setAttribute('aria-labelledby', `design-archive-tab-${col.key}`);
    const existing = views.get(col.key);
    if (existing) existing.setQuery(query);
    else {
      const view = mountBoard({ ...board, cls: 'design-archive-board', columns: [col], headCount: false, move: undefined, add: undefined }, path, query, options);
      views.set(col.key, view);
      panel.append(view.el);
    }
  }
  main.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !shown || (!panel.contains(e.target) && !rail.contains(e.target))) return;
    e.stopPropagation();
    tabs[archiveColumns.indexOf(shown)].focus();
    show(null);
  });

  const reload = () => afterDrag(() => {
    active.reload();
    side.reload();
    views.get(shown?.key)?.reload();
  });
  return {
    el, reload, reloadFor: reload,
    setQuery: (next) => {
      // Открытие соседней панели не должно сбрасывать выбор и перезагружать колонки при тех же фильтрах.
      if (JSON.stringify(next) === JSON.stringify(query)) return;
      query = next;
      afterDrag(() => {
        active.setQuery(query);
        side.setQuery(query);
        views.get(shown?.key)?.setQuery(query);
      });
    },
  };
}
