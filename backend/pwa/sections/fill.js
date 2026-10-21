import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { qty } from '../core/format.js';
import { go, patch } from '../core/router.js';

/**
 * «Требуют заполнения» по категориям (TASKS ТЗ.3–ТЗ.4). Данные — `/api/fill-audit`: группа = что не заполнено,
 * зачем это нужно и какое поле. Клик по строке — карточка справа сразу в правке с подсвеченным полем
 * (of=<раздел>&open=<id>&fill=<поле>, см. ui/card.js markFill). Заполнили и сохранили — строка уходит из списка.
 * Адрес страницы: #fill (все группы) или #fill?g=<ключ> (одна раскрыта).
 */
const openRow = (g, x) => patch({ of: g.section, open: x.id, fill: g.field, new: undefined });

function groupBlock(g, open, onToggle) {
  const head = h('button', { type: 'button', class: 'fill-head', 'aria-expanded': String(open), onclick: onToggle },
    h('span', { class: 'fill-chev', 'aria-hidden': 'true' }, open ? '▾' : '▸'),
    h('span', { class: 'fill-t' }, h('b', null, g.title), h('span', { class: 'muted' }, g.why)),
    h('span', { class: 'q-n' }, qty(g.count)));
  const body = open ? h('ul', { class: 'q-list' }, ...g.items.map((x) => h('li', { class: 'q-row', tabindex: '0', onclick: () => openRow(g, x), onkeydown: (e) => { if (e.key === 'Enter') openRow(g, x); } },
    h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, x.title), x.sub ? h('div', { class: 'q-sub' }, x.sub) : null),
    h('div', { class: 'q-side' }, h('span', { class: 'btn btn-sm row-act' }, 'Заполнить')))),
  g.count > g.items.length ? h('li', { class: 'q-empty' }, `Показаны первые ${g.items.length} из ${qty(g.count)}. Заполните эти — список обновится.`) : null) : null;
  return h('section', { class: 'panel fill-group' + (open ? ' open' : '') }, head, body);
}

export function mountFill(params) {
  let data = null;
  let openKey = params.g || '';
  const box = h('div', { class: 'fill-list' }, h('div', { class: 'panel state' }, 'Проверяю, что не заполнено…'));
  const el = h('div', { class: 'fill-page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Требуют заполнения'),
      h('div', { class: 'sub' }, 'Без этих данных неточно считаются деньги и аналитика. Откройте группу → «Заполнить» — карточка откроется сразу на нужном поле.'))),
    box);
  function render() {
    if (!data.groups.length) { box.replaceChildren(h('div', { class: 'panel state' }, 'Всё заполнено — аналитика и деньги считаются полностью 👍')); return; }
    const areas = [...new Set(data.groups.map((g) => g.area))];
    box.replaceChildren(...areas.flatMap((a) => [h('h3', { class: 'fill-area' }, a),
      ...data.groups.filter((g) => g.area === a).map((g) => groupBlock(g, openKey === g.key, () => { openKey = openKey === g.key ? '' : g.key; patch({ g: openKey || undefined }); render(); }))]));
  }
  async function reload() {
    try { data = await api('/fill-audit', { query: { limit: 50 } }); render(); }
    catch (e) { box.replaceChildren(h('div', { class: 'panel state' }, 'Не загрузилось: ' + e.message)); }
  }
  reload();
  return { el, reload, update: (p) => { if ((p.g || '') !== openKey) { openKey = p.g || ''; if (data) render(); } } };
}

/** Блок для «Сегодня»: самые большие группы с числами — «чем заняться сегодня»; клик — к заполнению. */
export function fillToday() {
  const list = h('ul', { class: 'q-list' }, h('li', { class: 'q-empty' }, h('span', { class: 'skel', style: { width: '50%' } })));
  const n = h('span', { class: 'q-n', hidden: true });
  const el = h('section', { class: 'panel queue', id: 'q-fill' },
    h('header', { class: 'q-head' }, h('div', null, h('h3', null, 'Требуют заполнения ', n), h('div', { class: 'q-hint' }, 'Чем заняться: дозаполнить — и деньги с аналитикой посчитаются верно')),
      h('a', { href: '#fill', class: 'q-link' }, 'Все →')), list);
  const load = () => api('/fill-audit', { query: { limit: 1 } }).then((r) => {
    n.hidden = !r.total; n.textContent = qty(r.total);
    if (!r.groups.length) { list.replaceChildren(h('li', { class: 'q-empty' }, 'Всё заполнено 👍')); return; }
    const top = [...r.groups].sort((a, b) => b.count - a.count).slice(0, 5);
    list.replaceChildren(...top.map((g) => h('li', { class: 'q-row', tabindex: '0', onclick: () => go('fill', { g: g.key }) },
      h('div', { class: 'q-main' }, h('div', { class: 'q-title' }, g.title), h('div', { class: 'q-sub' }, [g.area, g.why].join(' · '))),
      h('div', { class: 'q-side' }, h('span', { class: 'num' }, qty(g.count))))),
    r.groups.length > top.length ? h('li', { class: 'q-empty' }, `ещё групп: ${r.groups.length - top.length} — «Все →»`) : '');
  }).catch((e) => list.replaceChildren(h('li', { class: 'q-empty' }, 'Не загрузилось: ' + e.message)));
  return { el, load };
}
