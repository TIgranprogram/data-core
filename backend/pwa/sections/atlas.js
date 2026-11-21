// «Карта сайта» (#atlas и прежний #help): полотно и ранее сохранённые ссылки на окно блока.
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { entityPanel, guide, link } from '../ui/kit/index.js';
import { atlasMap } from '../ui/kit/atlas-map.js';
import { buildAtlasModel, traceAtlas } from './atlas-model.js';
import { SECTIONS } from './help-guide-data.js';
import { bandOf, byId, nameOf } from './atlas-util.js';
import { detail } from './atlas-window.js';

const model = buildAtlasModel();
const graphNodes = new Map(model.nodes.map((node) => [node.id, node]));
const areaIds = new Set(model.groups.map(({ id }) => 'area:' + id));

function guideDetail(node) {
  const section = SECTIONS[node.section], steps = section?.steps || [];
  return [
    h('p', null, node.description),
    node.href ? link({ href: node.href, label: `Открыть раздел «${node.title}»` }) : null,
    steps.length ? guide.cat({ title: 'Как работать — по шагам', body: [guide.chain(steps)] }) : null,
  ];
}

export const atlas = {
  id: 'atlas',
  title: 'Карта сайта',
  mount(el, { params } = {}) {
    let panelEl = null, current = null, prev = null, returnTo = null;
    let selected = null, directPanel = null;

    const close = () => {
      if (!panelEl) return;
      panelEl.remove(); panelEl = null; current = prev = null;
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      map.pin(selected);
      if (returnTo) (returnTo.el?.isConnected ? returnTo.el : findOpener(returnTo.section))?.focus();
      returnTo = null;
    };
    const dismiss = () => {
      close();
      if (directPanel) patch({ n: null });
    };
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      dismiss();
    };
    const onOutside = (e) => {
      if (!panelEl.contains(e.target) && !e.target.closest?.('button, [role="button"], [data-atlas-node]')) dismiss();
    };
    const open = (id, goingBack = false, opener = document.activeElement) => {
      const node = graphNodes.get(id), record = byId.get(id);
      if (node?.kind !== 'section' && !record) return;
      prev = goingBack ? null : (current && current !== id ? byId.get(current) : prev);
      current = id;
      map.pin(id);
      const title = record ? nameOf(record) : node.title;
      const band = bandOf.get(record?.band ?? node.band);
      const main = record ? detail(record, open, prev, dismiss) : guideDetail(node);
      const p = entityPanel({ section: band?.name || 'Карта сайта', title, main, onClose: dismiss });
      p.el.classList.remove('k-panel');
      p.el.style.setProperty('--detail-w', 'min(1080px, 100vw)');
      if (!panelEl) {
        returnTo = { el: opener, section: id };
        document.addEventListener('keydown', onKey, true);
        document.addEventListener('mousedown', onOutside, true);
      }
      if (panelEl) panelEl.replaceWith(p.el); else document.body.append(p.el);
      panelEl = p.el;
      p.el.querySelector('.drawer-body')?.scrollTo(0, 0);
      p.el.querySelector('.drawer-head button')?.focus({ preventScroll: true });
    };
    const map = atlasMap({
      model,
      trace: traceAtlas,
      onSelect: (id) => {
        selected = id;
        patch({ focus: id, n: null, view: null });
      },
    });
    const findOpener = (id) => [...el.querySelectorAll('[data-node]')]
      .find((item) => !item.hidden && item.dataset.node === id) || map.el.querySelector('.am-viewport');
    el.classList.add('atlas-canvas-page');
    el.append(map.el);

    const update = ({ n, focus } = {}) => {
      const nextFocus = graphNodes.has(focus) || areaIds.has(focus) ? focus : null;
      if (selected !== nextFocus) { selected = nextFocus; map.pin(selected); }
      if (byId.has(n) || graphNodes.get(n)?.kind === 'section') {
        if (n !== directPanel || !panelEl) open(n, true, findOpener(n));
        directPanel = n;
      } else if (directPanel) {
        directPanel = null;
        close();
      }
    };
    update(params);
    const destroy = () => { close(); map.destroy(); };
    return { update, destroy };
  },
};
