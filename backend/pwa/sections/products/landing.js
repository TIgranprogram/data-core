import { h } from '../../core/dom.js';
import { plural, qty } from '../../core/format.js';
import { patch } from '../../core/router.js';
import { stepFunnel, button as kitButton, card, tileGrid, landing } from '../../ui/kit/index.js';
import { catArt } from '../../ui/cat-art.js';
import { groupsTree, groupsFresh, facets } from './data.js';

// Первая страница «Продукции»: разделы и их группы плитками с рисунком; клик — тот же фильтр, что дерево слева.
// Раздел без групп — плиткой в «Другие разделы». «Все изделия списком» (?all=1) — прежняя галерея.
export const nItems = (n) => `${qty(n)} ${plural(n, 'изделие', 'изделия', 'изделий')}`;
/** ПРД.6: самый глубокий выбранный шаг воронки (раздел → группа → подгруппа) — это groupId для сервера (он берёт всё поддерево). */
export const deepGroup = (P) => P.sub || P.grp || P.sec || '';

const art = (name) => { const el = h('span'); el.innerHTML = catArt(name); return el; }; // свой статичный SVG, данных пользователя нет
const catTile = (g, pick) => card({ size: 'S', artCover: true, art: art(g.name), title: g.name, meta: nItems(g.count || 0), onClick: () => pick(g.id) });
const SEC_KEY = 'dc-prod-sec'; // раскрытый раздел — «назад» из галереи видит то же
const secOpen = () => { try { return sessionStorage.getItem(SEC_KEY) || ''; } catch { return ''; } };
const secSave = (id) => { try { if (id) sessionStorage.setItem(SEC_KEY, id); else sessionStorage.removeItem(SEC_KEY); } catch { /* приватный режим */ } };

/** ПРД.6: воронка «Раздел → Группа → Подгруппа → Серия», у значений — число изделий. Числа групп — /showcase/groups, серий — facets. */
export function prodFunnel() {
  const kids = (all, pid) => all.filter((g) => (pid ? g.parentId === pid : !g.parentId)).map((g) => ({ value: g.id, label: g.name, n: g.count }));
  const f = stepFunnel({
    title: 'Раздел → группа → серия',
    steps: [{ key: 'sec', label: 'Раздел', always: true, icon: (o) => { const i = h('span', { class: 'ff-ico', 'aria-hidden': 'true' }); i.innerHTML = catArt(o.label); return i; } }, { key: 'grp', label: 'Группа', when: (P) => P.sec }, { key: 'sub', label: 'Подгруппа', when: (P) => P.grp }, { key: 'series', label: 'Серия' }],
    load: async (P) => {
      const all = await groupsTree();
      const r = await facets({ ...(deepGroup(P) ? { groupId: deepGroup(P) } : {}), ...(P.status ? { status: P.status } : {}), ...(P.q ? { search: P.q } : {}) });
      return { sec: kids(all, null), grp: P.sec ? kids(all, P.sec) : [], sub: P.grp ? kids(all, P.grp) : [], series: r.facets?.series || [] };
    },
  });
  return { el: f.el, update: async (P) => {
    // старая ссылка #products?groupId=… или выбор с плиток раздела: раскладываем путь по шагам
    if (P.groupId && !deepGroup(P)) {
      const all = await groupsTree(); const path = []; let cur = all.find((g) => g.id === P.groupId);
      while (cur && path.length < 3) { path.unshift(cur.id); cur = all.find((g) => g.id === cur.parentId); }
      patch({ groupId: undefined, sec: path[0], grp: path[1], sub: path[2], page: undefined });
      return;
    }
    f.update(P);
  } };
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
