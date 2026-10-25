import { stockList } from '../core/stock-list.js';
import { h } from '../core/dom.js';
import { busyBlock } from './busy.js';
import { patch } from '../core/router.js';
import { facetValues, FACETS, index, pick } from '../core/facets.js';
import { searchBox } from './searchbox.js';
import { makeResizable } from './resizer.js';

/**
 * «Фильтры» по признакам из названий (тип / резьба / длина / стандарт) — как в «Операциях», для списка «Остатки».
 * Как в магазине (SK-1): крупная кнопка «Поиск и фильтры» → панель слева (на телефоне выезжает слева с затемнением):
 * строка поиска + группы признаков, значения — радио-кружками (выбор в группе один); группы длиннее 6 значений свёрнуты, короткие раскрыты.
 * Панель поверх содержимого (таблица не сдвигается); выбранное — метками с «×» рядом с кнопкой. Состояние — в адресе: ?ft=type:Болт мебельный|thread:M8.
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
/** Металл (СМ.1): марка, сечение, толщина — отдельными параметрами списка (сервер фильтрует по полям позиции). */
export function ftParams(s) {
  const sel = parseFt(s);
  return { ...(sel.grade ? { grade: sel.grade } : {}), ...(sel.section ? { section: sel.section } : {}), ...(sel.thick ? { thickness: sel.thick } : {}) };
}

const OPEN_MAX = 6; // группа до 6 значений раскрыта, длиннее — свёрнута

export function facetFilter({ categoryKey = 'categoryId', inline = false } = {}) {
  let items = null; let src = null; let P = {};
  const folded = new Map(); // key → открыто/свёрнуто, если пользователь сам нажал (иначе — по числу значений)
  if (inline) return inlineFilter(categoryKey);
  const btn = h('button', { type: 'button', class: 'btn ff-btn', 'aria-expanded': 'false' }, h('span', { class: 'ff-ico', 'aria-hidden': 'true' }, '⌕'), ' Поиск и фильтры');
  const tags = h('span', { class: 'ff-tags' });
  const sb = searchBox({ value: '', placeholder: 'Название, размер, стандарт…', className: 'ff-search', onSearch: (q) => patch({ q: q || undefined, page: undefined }) });
  const body = h('div', { class: 'ff-body' });
  const pop = h('aside', { class: 'ff-pop', hidden: true, role: 'dialog', 'aria-label': 'Поиск и фильтры' },
    h('div', { class: 'ff-head', tabindex: '-1' }, h('b', {}, 'Поиск и фильтры'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Закрыть', onclick: () => close() }, '×')),
    h('div', { class: 'ff-find' }, sb.el), body,
    h('div', { class: 'ff-foot' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => patch({ ft: undefined, page: undefined }) }, 'Сбросить признаки'), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => close() }, 'Готово')));
  makeResizable(pop, { prefKey: 'filterW', edge: 'right', label: 'Ширина панели фильтров' }); // ШП
  const shade = h('div', { class: 'ff-shade', hidden: true, onclick: () => close() });
  const el = h('div', { class: 'ff' }, btn, tags, shade, pop);
  const load = async () => { const list = await stockList(); if (list !== src) { src = list; items = index(list); } return items; };
  const onKey = (e) => { if (e.key === 'Escape' && !pop.hidden) close(); }; // с непустым поиском Esc сначала очищает его (searchBox гасит событие)
  let watch = null; // следит: открылась правая панель или экран ушёл — фильтр закрываем, слушатель снимаем
  const watchStart = () => {
    watch = new MutationObserver(() => { if (!el.isConnected || document.querySelector('.drawer')) close(el.isConnected); });
    watch.observe(document.body, { childList: true, subtree: true });
  };
  function close(refocus = true) { watch?.disconnect(); watch = null; pop.hidden = true; shade.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('keydown', onKey); if (refocus) btn.focus(); }
  const set = (k, v) => { const sel = parseFt(P.ft); sel[k] = sel[k] === v ? undefined : v; patch({ ft: fmtFt(sel), page: undefined }); };
  async function renderPop() {
    if (!body.children.length) body.replaceChildren(busyBlock('', { cls: 'muted small' }));
    await load();
    const keep = body.scrollTop;
    const fk = document.activeElement?.dataset?.fk; // фокус не теряем при перерисовке
    const sel = parseFt(P.ft);
    const groups = FACETS.map(([key, label]) => {
      const others = { ...sel }; delete others[key];
      const vals = facetValues(pick(items, { cat: P[categoryKey] || '', sel: others }), key).slice(0, key === 'type' ? 30 : 40);
      if (!vals.length) return null;
      const open = folded.has(key) ? folded.get(key) : (vals.length <= OPEN_MAX || !!sel[key]);
      const colCls = vals.length > 8 ? ' ff-cols' : '';
      return h('div', { class: 'ff-group' + (open ? ' open' : '') },
        h('button', { type: 'button', class: 'ff-gh', 'data-fk': 'g:' + key, 'aria-expanded': String(open), onclick: () => { folded.set(key, !open); renderPop(); } },
          h('span', { class: 'ff-gl' }, label), sel[key] ? h('span', { class: 'ff-gsel' }, sel[key]) : null, h('span', { class: 'ff-chev', 'aria-hidden': 'true' }, '▾')),
        open ? h('div', { class: 'ff-checks' + colCls, role: 'radiogroup', 'aria-label': label }, ...vals.map(([v]) => h('label', { class: 'ff-check' },
          h('input', { type: 'radio', name: 'ff-' + key, 'data-fk': 'v:' + key + ':' + v, checked: sel[key] === v, onclick: (e) => { e.preventDefault(); set(key, v); } }), h('span', {}, v)))) : null);
    }).filter(Boolean);
    body.replaceChildren(...(groups.length ? groups : [h('div', { class: 'muted' }, 'В этой категории признаков нет')]));
    body.scrollTop = keep;
    if (fk) [...body.querySelectorAll('[data-fk]')].find((n) => n.dataset.fk === fk)?.focus({ preventScroll: true });
  }
  btn.addEventListener('click', () => {
    if (!pop.hidden) { close(); return; }
    pop.hidden = false; shade.hidden = false; btn.setAttribute('aria-expanded', 'true'); sb.set(P.q || '', true); renderPop();
    document.addEventListener('keydown', onKey); watchStart();
    if (matchMedia('(max-width: 720px), (pointer: coarse)').matches) pop.firstElementChild.focus(); else sb.focus(); // на телефоне клавиатура закрыла бы фильтры
  });
  function update(next) {
    P = { ...next };
    const sel = parseFt(P.ft);
    const names = Object.fromEntries(FACETS);
    tags.replaceChildren(...Object.entries(sel).filter(([, v]) => v).map(([k, v]) => h('button', { type: 'button', class: 'tag active ff-tag', title: 'Убрать: ' + names[k], onclick: () => set(k, v) }, v, ' ×')));
    btn.classList.toggle('on', Object.values(sel).some(Boolean));
    sb.set(P.q || '');
    if (!pop.hidden) renderPop();
  }
  return { el, update, reset: () => items && (items = null) };
}

/**
 * Режим inline (NAV F2): те же группы признаков, но тело рисуется прямо в левой панели списка (L.sidebar):
 * без кнопки, всплывающей панели и затемнения; поиск и «Сбросить всё» — у самой панели. Выбор в группе один, повторный клик снимает.
 */
function inlineFilter(categoryKey) {
  let items = null; let src = null; let P = {}; let seq = 0;
  const folded = new Map();
  const crumbs = h('div', { class: 'ff-crumbs', hidden: true });
  const body = h('div', { class: 'ff-body' });
  const el = h('div', { class: 'ff ff-inline' }, crumbs, body);
  const load = async () => { const list = await stockList(); if (list !== src) { src = list; items = index(list); } return items; };
  const set = (k, v) => { const sel = parseFt(P.ft); sel[k] = sel[k] === v ? undefined : v; patch({ ft: fmtFt(sel), page: undefined }); };
  async function render() {
    const my = ++seq;
    if (!body.children.length) body.replaceChildren(busyBlock('', { cls: 'muted small' }));
    await load();
    if (my !== seq) return;
    const fk = document.activeElement?.dataset?.fk; // фокус не теряем при перерисовке
    const sel = parseFt(P.ft);
    // ТИ-6: крошки выбранных признаков (точечный сброс)
    const names = Object.fromEntries(FACETS);
    const selEntries = Object.entries(sel).filter(([, v]) => v);
    crumbs.hidden = !selEntries.length;
    crumbs.replaceChildren(...selEntries.map(([k, v]) =>
      h('button', { type: 'button', class: 'tag active ff-tag', title: 'Убрать: ' + names[k], onclick: () => set(k, v) }, v, ' ×')));
    const groups = FACETS.map(([key, label]) => {
      const others = { ...sel }; delete others[key];
      const vals = facetValues(pick(items, { cat: P[categoryKey] || '', sel: others }), key).slice(0, key === 'type' ? 30 : 40);
      if (!vals.length) return null;
      const open = folded.has(key) ? folded.get(key) : (vals.length <= OPEN_MAX || !!sel[key]);
      const colCls = vals.length > 8 ? ' ff-cols' : '';
      return h('div', { class: 'ff-group' + (open ? ' open' : '') },
        h('button', { type: 'button', class: 'ff-gh', 'data-fk': 'g:' + key, 'aria-expanded': String(open), onclick: () => { folded.set(key, !open); render(); } },
          h('span', { class: 'ff-gl' }, label), sel[key] ? h('span', { class: 'ff-gsel' }, sel[key]) : null, h('span', { class: 'ff-chev', 'aria-hidden': 'true' }, '▾')),
        open ? h('div', { class: 'ff-checks' + colCls, role: 'radiogroup', 'aria-label': label }, ...vals.map(([v]) => h('label', { class: 'ff-check' },
          h('input', { type: 'radio', name: 'ff-' + key, 'data-fk': 'v:' + key + ':' + v, checked: sel[key] === v, onclick: (e) => { e.preventDefault(); set(key, v); } }), h('span', {}, v)))) : null);
    }).filter(Boolean);
    body.replaceChildren(...(groups.length ? groups : [h('div', { class: 'muted small' }, 'В этой категории признаков нет')]));
    if (fk) [...body.querySelectorAll('[data-fk]')].find((n) => n.dataset.fk === fk)?.focus({ preventScroll: true });
  }
  return { el, update: (next) => { P = { ...next }; render(); }, reset: () => items && (items = null) };
}
