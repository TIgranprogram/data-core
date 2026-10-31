import { h } from '../core/dom.js';
import { normSearch, searchTokens } from '../core/facets.js';
import { highlight, placeList } from './popup.js';

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
  const box = h('div', { class: 'combo-list', hidden: true, role: 'listbox' });
  // поле ещё не в странице (форма собирается до вставки) — подключаемся, когда появится (ошибка с сайта «classList of null»)
  let tries = 0;
  const mount = () => {
    if (!input.parentElement) { if (tries++ < 60) requestAnimationFrame(mount); return; }
    input.parentElement.classList.add('has-combo');
    input.insertAdjacentElement('afterend', box);
  };
  mount();
  input.setAttribute('autocomplete', 'off');
  input.classList.add('combo-input');
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
