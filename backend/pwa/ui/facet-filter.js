import { api } from '../core/api.js';
import { h } from '../core/dom.js';
import { patch } from '../core/router.js';
import { facetValues, FACETS, index, pick } from '../core/facets.js';

/**
 * «Фильтры» по признакам из названий (тип / резьба / длина / стандарт) — как в «Операциях», для списка «Остатки».
 * Кнопка в панели инструментов открывает выпадающую панель ПОВЕРХ таблицы (таблица не сдвигается, ничего не дёргается);
 * выбранное — метками с «×» рядом с кнопкой. Состояние — в адресе: ?ft=type:Болт мебельный|thread:M8.
 * В запрос списка выбранное уходит словами поиска (сервер ищет все слова — search-norm).
 *   const ff = facetFilter({ categoryKey: 'categoryId' });  ff.el, ff.update(P), ff.query(P) → строка для search
 */
export const parseFt = (s) => Object.fromEntries(String(s || '').split('|').filter(Boolean).map((x) => { const i = x.indexOf(':'); return [x.slice(0, i), x.slice(i + 1)]; }));
const fmtFt = (sel) => Object.entries(sel).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join('|') || undefined;
/** Слова поиска из выбранного: длина — «х40» (как в «M8х40»), чтобы не цеплять любые «40». */
export function ftQuery(s) {
  const sel = parseFt(s);
  return [sel.type, sel.thread, sel.length ? 'х' + sel.length : '', sel.std].filter(Boolean).join(' ');
}

export function facetFilter({ categoryKey = 'categoryId' } = {}) {
  let items = null; let P = {};
  const btn = h('button', { type: 'button', class: 'btn ff-btn', 'aria-expanded': 'false' }, 'Тип, резьба, размер ▾');
  const tags = h('span', { class: 'ff-tags' });
  const pop = h('div', { class: 'ff-pop', hidden: true, role: 'dialog', 'aria-label': 'Фильтры по признакам' });
  const el = h('div', { class: 'ff' }, btn, tags, pop);
  const load = async () => { items ??= index((await api('/stock/items', { query: { limit: 10000 } })).items); return items; };
  const close = () => { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', outside, true); };
  const outside = (e) => { if (!el.contains(e.target)) close(); };
  const set = (k, v) => { const sel = parseFt(P.ft); sel[k] = sel[k] === v ? undefined : v; patch({ ft: fmtFt(sel), page: undefined }); };
  async function renderPop() {
    pop.replaceChildren(h('div', { class: 'muted small' }, 'Загрузка…'));
    await load();
    const sel = parseFt(P.ft);
    const groups = FACETS.map(([key, label]) => {
      const others = { ...sel }; delete others[key];
      const vals = facetValues(pick(items, { cat: P[categoryKey] || '', sel: others }), key);
      if (!vals.length) return null;
      return h('div', { class: 'ops-facet' }, h('span', { class: 'ops-facet-l' }, label),
        h('div', { class: 'ops-facet-v ff-vals' }, ...vals.slice(0, key === 'type' ? 30 : 40).map(([v, n]) => h('button', { type: 'button', class: 'tag' + (sel[key] === v ? ' active' : ''), onclick: () => set(key, v) }, v, h('small', null, n)))));
    }).filter(Boolean);
    pop.replaceChildren(...(groups.length ? groups : [h('div', { class: 'muted' }, 'В этой категории признаков нет')]),
      h('div', { class: 'ff-foot' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => patch({ ft: undefined, page: undefined }) }, 'Сбросить признаки'), h('button', { type: 'button', class: 'btn btn-sm', onclick: close }, 'Готово')));
  }
  btn.addEventListener('click', () => {
    if (!pop.hidden) { close(); return; }
    pop.hidden = false; btn.setAttribute('aria-expanded', 'true'); renderPop();
    document.addEventListener('mousedown', outside, true);
  });
  function update(next) {
    P = { ...next };
    const sel = parseFt(P.ft);
    const names = Object.fromEntries(FACETS);
    tags.replaceChildren(...Object.entries(sel).filter(([, v]) => v).map(([k, v]) => h('button', { type: 'button', class: 'tag active ff-tag', title: 'Убрать: ' + names[k], onclick: () => set(k, v) }, v, ' ×')));
    btn.classList.toggle('on', Object.values(sel).some(Boolean));
    if (!pop.hidden) renderPop();
  }
  return { el, update, reset: () => items && (items = null) };
}
