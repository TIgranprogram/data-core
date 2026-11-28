import { h } from '../../core/dom.js';
import { plural, qty } from '../../core/format.js';
import { current, patch } from '../../core/router.js';
import { stepFunnel, button as kitButton, card, tileGrid, landing, section } from '../../ui/kit/index.js';
import { catArt } from '../../ui/cat-art.js';
import { groupsTree, groupsFresh, facets } from './data.js';

// Первая страница «Продукции»: разделы и их группы плитками с рисунком; клик — тот же фильтр, что дерево слева.
// Раздел без групп — плиткой в «Другие разделы». «Все изделия списком» (?all=1) — прежняя галерея.
export const nItems = (n) => `${qty(n)} ${plural(n, 'изделие', 'изделия', 'изделий')}`;
/** ПРД.6: самый глубокий выбранный шаг воронки (раздел → группа → подгруппа) — это groupId для сервера (он берёт всё поддерево). */
export const deepGroup = (P) => P.sub || P.grp || P.sec || '';

const art = (name) => { const el = h('span'); el.innerHTML = catArt(name); return el; }; // предметная иллюстрация из набора приложения
const catTile = (g, pick) => card({ size: 'S', artCover: true, art: art(g.name), title: g.name, meta: nItems(g.count || 0), onClick: () => pick(g.id) });
const SEC_KEY = 'dc-prod-sec'; // раскрытый раздел — «назад» из галереи видит то же
const secOpen = () => { try { return sessionStorage.getItem(SEC_KEY) || ''; } catch { return ''; } };
const secSave = (id) => { try { if (id) sessionStorage.setItem(SEC_KEY, id); else sessionStorage.removeItem(SEC_KEY); } catch { /* приватный режим */ } };

/** ПРД.6: воронка «Раздел → Группа → Подгруппа → Серия», у значений — число изделий. Числа групп — /showcase/groups, серий — facets. */
export function prodFunnel() {
  const kids = (all, pid) => all.filter((g) => (pid ? g.parentId === pid : !g.parentId)).map((g) => ({ value: g.id, label: g.name, n: g.count }));
  let gallery = false;
  let revision = 0;
  const f = stepFunnel({
    title: 'Уточнить',
    steps: [{ key: 'sec', label: 'Раздел', when: () => !gallery, always: true, icon: (o) => { const i = h('span', { class: 'ff-ico', 'aria-hidden': 'true' }); i.innerHTML = catArt(o.label); return i; } }, { key: 'grp', label: 'Группа', when: (P) => !gallery && P.sec }, { key: 'sub', label: 'Подгруппа', when: (P) => !gallery && P.grp }, { key: 'series', label: 'Серия' }],
    onChange: (P, key) => {
      const change = { [key]: P[key], page: undefined };
      if (key === 'sec') change.grp = undefined;
      if (key === 'sec' || key === 'grp') change.sub = undefined;
      patch(change);
    },
    load: async (P) => {
      const all = await groupsTree();
      const r = await facets({ ...(deepGroup(P) ? { groupId: deepGroup(P) } : {}), ...(P.status ? { status: P.status } : {}), ...(P.q ? { search: P.q } : {}) });
      return { sec: kids(all, null), grp: P.sec ? kids(all, P.sec) : [], sub: P.grp ? kids(all, P.grp) : [], series: r.facets?.series || [] };
    },
  });
  return { el: f.el, update: async (P, view) => {
    gallery = !!view?.gallery;
    const version = ++revision;
    // старая ссылка #products?groupId=… или выбор с плиток раздела: раскладываем путь по шагам
    if (P.groupId && !deepGroup(P)) {
      const all = await groupsTree(); const path = []; let cur = all.find((g) => g.id === P.groupId);
      while (cur && path.length < 3) { path.unshift(cur.id); cur = all.find((g) => g.id === cur.parentId); }
      if (version !== revision || current().section !== 'products' || current().params.groupId !== P.groupId) return;
      patch({ groupId: undefined, sec: path[0], grp: path[1], sub: path[2], page: undefined });
      return;
    }
    f.update(P);
  } };
}

/** Путь в иерархии галереи. Переход на родителя сохраняет поиск, статус и серию. */
export function productPathBar() {
  const nav = h('nav', { class: 'product-path', 'aria-label': 'Разделы продукции', hidden: true });
  let version = 0;
  let chooseSection = false;
  nav.onParams = async (P, view) => {
    const request = ++version;
    const hasCriteria = !!(P.q || P.series || P.status || P.needsIdentification);
    nav.hidden = !view?.gallery || !(deepGroup(P) || P.all || hasCriteria);
    nav.replaceChildren();
    if (nav.hidden) return;
    const all = await groupsTree();
    if (request !== version) return;
    const keys = ['sec', 'grp', 'sub'];
    const goTo = (depth, child) => {
      const change = { all: undefined, groupId: undefined, page: undefined };
      for (let i = depth; i < keys.length; i++) change[keys[i]] = i === depth ? child : undefined;
      chooseSection = !depth && !child;
      patch(change);
    };
    if (!deepGroup(P) && hasCriteria) {
      const roots = all.filter((g) => !g.parentId);
      if (roots.length) nav.append(section({ title: 'Разделы продукции', open: chooseSection, body: [tileGrid(...roots.map((g) => catTile(g, id => goTo(0, id))))] }));
      return;
    }
    const trail = h('div', { class: 'crumbs' }, kitButton({ label: 'Разделы продукции', kind: 'ghost', size: 'S', onClick: () => goTo(0) }));
    const chosen = keys.filter((key) => P[key]);
    for (const key of chosen) {
      const label = all.find((g) => g.id === P[key])?.name || ({ sec: 'Раздел', grp: 'Группа', sub: 'Подгруппа' }[key]);
      const last = key === chosen.at(-1);
      trail.append(h('span', { 'aria-hidden': 'true' }, '›'), last ? h('span', { 'aria-current': 'page' }, label)
        : kitButton({ label, kind: 'ghost', size: 'S', onClick: () => goTo(keys.indexOf(key) + 1) }));
    }
    if (!chosen.length) trail.append(h('span', { 'aria-hidden': 'true' }, '›'), h('span', { 'aria-current': 'page' }, 'Все изделия'));
    nav.append(trail);
    const parent = deepGroup(P);
    const depth = keys.indexOf(chosen.at(-1)) + 1;
    const children = parent && depth < keys.length ? all.filter((g) => g.parentId === parent) : [];
    if (children.length) nav.append(tileGrid(...children.map((g) => catTile(g, (id) => goTo(depth, id)))));
  };
  return nav;
}

const showAll = () => kitButton({ label: 'Все изделия', onClick: () => patch({ all: '1' }) });

export async function catLanding({ pick }) {
  const all = await groupsFresh();
  if (!all?.length) return h('div', { class: 'state' }, h('div', null, 'Разделов пока нет — изделия покажутся списком.'), showAll());
  const tops = all.filter((g) => !g.parentId);
  const kids = (t) => all.filter((g) => g.parentId === t.id);
  const total = tops.reduce((a, t) => a + (t.count || 0), 0);
  const secTiles = []; // { id, tile } — открыт один раздел, запоминаем в sessionStorage
  const secItem = (t) => {
    const ks = kids(t);
    const base = { size: 'S', artCover: true, art: art(t.name), title: t.name, meta: nItems(t.count || 0) };
    if (!ks.length) return card({ ...base, onClick: () => pick(t.id) });
    const el = card({ ...base,
      onToggle: (open) => { secSave(open ? t.id : (secOpen() === t.id ? '' : secOpen())); },
      expand: { title: 'Группы раздела «' + t.name + '»', action: kitButton({ label: 'Весь раздел →', kind: 'ghost', size: 'S', onClick: () => pick(t.id) }), // «Все изделия списком» — один раз, сверху (аудит Д12)
        body: tileGrid(...ks.map((g) => catTile(g, pick))) } });
    secTiles.push({ id: t.id, tile: el.firstElementChild });
    return el;
  };
  const main = tops.slice(0, 3); const rest = tops.slice(3);
  const node = landing({ head: `Выберите раздел · всего ${nItems(total)}`, action: showAll(),
    body: [tileGrid(...main.map(secItem)), rest.length ? h('section', null, h('h3', null, 'Другие разделы'), tileGrid(...rest.map(secItem))) : null] });
  const was = secOpen(); secTiles.find((it) => it.id === was)?.tile.click();
  return node;
}
