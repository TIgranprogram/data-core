import { mark } from './mark.js';
import { h } from '../../core/dom.js';
import { normSearch, searchTokens } from '../../core/facets.js';
import { highlight, placeList } from '../popup.js';

/*
 * kit.pick — эталон выбора значения. Режимы: single (поле + общий список, значение в <select>), combo (поле ввода + список),
 * multi (combo, несколько значений через запятую), tags (метки). Прежние ui/select.js, combo.js, tag-pick.js, suggest.js — реэкспорты.
 */


// Телефон (≤ 480 px, ВЫД.4): список — лист на весь экран с поиском сверху; экранная клавиатура поднимает низ панели (--kb)
const narrow = () => window.matchMedia('(max-width: 480px)').matches;
const syncKb = () => {
  const v = window.visualViewport;
  document.documentElement.style.setProperty('--kb', narrow() && v ? Math.max(0, Math.round(window.innerHeight - v.height - v.offsetTop)) + 'px' : '0px');
};
window.visualViewport?.addEventListener('resize', syncKb);
window.visualViewport?.addEventListener('scroll', syncKb);
// поле в правой панели не уходит под клавиатуру: при фокусе докручиваем после появления клавиатуры
document.addEventListener('focusin', (e) => {
  if (!narrow() || !e.target.closest?.('.drawer-body') || e.target.closest('.combo-list')) return;
  setTimeout(() => e.target.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 300);
});

/**
 * Единый выпадающий список (TASKS В.2) вместо браузерного <datalist> (тот рисовался по-своему, в тёмном — чёрным).
 *   attachCombo(input, { options: () => [{ value, label, sub?, group? }], onPick?(o), free = true, max = 60 })
 * Открывается по фокусу/клику (весь список) и при наборе (фильтр «как в магазине»: слова в любом порядке, м10 = M10).
 * ↑↓ — выбор, Enter — взять, Esc / Tab — закрыть. free — можно оставить своё значение (иначе только из списка).
 * Текст не режем (ВС): панель шире поля, пункт переносится, совпадения выделены, выбранный — галочкой;
 * у края экрана — влево / вверх, на телефоне — лист снизу (ui/popup.js). Длинное значение в поле — целиком в подсказке.
 * multi — несколько значений через запятую (цвета, размеры изделия; ФИ): список подсказывает по последнему значению,
 * выбор дописывает его и «, », уже вписанные не предлагаются; писать через запятую вручную по-прежнему можно.
 */
export function attachCombo(input, { options, onPick, max = 60, empty, extra, multi = false }) {
  const box = mark(h('div', { class: 'combo-list', hidden: true, role: 'listbox' }), 'pick');
  // поле ещё не в странице (форма собирается до вставки) — подключаемся, когда появится (ошибка с сайта «classList of null»)
  let tries = 0;
  const mount = () => {
    if (!input.parentElement) { if (tries++ < 60) requestAnimationFrame(mount); return; }
    input.parentElement.classList.add('has-combo');
    input.insertAdjacentElement('afterend', box);
  };
  mount();
  input.setAttribute('autocomplete', 'off');
  input.classList.add('combo-input', 'k-field', 'k-arrow');
  let shown = []; let active = 0; let picking = false;
  const all = () => (typeof options === 'function' ? options() : options) || [];
  const close = () => { box.hidden = true; };
  // поиск сверху листа (только телефон): ввод идёт в то же поле, список фильтруется как обычно
  const sin = h('input', { class: 'combo-search', type: 'search', placeholder: 'Поиск', 'aria-label': 'Поиск по списку', autocomplete: 'off',
    oninput: () => { input.value = sin.value; input.dispatchEvent(new Event('input', { bubbles: true })); },
    onblur: () => setTimeout(() => { if (document.activeElement !== input && !box.contains(document.activeElement)) close(); }, 150) });
  const head = h('div', { class: 'combo-head' }, sin, h('button', { type: 'button', class: 'btn combo-x', 'aria-label': 'Закрыть список', onclick: () => close() }, '×'));
  const fill = (...nodes) => {
    if (multi || !narrow()) { box.replaceChildren(...nodes); box.classList.remove('sheet-full'); return; }
    const was = document.activeElement === sin;
    const first = box.hidden;
    box.classList.add('sheet-full');
    if (first) sin.value = lastFilter ? input.value : '';
    box.replaceChildren(head, ...nodes);
    if (was || first) requestAnimationFrame(() => sin.focus({ preventScroll: true }));
  };
  // multi: «графит, зел» → вписаны [графит], ищем «зел»
  const parts = () => input.value.split(',');
  const typed = () => (multi ? parts().at(-1).trim() : input.value);
  const chosen = () => new Set(multi ? parts().slice(0, -1).map((x) => normSearch(x.trim())).filter(Boolean) : []);
  let lastFilter = false;
  function render(filter) {
    lastFilter = filter;
    const tokens = filter ? searchTokens(typed()) : [];
    const skip = chosen();
    const list = all().filter((o) => !skip.has(normSearch(String(o.label))) && (!tokens.length || tokens.every((t) => normSearch([o.label, o.sub, o.group].filter(Boolean).join(' ')).includes(t))));
    shown = list.slice(0, max);
    // extra(text, shown) → [{ label, run }] — явные действия под списком («+ Новый заказчик «…»», ЗЧ.2)
    const acts = (extra?.(input.value.trim(), shown) || []).map((a) => h('div', { class: 'combo-opt combo-act', role: 'option', onmousedown: async (e) => { e.preventDefault(); close(); await a.run(); } }, h('div', { class: 'opt-l' }, a.label)));
    if (!shown.length && acts.length) { fill(...acts); box.hidden = false; placeList(box); return; }
    if (!shown.length) { const why = empty?.(); fill(h('div', { class: 'combo-empty' + (why ? ' combo-why' : '') }, why || (tokens.length ? 'Нет в списке — останется как написали' : 'Список пуст'))); box.hidden = false; placeList(box); return; }
    active = Math.min(active, shown.length - 1); // -1 — ничего не подсвечено: Enter не меняет введённое
    const rows = []; let grp;
    shown.forEach((o, i) => {
      if (o.group && o.group !== grp) { grp = o.group; rows.push(h('div', { class: 'combo-group' }, grp)); }
      const cur = String(o.label) === typed();
      rows.push(h('div', { class: 'combo-opt' + (i === active ? ' active' : '') + (cur ? ' cur' : ''), role: 'option', 'aria-selected': cur ? 'true' : 'false', onmousedown: (e) => { e.preventDefault(); pick(o); } },
        h('div', { class: 'opt-l' }, filter ? highlight(o.label, typed()) : String(o.label)), o.sub ? h('small', null, o.sub) : null));
    });
    if (list.length > shown.length) rows.push(h('div', { class: 'combo-empty' }, `ещё ${list.length - shown.length} — уточните поиск`));
    rows.push(...acts);
    fill(...rows);
    box.hidden = false;
    placeList(box);
    box.querySelector('.combo-opt.active')?.scrollIntoView({ block: 'nearest' });
  }
  function pick(o) {
    picking = true;
    input.value = multi ? [...parts().slice(0, -1).map((x) => x.trim()).filter(Boolean), String(o.label)].join(', ') + ', ' : String(o.label);
    input.title = input.value; // длинное значение в узком поле — целиком при наведении (ВС.4)
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    picking = false;
    close(); if (multi) input.focus(); // ИЗ-12: после выбора список закрывается всегда; multi — курсор в поле, клик или ввод откроет снова
    onPick?.(o);
  }
  input.addEventListener('focus', () => { active = -1; }); // сам фокус список не открывает (форма ставит его на первое поле): только нажатие, ввод или стрелка
  input.addEventListener('click', () => { if (box.hidden) render(false); });
  input.addEventListener('input', () => { if (!picking) { active = -1; render(true); } });
  input.addEventListener('blur', () => setTimeout(() => { if (!box.contains(document.activeElement)) close(); }, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (box.hidden) render(false); else { active = Math.min(shown.length - 1, Math.max(-1, active) + 1); render(!!typed() && !shown.some((o) => o.label === typed())); } }
    else if (e.key === 'ArrowUp' && !box.hidden) { e.preventDefault(); active = Math.max(0, active - 1); render(!!typed() && !shown.some((o) => o.label === typed())); }
    else if (e.key === 'Enter' && !box.hidden && shown[active]) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape' && !box.hidden) { e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  });
  input.addEventListener('change', () => { input.title = input.value; });
  return { close, refresh: () => { if (!box.hidden) render(true); } };
}


/*
 * Выбор из списка без обрезки (TASKS ВС.6): нативный <select> рисует браузер — длинное значение обрезается,
 * открытый список не стилизуется. enhanceSelect(sel) прячет <select> и ставит рядом поле с общим списком (ui/combo.js):
 * можно печатать для поиска, группы <optgroup> — заголовками. Значение по-прежнему в <select> (код раздела не меняется):
 * выбор ставит sel.value и шлёт change. Короткие списки (да/нет, статус, ед.) не трогаем — только длинные (isLong).
 */
export const isLong = (sel, { chars = 28, count = 12 } = {}) => sel.options.length > count || [...sel.options].some((o) => o.textContent.length > chars);

export function enhanceSelect(sel, { force = false } = {}, tries = 0) {
  mark(sel, 'pick');
  if (sel.dataset.enhanced || (!force && !isLong(sel))) return sel;
  // поле ещё не в документе (форма собирается) — подождать, пока встанет на место
  if (!sel.parentElement) { if (tries < 60) requestAnimationFrame(() => enhanceSelect(sel, { force }, tries + 1)); return sel; }
  sel.dataset.enhanced = '1';
  const empty = [...sel.options].find((o) => o.value === '');
  const input = h('input', { class: 'sel-input' + (sel.className ? ' ' + sel.className : ''), autocomplete: 'off', placeholder: empty?.textContent || 'Выберите', 'aria-label': sel.getAttribute('aria-label') || '' });
  const wrap = mark(h('span', { class: 'sel-wrap' }, input), 'pick');
  sel.insertAdjacentElement('afterend', wrap);
  sel.hidden = true;
  const label = () => { const o = sel.selectedOptions[0]; return o && o.value !== '' ? o.textContent : ''; };
  const sync = () => { input.value = label(); input.title = input.value; };
  const opts = () => [...sel.options].map((o) => ({ value: o.value, label: o.value === '' ? (o.textContent || '—') : o.textContent, group: o.parentElement?.tagName === 'OPTGROUP' ? o.parentElement.label : undefined }));
  attachCombo(input, {
    options: opts,
    onPick: (o) => { sel.value = o.value; sync(); sel.dispatchEvent(new Event('change', { bubbles: true })); },
    empty: () => 'Ничего не нашлось — сотрите и выберите из списка',
  });
  // только из списка: ушли с поля с чужим текстом — вернуть выбранное
  input.addEventListener('blur', () => setTimeout(() => { if (input.value !== label()) sync(); }, 150));
  // программная смена sel.value (сброс фильтров, загрузка опций) — подхватить
  new MutationObserver(sync).observe(sel, { childList: true, subtree: true });
  sel.addEventListener('change', sync);
  const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
  Object.defineProperty(sel, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); sync(); } });
  sync();
  return sel;
}


/**
 * Выбор нескольких значений метками (поле формы `type: 'widget'`; паспорт v2 — элементы, материалы; БЗ-6 Э5a1).
 * Метки — общий класс `.tag` (`.active` — выбрано), подпись снизу — `small`. Значение — JSON-список value.
 *   tagPick({ options: [{ value, label, sub?, cats?, kind? }], value, label?, productOnly? }) → { el, value, set value, focus, setScope(code) → [чужие выбранные] }
 * cats — коды категорий, к которым относится значение (пусто — ко всем). setScope(code): видны только свои;
 * productOnly — как на сервере elementFits: только kind «product» или пустой (детали/крепеж скрыты);
 * уже выбранные чужие остаются с пометкой «не для этой категории» (`.tag.foreign`); «Показать все» — под списком (ФП).
 */
export function tagPick({ options, value, label, productOnly = false }) {
  const parse = (v) => { if (Array.isArray(v)) return v.map(String); try { return (JSON.parse(v || '[]') || []).map(String); } catch { return []; } };
  let cur = new Set(parse(value));
  let scope = ''; let showAll = false;
  const box = mark(h('div', { class: 'tag-pick', role: 'group', 'aria-label': label || 'Выбор' }), 'pick');
  const asProduct = (o) => { const k = String(o.kind || '').trim(); return !k || k === 'product'; };
  const mine = (o) => {
    if (productOnly && !asProduct(o)) return false;
    return !scope || !(o.cats || []).length || o.cats.includes(scope);
  };
  const items = options.map((o) => {
    const note = h('small', null, o.sub || '');
    const b = h('button', { type: 'button', class: 'tag', 'aria-pressed': 'false', title: o.sub || '', onclick: () => { cur.has(String(o.value)) ? cur.delete(String(o.value)) : cur.add(String(o.value)); paint(); box.dispatchEvent(new Event('change', { bubbles: true })); } },
      o.label, note);
    b.dataset.v = String(o.value);
    return { o, b, note };
  });
  const more = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true, onclick: () => { showAll = !showAll; paint(); } });
  const paint = () => {
    let hidden = 0;
    for (const { o, b, note } of items) {
      const on = cur.has(b.dataset.v); const own = mine(o);
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('foreign', !own);
      // категория выбрана — перечень категорий значения не нужен (ПК: в форме только своё); без категории — как раньше
      const why = productOnly && !asProduct(o) ? 'не изделие' : 'не для этой категории';
      note.textContent = !own && on ? why : scope ? '' : o.sub || '';
      b.hidden = !own && !on && !showAll;
      if (!own && !on) hidden++;
    }
    more.hidden = !(scope || productOnly) || (!hidden && !showAll);
    more.textContent = showAll ? (productOnly ? 'Только изделия категории' : 'Только для этой категории') : `Показать все (ещё ${hidden})`;
  };
  box.append(...(items.length ? [...items.map((x) => x.b), more] : [h('span', { class: 'muted' }, 'Справочник пуст — заполните его в «Справочники → Паспорта»')]));
  paint();
  return {
    el: box,
    get value() { return JSON.stringify([...cur]); },
    set value(v) { cur = new Set(parse(v)); paint(); },
    focus: () => items.find((x) => !x.b.hidden)?.b.focus(),
    /** Категория паспорта сменилась: показать свои; вернуть подписи выбранных, что к ней не относятся. */
    setScope(code) { scope = code || ''; showAll = false; paint(); return items.filter((x) => cur.has(x.b.dataset.v) && !mine(x.o)).map((x) => x.o.label); },
  };
}


/**
 * Подсказки под полем ввода (TASKS З.7): печатаешь — внизу «уже заказывали / есть на складе»,
 * сверху — кнопки категорий для быстрого сужения; выбор заполняет сразу несколько полей формы.
 *   attachSuggest(input, { load: async () => [{ label, sub, cat, search, values, pic? }], onPick(values) }) — pic: миниатюра слева (модели паспортов)
 * search — строка для поиска (нормализованная, как в facets.js).
 */
export function attachSuggest(input, { load, onPick, title = 'Уже заказывали' }) {
  let all = null; let cat = ''; let active = 0; let shown = [];
  const box = mark(h('div', { class: 'suggest', hidden: true, role: 'listbox' }), 'pick');
  input.parentElement.classList.add('has-suggest');
  input.insertAdjacentElement('afterend', box);
  const close = () => { box.hidden = true; };
  async function render() {
    if (!all) { try { all = await load(); } catch { all = []; } }
    const tokens = searchTokens(input.value);
    if (!tokens.length && !cat) { close(); return; }
    const inText = all.filter((x) => tokens.every((t) => x.search.includes(t)));
    shown = inText.filter((x) => !cat || x.cat === cat).slice(0, 12);
    const cats = [...new Set(inText.map((x) => x.cat).filter(Boolean))];
    if (!shown.length && !cats.length) { close(); return; }
    active = Math.min(active, Math.max(0, shown.length - 1));
    box.replaceChildren(...[
      h('div', { class: 'sg-head' }, h('span', null, title),
        cats.length > 1 ? h('span', { class: 'sg-cats' }, ...['', ...cats].map((c) => h('button', { type: 'button', class: 'tag' + (cat === c ? ' active' : ''), onmousedown: (e) => { e.preventDefault(); cat = c; render(); } }, c || 'Все'))) : null),
      ...shown.map((x, i) => h('div', { class: 'sg-row' + (x.pic !== undefined ? ' sg-pic-row' : '') + (i === active ? ' active' : ''), role: 'option', onmousedown: (e) => { e.preventDefault(); pick(x); } },
        x.pic !== undefined ? (x.pic ? h('img', { class: 'sg-pic', src: x.pic, alt: '', loading: 'lazy' }) : h('span', { class: 'sg-pic sg-pic-none' })) : null,
        h('div', { class: 'sg-txt' }, h('div', { class: 'opt-l' }, highlight(x.label, input.value)), h('small', null, x.sub)))),
      shown.length ? null : h('div', { class: 'sg-row muted' }, 'В этой категории ничего')].filter(Boolean));
    box.hidden = false;
    placeList(box);
    box.querySelector('.sg-row.active')?.scrollIntoView({ block: 'nearest' });
  }
  let picking = false;
  function pick(x) { onPick(x.values); close(); picking = true; input.dispatchEvent(new Event('input', { bubbles: true })); picking = false; }
  let tmr;
  input.addEventListener('input', () => { if (picking) return; clearTimeout(tmr); tmr = setTimeout(render, 120); });
  input.addEventListener('focus', () => { if (input.value.trim()) render(); });
  input.addEventListener('blur', () => setTimeout(close, 150));
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(shown.length - 1, active + 1); render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); render(); }
    else if (e.key === 'Enter' && shown[active]) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close();
  });
}

/**
 * pick({ mode, ... }) — единая точка входа.
 *   single: pick({ mode:'single', select, force? }) — улучшает <select> (enhanceSelect)
 *   combo / multi: pick({ mode:'combo'|'multi', input, options, onPick, empty, extra, max }) — attachCombo
 *   tags: pick({ mode:'tags', options, value, label }) — tagPick
 */
export function pick({ mode = 'combo', select, input, force, ...rest } = {}) {
  if (mode === 'single') return enhanceSelect(select, { force });
  if (mode === 'tags') return tagPick(rest);
  return attachCombo(input, { ...rest, multi: mode === 'multi' });
}
