import { h } from '../core/dom.js';
import { guide, button, toolbar } from '../ui/kit/index.js';
import { GROUPS, SECTIONS } from './help-guide-data.js';
import { EFFECTS, relationView } from './help-relations-data.js';

const svgEl = (tag, attrs, ...children) => {
  const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  e.append(...children); return e;
};

/** Карта соседей: любая сущность в центре, источники слева, использование справа. Без ручных координат сущностей. */
function graph(view, select) {
  const count = Math.max(view.incoming.length, view.outgoing.length, 1), height = count * 104 + 68;
  const svg = svgEl('svg', { viewBox: `0 0 980 ${height}`, width: '100%', role: 'group', 'aria-label': 'Связи выбранного раздела' });
  svg.append(svgEl('defs', {}, svgEl('marker', { id: 'hr-arrow', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' }, svgEl('path', { d: 'M0,0 L10,5 L0,10 z', fill: 'var(--muted)' }))));
  const centerY = height / 2;
  const node = (id, x, y, selected = false) => {
    const n = svgEl('g', { tabindex: 0, role: 'button', cursor: 'pointer', 'aria-label': SECTIONS[id].name, 'aria-pressed': String(selected), transform: `translate(${x},${y - 25})` },
      svgEl('rect', { width: 230, height: 50, rx: 9, fill: selected ? 'var(--primary-soft)' : 'var(--surface-3)', stroke: 'var(--border-strong)' }), svgEl('text', { x: 115, y: 29, 'text-anchor': 'middle', fill: 'var(--heading)', 'font-size': 15, 'font-weight': 600 }, SECTIONS[id].name));
    n.addEventListener('click', () => select(id));
    n.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); } });
    return n;
  };
  const side = (edges, incoming) => edges.forEach(([from, to, label], i) => {
    const y = 66 + i * 104, x1 = incoming ? 250 : 615, x2 = incoming ? 365 : 730;
    const y1 = incoming ? y : centerY, y2 = incoming ? centerY : y;
    svg.append(svgEl('path', { d: `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`, fill: 'none', stroke: 'var(--muted)', 'marker-end': 'url(#hr-arrow)' }));
    svg.append(node(incoming ? from : to, incoming ? 20 : 730, y));
    svg.append(svgEl('text', { x: incoming ? 135 : 845, y: y + 43, 'text-anchor': 'middle', fill: 'var(--muted)', 'font-size': 13 }, label));
  });
  side(view.incoming, true); side(view.outgoing, false);
  svg.append(node(view.selected, 365, centerY, true));
  return svg;
}

export function relationsCat(visible) {
  let selected = relationView('products', visible).selected;
  const detail = h('div', { 'aria-live': 'polite' }), choices = h('div');
  const select = (id) => { selected = id; paint(); const heading = detail.querySelector('h3'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); };
  const paint = () => {
    const view = relationView(selected, visible); selected = view.selected;
    if (!selected) return;
    choices.replaceChildren(...GROUPS.map((group) => {
      const ids = group.secs.filter((id) => view.ids.includes(id));
      return ids.length ? guide.unit({ name: group.name, foot: toolbar(...ids.map((id) => {
        const b = button({ label: SECTIONS[id].name, onClick: () => select(id) });
        b.setAttribute('aria-pressed', String(id === selected)); return b;
      })) }) : null;
    }).filter(Boolean));
    const entry = SECTIONS[selected];
    const links = (edges, incoming) => edges.length ? h('ul', null, edges.map(([a, b, label]) => h('li', null,
      button({ label: SECTIONS[incoming ? a : b].name, onClick: () => select(incoming ? a : b) }), ' — ', label))) : h('p', { class: 'muted' }, 'Прямые связи в этой карте не указаны.');
    detail.replaceChildren(h('h3', null, entry.name), h('p', null, entry.what),
      view.incoming.length || view.outgoing.length ? guide.diagram(graph(view, select)) : null,
      guide.unit({ name: 'Откуда сведения', foot: links(view.incoming, true) }),
      guide.unit({ name: 'Где используются', foot: links(view.outgoing, false) }),
      guide.unit({ name: 'Что учитывать при изменении', foot: (EFFECTS[selected] || [entry.strict || 'Проверяйте связанные записи перед изменением. Стрелка показывает связь, а не автоматическое обновление документов.']).map((text) => h('p', null, text)) }),
      entry.href ? h('a', { href: entry.href }, `Открыть: ${entry.name}`) : h('p', { class: 'muted' }, 'Открывается из карточек и поиска.'),
      entry.steps?.length ? guide.chain(entry.steps) : null);
  };
  paint();
  return guide.cat({ title: 'Как связан весь сайт', what: 'Выберите раздел: откуда берутся сведения, где используются и что учитывать при изменении', name: 'hp-relations', count: 'связи',
    body: [h('p', { class: 'muted small' }, 'Стрелки показывают связи данных; порядок действий — под схемой. Нажмите связанный блок, чтобы рассмотреть его.'),
      guide.cat({ title: 'Выбрать другой раздел', what: 'Все разделы сайта по группам', count: 'выбор', body: choices }), detail] });
}
