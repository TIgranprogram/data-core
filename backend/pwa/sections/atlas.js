// «Карта сайта» (#atlas и прежний #help): общая карта, путь заказа и окно раздела.
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { entityPanel, guide, headbar, link, segmented } from '../ui/kit/index.js';
import { atlasFocus, atlasMap } from '../ui/kit/atlas-map.js';
import { buildAtlasModel, traceAtlas } from './atlas-model.js';
import { SECTIONS } from './help-guide-data.js';
import { bandOf, byId, nameOf } from './atlas-util.js';
import { detail } from './atlas-window.js';
import { atlasOverview } from './atlas-overview.js';

const model = buildAtlasModel();
const graphNodes = new Map(model.nodes.map((node) => [node.id, node]));
const compositionId = 'products.sostav';

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
    let mode = null, map = null, selected = null, directPanel = null;

    const close = () => {
      if (!panelEl) return;
      panelEl.remove(); panelEl = null; current = prev = null;
      document.removeEventListener('mousedown', onOutside, true);
      document.removeEventListener('keydown', onKey, true);
      map?.pin?.(selected);
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
      map?.pin(id);
      const shipping = id === 'salesorders' && opener?.dataset?.atlasStage === 'shipping';
      const title = shipping ? 'Отгрузка заказа' : record ? nameOf(record) : node.title;
      const band = bandOf.get(record?.band ?? node.band);
      const main = record ? detail(record, open, prev, dismiss, { shipping }) : guideDetail(node);
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
    const body = h('div');
    const overview = atlasOverview(open);
    const hint = h('p', { class: 'muted g-route-intro' }, 'От запроса клиента до расчётов. Нажмите на этап, чтобы увидеть его шаги.');
    const switcher = segmented({
      label: 'Вид карты сайта', fit: true, value: 'all',
      items: [{ key: 'all', label: 'Все связи' }, { key: 'route', label: 'Путь заказа' }],
      onChange: (next) => patch({ view: next === 'route' ? 'route' : null, n: null, ...(mode === 'composition' && { focus: null }) }),
    });
    const findOpener = (id) => [...body.querySelectorAll('[data-atlas-node], [data-node]')]
      .find((item) => (item.dataset.atlasNode || item.dataset.node) === id) || switcher.buttons[mode === 'route' ? 1 : 0];
    const render = (nextMode) => {
      const previous = mode;
      map?.destroy(); map = null; mode = nextMode;
      if (mode === 'route') el.classList.add('g-route-page');
      else el.classList.remove('g-route-page');
      switcher.set(mode === 'route' ? 'route' : 'all');
      if (mode === 'route') {
        body.replaceChildren(hint, overview);
        return;
      }
      map = mode === 'composition'
        ? atlasFocus({ model, id: compositionId, onExit: () => patch({ focus: null, n: null }) })
        : atlasMap({
          model, trace: traceAtlas,
          onOpen: (id, opener) => open(id, false, opener),
          onSelect: (id) => { selected = id; patch({ focus: id }); },
        });
      body.replaceChildren(map.el);
      map.pin?.(selected);
      if (mode === 'composition' && previous) map.focus?.();
    };
    const head = headbar(h('h1', null, 'Карта сайта'), switcher.el);
    head.classList.add('page-head', 'g-route-head');
    el.append(head, body);

    const update = ({ n, view, focus } = {}) => {
      const nextFocus = graphNodes.has(focus) ? focus : null;
      const nextMode = view === 'route' ? 'route' : nextFocus === compositionId ? 'composition' : 'all';
      if (mode !== nextMode) { close(); selected = nextFocus; render(nextMode); }
      else if (selected !== nextFocus) { selected = nextFocus; map?.pin?.(selected); }
      if (byId.has(n) || graphNodes.get(n)?.kind === 'section') {
        if (n !== directPanel || !panelEl) open(n, true, findOpener(n));
        directPanel = n;
      } else if (directPanel) {
        directPanel = null;
        close();
      }
    };
    update(params);
    const destroy = () => { close(); map?.destroy(); };
    return { update, destroy };
  },
};
