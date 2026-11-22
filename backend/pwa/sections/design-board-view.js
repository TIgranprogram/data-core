import { h } from '../core/dom.js';
import { afterDrag, board as mountBoard, button, layout } from '../ui/kit/index.js';
import { designSide } from './design-side.js';

const SIDE_STATUSES = ['done', 'cancelled', 'paused'];

export function mountDesignBoard(board, path, initialQuery, options) {
  let query = initialQuery;
  const sideColumns = SIDE_STATUSES.map((key) => board.columns.find((col) => col.key === key));
  const views = new Map();
  const panel = h('section', { class: 'design-status-panel', id: 'design-status-panel', hidden: true });
  let shown;
  const pauseTarget = (target) => shown?.key === 'paused' && target.dataset.key === 'paused' && target.parentElement === views.get('paused')?.el;
  const active = mountBoard({ ...board, cls: 'design-board', columns: board.columns.filter((col) => !SIDE_STATUSES.includes(col.key)), externalDrop: pauseTarget }, path, query, options);
  const reloadColumns = () => {
    active.reload();
    views.get(shown?.key)?.reload();
  };
  const side = designSide({ query, board: active.el, pauseTarget, env: board.env, onBoard: reloadColumns });

  const tabs = sideColumns.map((col) => {
    const tab = button({ label: col.label, size: 'S', kind: 'ghost', cls: 'design-status-tab', onClick: () => show(shown === col ? null : col) });
    tab.id = `design-status-tab-${col.key}`;
    tab.setAttribute('aria-controls', panel.id);
    tab.setAttribute('aria-expanded', 'false');
    return tab;
  });
  const rail = h('div', { class: 'design-status-rail', role: 'group', 'aria-label': 'Дополнительные статусы задач' }, ...tabs);
  const main = h('div', { class: 'design-board-area' }, active.el, rail, panel);
  const el = layout.split({ side: side.el, main, sideLabel: 'Заказы в проектировании' });
  el.classList.add('design-board-layout');

  function show(col) {
    shown = col;
    tabs.forEach((tab, i) => tab.setAttribute('aria-expanded', String(sideColumns[i] === shown)));
    panel.hidden = !col;
    for (const [key, view] of views) view.el.hidden = key !== col?.key;
    if (!col) return;

    panel.setAttribute('aria-labelledby', `design-status-tab-${col.key}`);
    const existing = views.get(col.key);
    if (existing) existing.setQuery(query);
    else {
      const paused = col.key === 'paused';
      const view = mountBoard({ ...board, cls: 'design-status-board', columns: [col], headCount: false,
        move: paused ? board.move : undefined, add: paused ? board.add : undefined,
        externalDrop: paused ? (target) => target.parentElement === active.el : undefined,
      }, path, query, options);
      views.set(col.key, view);
      panel.append(view.el);
    }
  }
  main.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !shown || (!panel.contains(e.target) && !rail.contains(e.target))) return;
    e.stopPropagation();
    tabs[sideColumns.indexOf(shown)].focus();
    show(null);
  });

  const reload = () => afterDrag(() => {
    reloadColumns();
    side.reload();
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
