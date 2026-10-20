import { h } from '../core/dom.js';
import { normSearch, searchTokens } from '../core/facets.js';

/**
 * Единый выпадающий список (TASKS В.2) вместо браузерного <datalist> (тот рисовался по-своему, в тёмном — чёрным).
 *   attachCombo(input, { options: () => [{ value, label, sub?, group? }], onPick?(o), free = true, max = 60 })
 * Открывается по фокусу/клику (весь список) и при наборе (фильтр «как в магазине»: слова в любом порядке, м10 = M10).
 * ↑↓ — выбор, Enter — взять, Esc — закрыть. free — можно оставить своё значение (иначе только из списка).
 */
export function attachCombo(input, { options, onPick, max = 60 }) {
  const box = h('div', { class: 'combo-list', hidden: true, role: 'listbox' });
  input.parentElement.classList.add('has-combo');
  input.insertAdjacentElement('afterend', box);
  input.setAttribute('autocomplete', 'off');
  input.classList.add('combo-input');
  let shown = []; let active = 0; let picking = false;
  const all = () => (typeof options === 'function' ? options() : options) || [];
  const close = () => { box.hidden = true; };
  function render(filter) {
    const tokens = filter ? searchTokens(input.value) : [];
    const list = all().filter((o) => !tokens.length || tokens.every((t) => normSearch([o.label, o.sub, o.group].filter(Boolean).join(' ')).includes(t)));
    shown = list.slice(0, max);
    if (!shown.length) { box.replaceChildren(h('div', { class: 'combo-empty' }, tokens.length ? 'Нет в списке — останется как написали' : 'Список пуст')); box.hidden = false; return; }
    active = Math.min(active, shown.length - 1);
    const rows = []; let grp;
    shown.forEach((o, i) => {
      if (o.group && o.group !== grp) { grp = o.group; rows.push(h('div', { class: 'combo-group' }, grp)); }
      rows.push(h('div', { class: 'combo-opt' + (i === active ? ' active' : '') + (String(o.label) === input.value ? ' cur' : ''), role: 'option', onmousedown: (e) => { e.preventDefault(); pick(o); } },
        h('div', { class: 'clip' }, o.label), o.sub ? h('small', null, o.sub) : null));
    });
    if (list.length > shown.length) rows.push(h('div', { class: 'combo-empty' }, `ещё ${list.length - shown.length} — уточните поиск`));
    box.replaceChildren(...rows);
    box.hidden = false;
    box.querySelector('.combo-opt.active')?.scrollIntoView({ block: 'nearest' });
  }
  function pick(o) {
    picking = true;
    input.value = String(o.label);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    picking = false;
    close();
    onPick?.(o);
  }
  input.addEventListener('focus', () => { active = 0; render(false); });
  input.addEventListener('click', () => { if (box.hidden) render(false); });
  input.addEventListener('input', () => { if (!picking) { active = 0; render(true); } });
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (box.hidden) render(false); else { active = Math.min(shown.length - 1, active + 1); render(!!input.value && !shown.some((o) => o.label === input.value)); } }
    else if (e.key === 'ArrowUp' && !box.hidden) { e.preventDefault(); active = Math.max(0, active - 1); render(!!input.value && !shown.some((o) => o.label === input.value)); }
    else if (e.key === 'Enter' && !box.hidden && shown[active]) { e.preventDefault(); pick(shown[active]); }
    else if (e.key === 'Escape' && !box.hidden) { e.stopPropagation(); close(); }
  });
  return { close, refresh: () => { if (!box.hidden) render(true); } };
}
