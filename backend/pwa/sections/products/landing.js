import { h } from '../../core/dom.js';
import { plural, qty } from '../../core/format.js';
import { patch } from '../../core/router.js';
import { stepFunnel, button as kitButton } from '../../ui/kit/index.js';
import { catArt } from '../../ui/cat-art.js';
import { groupsTree, groupsFresh, facets } from './data.js';

// Первая страница «Продукции»: разделы и их группы плитками с рисунком; клик — тот же фильтр, что дерево слева.
// Раздел без групп — плиткой в «Другие разделы». «Все изделия списком» (?all=1) — прежняя галерея.
export const nItems = (n) => `${qty(n)} ${plural(n, 'изделие', 'изделия', 'изделий')}`;
/** ПРД.6: самый глубокий выбранный шаг воронки (раздел → группа → подгруппа) — это groupId для сервера (он берёт всё поддерево). */
export const deepGroup = (P) => P.sub || P.grp || P.sec || '';

const catTile = (g, pick) => {
  const art = h('div', { class: 'cat-art' });
  art.innerHTML = catArt(g.name); // свой статичный SVG, данных пользователя нет
  return h('button', { type: 'button', class: 'cat-tile', title: g.name, onclick: () => pick(g.id) }, art,
    h('div', { class: 'cat-body' }, h('div', { class: 'cat-name' }, g.name), h('div', { class: 'cat-n' }, nItems(g.count || 0))));
};
const SEC_KEY = 'dc-prod-sec'; // раскрытый раздел — «назад» из галереи видит то же
const secOpen = () => { try { return sessionStorage.getItem(SEC_KEY) || ''; } catch { return ''; } };
const secSave = (id) => { try { if (id) sessionStorage.setItem(SEC_KEY, id); else sessionStorage.removeItem(SEC_KEY); } catch { /* приватный режим */ } };

/** ПРД.6: воронка «Раздел → Группа → Подгруппа → Серия», у значений — число изделий. Числа групп — /showcase/groups, серий — facets. */
export function prodFunnel() {
  const kids = (all, pid) => all.filter((g) => (pid ? g.parentId === pid : !g.parentId)).map((g) => ({ value: g.id, label: g.name, n: g.count }));
  const f = stepFunnel({
    title: 'Раздел → серия',
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
  const items = []; // { id, tile, panel } — панель раскрывается переключением класса, запрос не повторяется
  const setOpen = (id) => {
    secSave(id);
    for (const it of items) {
      const on = it.id === id;
      it.tile.classList.toggle('active', on); it.tile.setAttribute('aria-expanded', String(on));
      it.panel.classList.toggle('open', on); if (on) it.panel.removeAttribute('inert'); else it.panel.setAttribute('inert', '');
    }
  };
  const secItem = (t) => {
    const ks = kids(t);
    const art = h('div', { class: 'sec-art' });
    art.innerHTML = catArt(t.name); // свой статичный SVG, данных пользователя нет
    const pid = 'sec-p-' + t.id;
    const body = h('span', { class: 'sec-body' }, h('span', { class: 'sec-name' }, t.name), h('span', { class: 'sec-n' }, nItems(t.count || 0)));
    const tile = h('button', { type: 'button', class: 'sec-tile sec-products', title: t.name, 'aria-expanded': 'false', 'aria-controls': ks.length ? pid : undefined,
      onclick: () => (ks.length ? setOpen(secOpen() === t.id ? '' : t.id) : pick(t.id)) }, art, body, ks.length ? h('span', { class: 'sec-chev', 'aria-hidden': 'true' }, '▾') : null);
    const panel = h('div', { class: 'sec-panel', id: pid, inert: '' }, h('div', { class: 'sec-panel-in' },
      h('div', { class: 'sec-panel-head' }, h('h3', null, 'Группы раздела «' + t.name + '»'),
        kitButton({ label: 'Весь раздел →', kind: 'ghost', onClick: () => pick(t.id) })), // «Все изделия списком» — один раз, сверху (аудит Д12)
      h('div', { class: 'cat-grid' }, ...ks.map((g) => catTile(g, pick)))));
    items.push({ id: t.id, tile, panel });
    return h('div', { class: 'sec-item' }, tile, ks.length ? panel : null);
  };
  const main = tops.slice(0, 3); const rest = tops.slice(3);
  const node = h('div', { class: 'cat-landing' },
    h('div', { class: 'cat-top' }, h('p', { class: 'muted' }, `Выберите раздел · всего ${nItems(total)}`), showAll()),
    h('div', { class: 'sec-grid' }, ...main.map(secItem)),
    rest.length ? h('section', { class: 'cat-sec' }, h('div', { class: 'cat-sec-head' }, h('h3', null, 'Другие разделы')), h('div', { class: 'sec-grid' }, ...rest.map(secItem))) : null);
  const was = secOpen(); setOpen(items.some((it) => it.id === was) ? was : '');
  return node;
}
