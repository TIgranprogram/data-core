import { h, fill } from '../../core/dom.js';
import { button, link, searchBox, segmented } from '../kit/index.js';

export const LAYERS = {
  data: 'Данные', process: 'Процессы', structure: 'Состав и шаги', navigation: 'Переходы',
};
function normalized(value = '') {
  return String(value).toLocaleLowerCase('ru').replaceAll('ё', 'е');
}

export function isDirect(edge, nodeId, nodes, sectionOf) {
  if (!nodeId) return false;
  if (edge.from === nodeId || edge.to === nodeId) return true;
  return nodes.get(nodeId)?.kind === 'section' && (sectionOf(edge.from) === nodeId || sectionOf(edge.to) === nodeId);
}

export function atlasInspector({ nodes, sectionOf, edges, onSelect, onInspect }) {
  let scope = 'selected';
  let selected = null;
  let focusedEdge = null;
  let layerEdges = edges;
  let query = '';
  const edgeText = new Map(edges.map((edge) => [edge.id, normalized([
    nodes.get(edge.from).title, nodes.get(edge.to).title, edge.from, edge.to, edge.label, LAYERS[edge.kind],
  ].join(' '))]));
  const readout = h('div', { class: 'am-readout' });
  const list = h('ol', { class: 'am-relations' });
  const listWrap = h('div', { class: 'am-relations-wrap', tabindex: '0', 'aria-label': 'Список связей' }, list);
  const count = h('span', { class: 'am-count', role: 'status' });
  const search = searchBox({ label: 'Поиск по связям', placeholder: 'Название или связь', delay: 120, onSearch: (value) => {
    query = normalized(value);
    drawInspector();
  } });
  const scopeControl = segmented({
    items: [{ key: 'selected', label: 'Узел' }, { key: 'all', label: 'Вся карта' }], value: scope, fit: true, label: 'Какие связи показать',
    onChange: (next) => { scope = next; drawInspector(); },
  });
  const inspector = h('details', { class: 'am-inspector' },
    h('summary', { class: 'am-inspector-summary' }, h('strong', null, 'Связи'), count),
    h('div', { class: 'am-inspector-content' },
      h('div', { class: 'am-inspector-bar' }, scopeControl.el, search.el), readout, listWrap));
  inspector.addEventListener('toggle', () => { if (inspector.open) drawInspector(); });

  function endpoint(nodeId) {
    const node = nodes.get(nodeId);
    const owner = nodes.get(sectionOf(nodeId));
    const name = owner.id === node.id ? node.title : `${owner.title} · ${node.title}`;
    return link({ label: name, title: name, cls: 'am-endpoint', onClick: () => {
      onSelect(nodeId);
    } });
  }

  function relationRow(edge) {
    const incoming = selected && (edge.to === selected || sectionOf(edge.to) === selected);
    const outgoing = selected && (edge.from === selected || sectionOf(edge.from) === selected);
    const direction = scope === 'all' || !selected ? null : incoming && outgoing ? 'Внутри раздела' : incoming ? 'Входящая' : 'Исходящая';
    const locate = button({ label: 'На карте', size: 'S', kind: 'ghost', cls: 'am-locate', onClick: () => onInspect(edge) });
    locate.setAttribute('aria-pressed', String(edge.id === focusedEdge));
    return h('li', { class: 'am-relation', dataset: { layer: edge.kind, active: edge.id === focusedEdge, edge: edge.id } },
      h('div', { class: 'am-relation-head' }, h('span', { class: 'am-layer-label', 'data-layer': edge.kind }, h('span', { class: 'am-key' }), LAYERS[edge.kind]),
        direction ? h('span', { class: 'am-direction' }, direction) : null,
        edge.planned ? h('span', { class: 'am-direction' }, 'В планах') : null, locate),
      h('div', { class: 'am-relation-endpoints' }, endpoint(edge.from), h('span', { 'aria-label': 'передаёт в', class: 'am-relation-arrow' }, '→'), endpoint(edge.to)),
      edge.label ? h('p', null, edge.label) : null);
  }

  function drawInspector() {
    const visibleEdges = layerEdges.filter((edge) => (scope === 'all' || !selected || isDirect(edge, selected, nodes, sectionOf))
      && (!query || edgeText.get(edge.id).includes(query)));
    count.textContent = String(visibleEdges.length);
    if (!inspector.open) return;
    const activeEdge = focusedEdge && edges.find((edge) => edge.id === focusedEdge);
    readout.hidden = Boolean(visibleEdges.length) && !activeEdge;
    listWrap.hidden = !visibleEdges.length;
    fill(readout, activeEdge ? h('div', { class: 'am-relation-endpoints' }, endpoint(activeEdge.from),
      h('span', { 'aria-label': 'передаёт в', class: 'am-relation-arrow' }, '→'), endpoint(activeEdge.to)) : 'Связей по этим условиям нет.');
    fill(list, visibleEdges.map(relationRow));
  }

  return {
    el: inspector,
    render(state) {
      ({ selected, focusedEdge, layerEdges } = state);
      drawInspector();
    },
    resetScope() {
      scope = 'selected';
      query = '';
      search.set('', true);
      scopeControl.set(scope);
      inspector.open = true;
    },
    focusRelation(edgeId) {
      [...list.querySelectorAll('.am-relation')].find((row) => row.dataset.edge === edgeId)
        ?.querySelector('.am-locate')?.focus({ preventScroll: true });
    },
  };
}
