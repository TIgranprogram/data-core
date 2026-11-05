import { h } from '../../core/dom.js';
import { qty } from '../../core/format.js';
import { patch } from '../../core/router.js';

/** Кнопка варианта в левой панели списка (.ls-opt): название, подпись, счётчик. */
export const optBtn = (label, n, active, onclick, cls = '', sub = '') => h('button', { type: 'button', class: 'ls-opt' + (active ? ' active' : '') + (cls ? ' ' + cls : ''), onclick },
  h('span', { class: 'ls-t', title: label }, label), sub ? h('span', { class: 'ls-sub' }, sub) : null, n !== undefined && n !== null ? h('b', null, qty(n)) : null);

/** Плитки (категории склада): в левой панели — список с группами-аккордеонами, иначе — плитки над списком. */
export function paintTiles({ L, P, tiles, tilesBox, tileTagBox, side }) {
  if (!tilesBox) return;
  const cur = P[L.tiles.key] || '';
  // при поиске счётчики групп устарели — скрываем чтобы не вводить в заблуждение
  const showN = (n) => (P.q ? undefined : n);
  if (side) {
    // ТИ-7: группы по заголовкам (head:true) — свёрнуты по умолчанию, кроме активной
    const groups = [];
    let grp = null;
    for (const x of tiles) {
      if (x.head) { grp = { tile: x, subs: [] }; groups.push(grp); }
      else if (grp) grp.subs.push(x);
      else { if (!groups.length || groups[0].tile !== null) groups.unshift({ tile: null, subs: [] }); groups[0].subs.push(x); }
    }
    const nodes = groups.flatMap(({ tile, subs }) => {
      if (!tile) return subs.map((x) => optBtn(x.label, showN(x.n), String(x.value) === cur,
        () => patch({ [L.tiles.key]: String(x.value) === cur ? undefined : x.value, page: undefined }),
        x.sub && typeof x.sub === 'string' ? 'sub' : '', typeof x.sub === 'string' ? x.sub : ''));
      const hasActive = String(tile.value) === cur || subs.some((x) => String(x.value) === cur);
      // Раздел без подгрупп — работает как фильтр напрямую, а не как аккордеон; head-leaf — нет стрелки
      if (!subs.length) {
        return [optBtn(tile.label, showN(tile.n), String(tile.value) === cur,
          () => patch({ [L.tiles.key]: String(tile.value) === cur ? undefined : tile.value, page: undefined }),
          'head head-leaf', '')];
      }
      const subsEl = h('div', { class: 'ls-subs', hidden: !hasActive },
        ...subs.map((x) => optBtn(x.label, showN(x.n), String(x.value) === cur,
          () => patch({ [L.tiles.key]: String(x.value) === cur ? undefined : x.value, page: undefined }),
          'sub', typeof x.sub === 'string' ? x.sub : '')));
      const headBtn = optBtn(tile.label, showN(tile.n), hasActive,
        // ПРД.5: клик по разделу — раскрыть и сразу показать весь раздел (с подгруппами); повторный по выбранному — снять
        () => { const on = String(tile.value) === cur; subsEl.hidden = on; headBtn.classList.toggle('open', !on); patch({ [L.tiles.key]: on ? undefined : tile.value, page: undefined }); },
        'head' + (hasActive ? ' open' : ''), '');
      return [headBtn, subsEl];
    });
    tilesBox.replaceChildren(...nodes);
    // ТИ-6: крошка выбранной категории (точечный сброс — тот же клик по активной плитке)
    if (tileTagBox) {
      const active = tiles.find((x) => String(x.value) === cur);
      if (active) {
        tileTagBox.replaceChildren(h('button', { type: 'button', class: 'tag active ff-tag', title: 'Сбросить выбор', onclick: () => patch({ [L.tiles.key]: undefined, page: undefined }) }, active.label, ' ×'));
        tileTagBox.hidden = false;
      } else { tileTagBox.replaceChildren(); tileTagBox.hidden = true; }
    }
    return;
  }
  tilesBox.replaceChildren(...tiles.map((x) => h('button', {
    type: 'button', class: 'tile' + (String(x.value) === cur ? ' active' : ''),
    onclick: () => patch({ [L.tiles.key]: String(x.value) === cur ? undefined : x.value, page: undefined }),
  }, h('b', { title: x.label }, x.label), showN(x.n) !== undefined ? h('span', { class: 'tl-n' }, qty(showN(x.n))) : null, x.sub ? h('span', { class: 'tl-sub' }, x.sub) : null)));
}
