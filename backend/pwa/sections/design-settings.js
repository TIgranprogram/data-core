import { api, session } from '../core/api.js';
import { h } from '../core/dom.js';
import { confirmDlg } from '../ui/kit/dialog.js';
import { button, iconButton, enhanceSelect } from '../ui/kit/index.js';
import { allStickers, dropStickersCache } from '../ui/design-stickers.js';
import { toast, toastError } from '../ui/kit/toast.js';

/**
 * Правая панель «Настройки доски» (`?of=designsettings&open=board`, только admin): какие стикеры показывать на карточках,
 * их порядок, свои стикеры (число или набор состояний с цветами). Системные стикеры можно только скрыть и переставить.
 * Сервер: GET/POST/PATCH/DELETE /design-stickers.
 */
export const isAdmin = () => session.role === 'admin' || session.user?.isOwner === true;
const KIND = { system: 'системный', number: 'число', state: 'состояния' };
const GREY = '#9aa3af';

function editor(st, onDone) {
  const isNew = !st;
  let kind = st?.kind || 'number';
  const name = h('input', { maxlength: 60, value: st?.label || '', placeholder: 'Например: Сложность', 'aria-label': 'Название стикера' });
  const unit = h('input', { maxlength: 12, value: st?.unit || '', placeholder: 'шт., ч, кг', 'aria-label': 'Ед. изм.' });
  const kindSel = enhanceSelect(h('select', { 'aria-label': 'Вид стикера', disabled: !isNew }, h('option', { value: 'number' }, 'Число'), h('option', { value: 'state' }, 'Набор состояний')));
  kindSel.value = kind;
  const states = (st?.states || []).map((s) => ({ ...s }));
  if (isNew) states.push({ label: '', color: GREY });
  const stBox = h('div', { class: 'stk-edit-states' });
  const unitField = h('label', { class: 'field' }, h('span', null, 'Ед. изм. (необязательно)'), unit);
  const statesField = h('div', { class: 'field' }, h('span', null, 'Статусы и их цвета'), stBox,
    button({ label: '+ Статус', size: 'S', onClick: () => { states.push({ label: '', color: GREY }); paintStates(); } }));
  function paintStates() {
    stBox.replaceChildren(...states.map((s, i) => h('div', { class: 'stk-edit-row' },
      h('input', { type: 'color', value: /^#[0-9a-fA-F]{6}$/.test(s.color || '') ? s.color : GREY, 'aria-label': 'Цвет', oninput: (e) => { s.color = e.target.value; } }),
      h('input', { maxlength: 40, value: s.label, placeholder: 'Название состояния', 'aria-label': 'Название состояния', oninput: (e) => { s.label = e.target.value; } }),
      iconButton({ icon: '×', label: 'Убрать состояние', title: 'Убрать состояние', onClick: () => { states.splice(i, 1); paintStates(); } }))));
  }
  const sync = () => { kind = kindSel.value; unitField.hidden = kind !== 'number'; statesField.hidden = kind !== 'state'; };
  kindSel.addEventListener('change', sync);
  paintStates(); sync();
  const save = button({ label: 'Сохранить', kind: 'primary', onClick: async (e) => {
    const label = name.value.trim();
    if (!label) { toastError(new Error('Впишите название стикера.')); return; }
    const body = { label };
    if (kind === 'number') body.unit = unit.value.trim();
    else {
      const list = states.filter((s) => s.label.trim()).map((s) => ({ ...(s.id ? { id: s.id } : {}), label: s.label.trim(), color: s.color }));
      if (!list.length) { toastError(new Error('Добавьте хотя бы одно состояние.')); return; }
      body.states = list;
    }
    const btn = e.currentTarget; btn.classList.add('is-busy'); btn.disabled = true;
    try {
      if (isNew) await api('/design-stickers', { method: 'POST', body: { kind, ...body } });
      else await api(`/design-stickers/${st.id}`, { method: 'PATCH', body });
      dropStickersCache(); toast(isNew ? 'Стикер добавлен' : 'Стикер сохранён'); onDone(true);
    } catch (ex) { toastError(ex, 'сохранить стикер'); btn.classList.remove('is-busy'); btn.disabled = false; }
  } });
  return h('div', { class: 'stk-editor' }, h('h3', { class: 'section-title' }, isNew ? 'Новый стикер' : 'Стикер «' + st.label + '»'),
    h('label', { class: 'field' }, h('span', null, 'Название'), name),
    h('label', { class: 'field' }, h('span', null, 'Вид'), kindSel), unitField, statesField,
    h('div', { class: 'actions' }, save, button({ label: 'Отмена', onClick: () => onDone(false) })));
}

function listView(list, ctx, edit) {
  const patch = async (id, body, what) => { try { await api(`/design-stickers/${id}`, { method: 'PATCH', body }); dropStickersCache(); } catch (e) { toastError(e, what); } ctx.reload(); };
  const move = async (i, d) => {
    const a = list[i], b = list[i + d]; if (!a || !b) return;
    const next = [...list]; next[i] = b; next[i + d] = a;
    try {
      for (const [k, s] of next.entries()) if (s.order !== k) await api(`/design-stickers/${s.id}`, { method: 'PATCH', body: { order: k } });
      dropStickersCache();
    } catch (e) { toastError(e, 'поменять порядок'); }
    ctx.reload();
  };
  const rows = list.map((s, i) => {
    const up = iconButton({ icon: '↑', label: 'Выше: ' + s.label, title: 'Выше', onClick: () => move(i, -1) });
    const down = iconButton({ icon: '↓', label: 'Ниже: ' + s.label, title: 'Ниже', onClick: () => move(i, 1) });
    up.disabled = i === 0; down.disabled = i === list.length - 1;
    return h('li', { class: 'stk-set-row' + (s.visible === false ? ' off' : '') },
      h('label', { class: 'stk-set-vis', title: 'Показывать на карточках доски' },
        h('input', { type: 'checkbox', checked: s.visible !== false, 'aria-label': 'Показывать на доске: ' + s.label, onchange: (e) => patch(s.id, { visible: e.target.checked }, 'переключить стикер') })),
      h('div', { class: 'stk-set-main' }, h('div', { class: 't-title' }, s.label), h('div', { class: 't-sub' }, KIND[s.kind] || s.kind, s.unit ? ' · ' + s.unit : '', s.kind === 'state' ? ' · ' + (s.states || []).length + ' сост.' : '')),
      h('div', { class: 'stk-set-acts' },
        up, down,
        s.kind !== 'system' ? button({ label: 'Изменить', size: 'S', onClick: () => edit(s) }) : null,
        s.kind !== 'system' ? button({ label: 'Удалить', kind: 'danger', size: 'S', onClick: async () => {
          if (!(await confirmDlg('Удалить стикер «' + s.label + '»?', 'Значения этого стикера пропадут со всех задач.', { okText: 'Удалить', danger: true }))) return;
          try { await api(`/design-stickers/${s.id}`, { method: 'DELETE' }); dropStickersCache(); toast('Стикер удалён'); } catch (e) { toastError(e, 'удалить стикер'); }
          ctx.reload();
        } }) : null));
  });
  return h('div', null,
    h('p', { class: 'db-hint' }, 'Галочка — показывать стикер на карточке доски. На карточке помещаются первые четыре из включённых; остальные видны в задаче справа.'),
    h('ul', { class: 'stk-set-list' }, rows),
    h('div', { class: 'actions' }, button({ label: '+ Стикер', kind: 'primary', onClick: () => edit(null) })));
}

export const designSettings = {
  id: 'designsettings',
  title: 'Настройки доски',
  get: async () => {
    if (!isAdmin()) throw new Error('Настройки доски доступны только администратору.');
    return { id: 'board', stickers: await allStickers() };
  },
  card: {
    heading: () => 'Настройки доски',
    subheading: () => 'Стикеры на карточках проектирования',
    noHistory: true,
    view: () => [],
    extra: (r, ctx) => {
      const host = h('div', { class: 'db-blocks' });
      const showList = () => host.replaceChildren(listView(r.stickers, ctx, (s) => host.replaceChildren(editor(s, (saved) => (saved ? ctx.reload() : showList())))));
      showList();
      return host;
    },
  },
};
