import { stockList } from '../../core/stock-list.js';
import { h } from '../../core/dom.js';
import { patch } from '../../core/router.js';
import { facetValues, FACETS, index, pick, facetLabel, PIPE_KINDS, pipeParts } from '../../core/facets.js';
import { mark } from './mark.js';
import { busyBlock } from './busy.js';
import { zoneCats } from '../../core/zone.js';
import { searchBox } from './searchbox.js';
import { makeResizable } from '../resizer.js';
import { button } from './index.js';

/**
 * kit.filter({ mode }) — эталон фильтра (DESIGN-KIT K-2.1):
 *   'chips'  — фишки .chips/.chip: { items:[{key,label,count?}], value, multi?, onChange(key|[keys]), label? } → { el, set(v), value }
 *   'facets' — признаки склада (поиск + группы радио): { categoryKey, inline } → { el, update(P), reset() }
 *   'funnel' — воронка по шагам адреса: { steps, load, title } → { el, update(P) }
 */
export function filter({ mode = 'chips', ...opts } = {}) {
  if (mode === 'facets') return facetFilter(opts);
  if (mode === 'funnel') return stepFunnel(opts);
  return chipsFilter(opts);
}

export function chipsFilter({ items, value, multi = false, onChange, label, cls } = {}) {
  const cur = new Set(multi ? [].concat(value ?? []).map(String) : (value ?? items[0]?.key) != null ? [String(value ?? items[0]?.key)] : []);
  const el = mark(h('div', { class: 'chips' + (cls ? ' ' + cls : ''), role: multi ? 'group' : 'tablist', 'aria-label': label || null }), 'filter');
  const paint = () => el.querySelectorAll('.chip').forEach((c) => { const on = cur.has(c.dataset.key); c.classList.toggle('active', on); c.setAttribute(multi ? 'aria-pressed' : 'aria-selected', String(on)); });
  el.append(...items.map((it) => h('button', { type: 'button', role: multi ? null : 'tab', class: 'chip', dataset: { key: String(it.key) }, title: it.title || null, onclick: () => {
    const k = String(it.key);
    if (multi) { cur.has(k) ? cur.delete(k) : cur.add(k); } else { cur.clear(); cur.add(k); }
    paint(); onChange?.(multi ? [...cur] : it.key);
  } }, it.label, it.count != null ? h('b', null, String(it.count)) : null)));
  paint();
  return {
    el,
    set(v) { cur.clear(); for (const k of [].concat(v ?? [])) cur.add(String(k)); paint(); },
    get value() { return multi ? [...cur] : [...cur][0]; },
    clear() { cur.clear(); paint(); },
  };
}

export const parseFt = (s) => Object.fromEntries(String(s || '').split('|').filter(Boolean).map((x) => { const i = x.indexOf(':'); return [x.slice(0, i), x.slice(i + 1)]; }));
const fmtFt = (sel) => Object.entries(sel).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`).join('|') || undefined;
/** Слова поиска из выбранного: длина — «х40» (как в «M8х40»), чтобы не цеплять любые «40». */
export function ftQuery(s) {
  const sel = parseFt(s);
  return [sel.type, sel.thread, sel.length ? 'х' + sel.length : '', sel.std].filter(Boolean).join(' ');
}
/** Кнопка трубы: сечение + длина + чёрная или нержавеющая (сечения совпадают). */
const pipeParams = (v) => {
  if (!v) return {};
  const { kind, section, len } = pipeParts(v);
  return { section, ...(len ? { pipeLength: len } : {}), ...(kind === 'steel' ? { grade: 'Нержавеющая сталь' } : { noGrade: 1 }) };
};
/** Металл (СМ.1): марка, сечение, толщина — отдельными параметрами списка (сервер фильтрует по полям позиции). */
export function ftParams(s) {
  const sel = parseFt(s);
  return { ...(sel.grade ? { grade: sel.grade } : {}), ...(sel.section ? { section: sel.section } : {}), ...(sel.thick ? { thickness: sel.thick } : {}),
    ...(sel.wash ? { wash: sel.wash === 'Мытая' ? '1' : '0' } : {}), ...pipeParams(sel.pipe) };
}

/** Воронка признаков: только позиции, которые сейчас в списке — склад, строка поиска, вкладка состояния; дальше pick по категории и выбранным признакам. */
const inState = (it, st) => { if (!st) return true; const w = new Set(String(st).split(',')); return w.has(it.status) || (w.has('reserved') && it.reservedQty > 0) || (w.has('ordered') && it.ordered > 0); };
function scope(items, P, categoryKey, sel) {
  const zc = P[categoryKey] ? null : zoneCats();
  return pick(items.filter((it) => (!zc || zc.has(it.categoryId)) && inState(it, P.status)), { q: P.q || '', cat: P[categoryKey] || '', sel });
}

const OPEN_MAX = 6; // группа до 6 значений раскрыта, длиннее — свёрнута

export function facetFilter({ categoryKey = 'categoryId', inline = false } = {}) {
  let items = null; let src = null; let P = {};
  const folded = new Map(); // key → открыто/свёрнуто, если пользователь сам нажал (иначе — по числу значений)
  if (inline) return inlineFilter(categoryKey);
  const btn = button({ label: '⌕ Поиск и фильтры' });
  btn.setAttribute('aria-expanded', 'false');
  const tags = h('span', { class: 'ff-tags' });
  const sb = searchBox({ value: '', placeholder: 'Название, размер, стандарт…', className: 'ff-search', onSearch: (q) => patch({ q: q || undefined, page: undefined }) });
  const body = h('div', { class: 'ff-body' });
  const pop = h('aside', { class: 'ff-pop', hidden: true, role: 'dialog', 'aria-label': 'Поиск и фильтры' },
    h('div', { class: 'ff-head', tabindex: '-1' }, h('b', {}, 'Поиск и фильтры'), h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Закрыть', onclick: () => close() }, '×')),
    h('div', { class: 'ff-find' }, sb.el), body,
    h('div', { class: 'ff-foot' }, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => patch({ ft: undefined, page: undefined }) }, 'Сбросить признаки'), h('button', { type: 'button', class: 'btn btn-sm', onclick: () => close() }, 'Готово')));
  makeResizable(pop, { prefKey: 'filterW', edge: 'right', label: 'Ширина панели фильтров' }); // ШП
  const shade = h('div', { class: 'ff-shade', hidden: true, onclick: () => close() });
  const el = mark(h('div', { class: 'ff' }, btn, tags, shade, pop), 'filter');
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
      const vals = facetValues(scope(items, P, categoryKey, others), key).slice(0, key === 'type' ? 30 : 40);
      if (!vals.length) return null;
      const open = folded.has(key) ? folded.get(key) : (vals.length <= OPEN_MAX || !!sel[key]);
      const colCls = vals.length > 8 ? ' ff-cols' : '';
      return h('div', { class: 'ff-group' + (open ? ' open' : '') },
        h('button', { type: 'button', class: 'ff-gh', 'data-fk': 'g:' + key, 'aria-expanded': String(open), onclick: () => { folded.set(key, !open); renderPop(); } },
          h('span', { class: 'ff-gl' }, label), sel[key] ? h('span', { class: 'ff-gsel' }, sel[key]) : null, h('span', { class: 'ff-chev', 'aria-hidden': 'true' }, '▾')),
        open ? h('div', { class: 'ff-checks' + colCls, role: 'radiogroup', 'aria-label': label }, ...vals.map(([v]) => h('label', { class: 'ff-check' },
          h('input', { type: 'radio', name: 'ff-' + key, 'data-fk': 'v:' + key + ':' + v, checked: sel[key] === v, onclick: (e) => { e.preventDefault(); set(key, v); } }), h('span', {}, facetLabel(key, v))))) : null);
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
    btn.classList.toggle('btn-primary', Object.values(sel).some(Boolean));
    sb.set(P.q || '');
    if (!pop.hidden) renderPop();
  }
  return { el, update, reset: () => items && (items = null) };
}

/**
 * Режим inline (NAV F2) — воронка (СКФ.3): тело рисуется прямо в левой панели списка (L.sidebar).
 * Выбранные шаги сворачиваются в строки «Тип: Болт мебельный ×» сверху; ниже — только ещё не выбранные признаки,
 * первый из них раскрыт («следующий шаг»), остальные свёрнуты. У значений — число позиций; показываются лишь варианты,
 * у которых есть позиции при уже выбранном. Выбор в группе один, повторный клик снимает.
 */
/** Кнопки вместо списка: мойка и трубы по видам, цвет — группа. */
function chipsOf(key, vals, label, set) {
  const chip = ([v, n]) => {
    const text = facetLabel(key, v);
    const cut = key === 'pipe' ? text.lastIndexOf(' ') : -1;
    return h('label', { class: 'ff-check ff-chip' },
      h('input', { type: 'radio', name: 'ff-' + key, 'data-fk': 'v:' + key + ':' + v, onclick: (e) => { e.preventDefault(); set(key, v); } }),
      h('span', { class: 'ff-cv' }, cut > 0 ? [h('span', { class: 'ff-sec' }, text.slice(0, cut)), h('span', { class: 'ff-len' }, text.slice(cut + 1))] : text), h('b', { class: 'ff-cn' }, String(n)));
  };
  const grid = (list) => h('div', { class: 'ff-grid', role: 'radiogroup', 'aria-label': label }, ...list.map(chip));
  if (key === 'wash') return h('div', { class: 'ff-grid' }, ...vals.map((x) => h('div', { class: 'ff-grid1 ' + (x[0] === 'Мытая' ? 'k-washed' : 'k-raw') }, chip(x))));
  return h('div', null, ...PIPE_KINDS.flatMap(([kind, title]) => {
    const list = vals.filter(([v]) => pipeParts(v).kind === kind);
    return list.length ? [h('div', { class: 'k-' + kind }, h('div', { class: 'ff-sub' }, title), grid(list))] : [];
  }));
}

function inlineFilter(categoryKey) {
  let items = null; let src = null; let P = {}; let seq = 0;
  const folded = new Map();
  const crumbs = h('div', { class: 'ff-crumbs', hidden: true });
  const body = h('div', { class: 'ff-body' });
  const el = mark(h('div', { class: 'ff ff-inline' }, h('div', { class: 'ls-h' }, 'Уточнить'), crumbs, body), 'filter');
  const load = async () => { const list = await stockList(); if (list !== src) { src = list; items = index(list); } return items; };
  const set = (k, v) => { const sel = parseFt(P.ft); sel[k] = sel[k] === v ? undefined : v; patch({ ft: fmtFt(sel), page: undefined }); };
  async function render() {
    const my = ++seq;
    if (!body.children.length) body.replaceChildren(busyBlock('', { cls: 'muted small' }));
    await load();
    if (my !== seq) return;
    const fk = document.activeElement?.dataset?.fk; // фокус не теряем при перерисовке
    const sel = parseFt(P.ft);
    const names = Object.fromEntries(FACETS);
    const selEntries = FACETS.map(([k]) => [k, sel[k]]).filter(([, v]) => v);
    crumbs.hidden = !selEntries.length;
    crumbs.replaceChildren(...selEntries.map(([k, v]) =>
      h('button', { type: 'button', class: 'ff-step', title: 'Убрать: ' + names[k], 'data-fk': 'x:' + k, onclick: () => set(k, v) },
        h('span', { class: 'ff-step-l' }, names[k]), h('span', { class: 'ff-step-v' }, facetLabel(k, v)), h('span', { class: 'ff-step-x', 'aria-hidden': 'true' }, '×'))));
    let first = true;
    const groups = FACETS.map(([key, label]) => {
      if (sel[key]) return null; // выбранный шаг — уже строкой сверху
      const vals = facetValues(scope(items, P, categoryKey, sel), key).slice(0, key === 'pipe' ? 200 : key === 'type' ? 30 : 40);
      if (vals.length < 2) return null; // один вариант — выбирать нечего
      const open = folded.has(key) ? folded.get(key) : first || key === 'wash' || key === 'pipe';
      first = false;
      const colCls = key === 'type' ? '' : vals.length > 16 ? ' ff-cols ff-cols3' : vals.length > 8 ? ' ff-cols' : '';
      return h('div', { class: 'ff-group' + (open ? ' open' : '') },
        h('button', { type: 'button', class: 'ff-gh', 'data-fk': 'g:' + key, 'aria-expanded': String(open), onclick: () => { folded.set(key, !open); render(); } },
          h('span', { class: 'ff-gl' }, label), h('span', { class: 'ff-gn' }, String(vals.length)), h('span', { class: 'ff-chev', 'aria-hidden': 'true' }, '▾')),
        !open ? null : key === 'wash' || key === 'pipe' ? chipsOf(key, vals, label, set) : h('div', { class: 'ff-checks' + colCls, role: 'radiogroup', 'aria-label': label }, ...vals.map(([v, n]) => h('label', { class: 'ff-check' },
          h('input', { type: 'radio', name: 'ff-' + key, 'data-fk': 'v:' + key + ':' + v, onclick: (e) => { e.preventDefault(); set(key, v); } }), h('span', { class: 'ff-cv' }, facetLabel(key, v)), h('b', { class: 'ff-cn' }, String(n))))));
    }).filter(Boolean);
    body.replaceChildren(...(groups.length ? groups : [h('div', { class: 'muted small' }, selEntries.length || P.q || P.status ? 'Уточнять больше нечего' : 'В этой категории признаков нет')]));
    if (fk) [...el.querySelectorAll('[data-fk]')].find((n) => n.dataset.fk === fk)?.focus({ preventScroll: true });
  }
  return { el, update: (next) => { P = { ...next }; render(); }, reset: () => items && (items = null) };
}

/** steps[]: { key, label, when?, always? (раскрыт, без сворачивания), icon?(o) → Node (миниатюра у значения) } */
export function stepFunnel({ steps, load, title = 'Уточнить' }) {
  let P = {}; let seq = 0;
  const folded = new Map();
  const crumbs = h('div', { class: 'ff-crumbs', hidden: true });
  const body = h('div', { class: 'ff-body' });
  const el = mark(h('div', { class: 'ff ff-inline' }, h('div', { class: 'ls-h' }, title), crumbs, body), 'filter');
  const set = (k, v) => patch({ [k]: String(P[k] ?? '') === String(v) ? undefined : String(v), page: undefined });
  async function render() {
    const my = ++seq;
    if (!body.children.length) body.replaceChildren(busyBlock('', { cls: 'muted small' }));
    let data;
    try { data = await load(P); } catch { data = {}; }
    if (my !== seq) return;
    const fk = document.activeElement?.dataset?.fk;
    const vis = steps.filter((s) => !s.when || s.when(P));
    const label = (s, v) => (data[s.key] || []).find((o) => String(o.value) === String(v))?.label ?? v;
    const chosen = vis.filter((s) => P[s.key]);
    crumbs.hidden = !chosen.length;
    crumbs.replaceChildren(...chosen.map((s) => h('button', { type: 'button', class: 'ff-step', title: 'Убрать: ' + s.label, 'data-fk': 'x:' + s.key, onclick: () => set(s.key, P[s.key]) },
      h('span', { class: 'ff-step-l' }, s.label), h('span', { class: 'ff-step-v' }, String(label(s, P[s.key]))), h('span', { class: 'ff-step-x', 'aria-hidden': 'true' }, '×'))));
    let first = true;
    const groups = vis.filter((s) => !P[s.key]).map((s) => {
      const vals = data[s.key] || [];
      if (vals.length < 2) return null; // один вариант — выбирать нечего
      const open = s.always || (folded.has(s.key) ? folded.get(s.key) : first); // always — короткий список, всеграскрыт
      first = false;
      return h('div', { class: 'ff-group' + (open ? ' open' : '') },
        h('button', { type: 'button', class: 'ff-gh', 'data-fk': 'g:' + s.key, 'aria-expanded': String(open), disabled: s.always || undefined, onclick: () => { folded.set(s.key, !open); render(); } },
          h('span', { class: 'ff-gl' }, s.label), h('span', { class: 'ff-gn' }, String(vals.length)), s.always ? null : h('span', { class: 'ff-chev', 'aria-hidden': 'true' }, '▾')),
        open ? h('div', { class: 'ff-checks', role: 'radiogroup', 'aria-label': s.label }, ...vals.map((o) => h('label', { class: 'ff-check' },
          h('input', { type: 'radio', name: 'sf-' + s.key, 'data-fk': 'v:' + s.key + ':' + o.value, onclick: (e) => { e.preventDefault(); set(s.key, o.value); } }),
          s.icon ? s.icon(o) : null, h('span', { class: 'ff-cv' }, String(o.label ?? o.value)), h('b', { class: 'ff-cn' }, String(o.n))))) : null);
    }).filter(Boolean);
    body.replaceChildren(...(groups.length ? groups : [h('div', { class: 'muted small' }, chosen.length ? 'Уточнять больше нечего' : 'Вариантов нет')]));
    if (fk) [...el.querySelectorAll('[data-fk]')].find((n) => n.dataset.fk === fk)?.focus({ preventScroll: true });
  }
  return { el, update: (next) => { P = { ...next }; render(); } };
}
