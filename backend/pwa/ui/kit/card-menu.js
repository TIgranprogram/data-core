/** «⋯» шапки карточки: редкие действия + вид панели (C140: a.sep — черта перед пунктом). */
import { canEditSection } from '../../core/api.js';
import { h } from '../../core/dom.js';
import { setPref } from '../../core/prefs.js';

/**
 * fillCardMenu({ menuBox, rare, hasTabs, layouts, layoutNow, section, row, body, showView, showForm, doRemove, runAction })
 * Заполняет menuBox кнопкой «⋯» и выпадающим меню.
 */
export function fillCardMenu({ menuBox, rare, hasTabs = false, layouts = [], layoutNow = () => 'one', section, row, body, showView, showForm, doRemove, runAction }) {
  const edit = canEditSection(section);
  const menu = h('div', { class: 'menu', role: 'menu', hidden: true });
  const toggle = h('button', { class: 'btn btn-ghost btn-icon', type: 'button', title: 'Ещё', 'aria-label': 'Ещё действия', 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, '⋯');
  const setOpen = (v) => { menu.hidden = !v; toggle.setAttribute('aria-expanded', String(v)); };
  const away = (e) => { if (!menuBox.contains(e.target)) { setOpen(false); document.removeEventListener('click', away, true); } };
  toggle.onclick = () => { const v = menu.hidden; setOpen(v); document.removeEventListener('click', away, true); if (v) document.addEventListener('click', away, true); };
  const items = hasTabs ? [] : [h('div', { class: 'menu-sub', role: 'presentation' }, 'Вид панели')];
  if (!hasTabs) for (const [k, label] of layouts) {
    const on = layoutNow() === k;
    items.push(h('button', { type: 'button', role: 'menuitemradio', 'aria-checked': String(on), onclick: () => { setPref('panelLayout', k === 'one' ? '' : k); setOpen(false); const y = body.scrollTop; showView(row).then(() => { body.scrollTop = y; toggle.focus(); }); } }, (on ? '✓ ' : '') + label));
  }
  const acts = [];
  if (edit) {
    let dangerSep = false;
    rare.forEach((a) => {
      if (a.sep) acts.push(h('hr', { class: 'menu-sep' }));
      if (a.danger && !dangerSep) { dangerSep = true; if (!a.sep) acts.push(h('hr', { class: 'menu-sep' })); }
      acts.push(h('button', { type: 'button', role: 'menuitem', class: a.danger ? 'danger' : undefined, onclick: (e) => { setOpen(false); runAction(a, e.currentTarget); } }, a.label));
    });
    if (section.duplicate && section.form) acts.push(h('button', { type: 'button', role: 'menuitem', onclick: () => { setOpen(false); showForm('create', section.duplicate(row)); } }, 'Дублировать'));
    if (section.remove?.run) acts.push(h('button', { type: 'button', role: 'menuitem', class: 'danger', onclick: () => { setOpen(false); doRemove(); } }, 'Удалить'));
  }
  if (acts.length) items.unshift(...acts, h('hr', { class: 'menu-sep' }));
  menu.append(...items);
  menuBox.replaceChildren(toggle, menu);
}
