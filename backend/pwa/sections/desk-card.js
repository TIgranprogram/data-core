import { h } from '../core/dom.js';
import { date, isoDay, newUid } from '../core/format.js';
import { PREFIX } from '../core/api.js';
import { iconButton, button, textInput, modal, confirmDlg, openPopMenu, toast } from '../ui/kit/index.js';
import { toggle } from '../ui/kit/guide.js';
import { deskKind } from './desk-data.js';
import { keyOf, LANES } from './desk-state.js';

export function taskDate(due, done) {
  if (!due) return null;
  const day = String(due).slice(0, 10);
  const today = isoDay();
  const late = day < today && !done;
  return h('span', { class: 'desk-date' + (late ? ' desk-late' : ''), title: late ? 'Просрочено' : 'Срок' },
    day === today ? 'Сегодня' : date(day));
}

async function taskDialog(title, initial) {
  const submit = () => name.input.form?.requestSubmit();
  const name = textInput({ label: 'Что сделать', value: initial?.title, max: 180, onEnter: submit });
  const due = textInput({ label: 'Срок', type: 'date', value: initial?.due, onEnter: submit });
  return modal({
    title, okText: 'Сохранить',
    body: h('div', { class: 'desk-task-form' }, name.el, due.el),
    onOk: () => {
      if (!name.value.trim()) throw new Error('Введите название задачи.');
      return { title: name.value.trim(), due: due.value || null };
    },
  });
}

export function deskActions(change) {
  return {
    async create(parent, initial) {
      const key = parent && keyOf(parent);
      const result = await taskDialog(initial ? 'Изменить задачу' : parent ? 'Задача к карточке' : 'Новая задача');
      if (!result) return;
      if (!parent) {
        const item = { of: 'personal', id: newUid(), ...result, done: false };
        change({ type: 'place', key: keyOf(item), item, lane: 'focus' });
      } else if (initial === parent) change({ type: 'edit', key, patch: result });
      else {
        const id = initial?.id || newUid();
        change({ type: 'task', key, id, ...(initial ? { patch: result } : { task: { id, ...result, done: false } }) });
      }
    },
    done(item, task, done) {
      change(task ? { type: 'task', key: keyOf(item), id: task.id, patch: { done } } : { type: 'edit', key: keyOf(item), patch: { done } });
    },
    async remove(item) {
      if (item.tasks?.length && !await confirmDlg('Убрать карточку со стола?', 'Личный список задач внутри карточки тоже будет убран.', { okText: 'Убрать' })) return;
      change({ type: 'remove', key: keyOf(item) });
      toast('Карточка убрана со стола');
    },
    removeTask(item, task) { change({ type: 'task-remove', key: keyOf(item), id: task.id }); },
    place(item, lane, before) { change({ type: 'place', key: keyOf(item), item, lane, before }); },
  };
}

export function deskMark(of, thumbnail) {
  const sign = ({ board: '▥', orders: '▤', stock: '◇', table: '▦', ops: '↻', gallery: '▧', requests: '≡', partners: '▫' })[deskKind(of)[1]];
  return h('span', { class: 'desk-mark', 'aria-hidden': 'true' },
    thumbnail ? h('img', { src: thumbnail.startsWith('/db/') ? thumbnail : PREFIX + thumbnail, alt: '', loading: 'lazy',
      onerror: (e) => e.currentTarget.parentElement?.replaceChildren(sign) })
      : sign);
}

function taskCheck(value, onChange) {
  const label = toggle({ label: h('span', null, value.title), checked: value.done, onChange });
  label.querySelector('input').setAttribute('aria-label', 'Готово: ' + value.title);
  return label;
}

function todoRow(item, task, actions) {
  const check = taskCheck(task, (done) => actions.done(item, task, done));
  const more = iconButton({ icon: '⋯', size: 'S', label: 'Действия с задачей ' + task.title, menu: true, onClick: (e) => {
    openPopMenu({ anchor: e.currentTarget, side: 'down', groups: [{ items: [
      { label: 'Изменить', onSelect: () => actions.create(item, task) },
      { label: 'Убрать задачу', onSelect: () => actions.removeTask(item, task) },
    ] }] });
  } });
  return h('li', { class: 'desk-todo' + (task.done ? ' is-done' : '') },
    check, taskDate(task.due, task.done), more);
}

function moveMenu(item, laneItems, actions, event) {
  const i = laneItems.indexOf(item);
  const move = LANES.filter((lane) => lane.key !== item.lane).map(({ key, title }) => ({
    label: 'Перенести в «' + title + '»', onSelect: () => actions.place(item, key),
  }));
  if (i > 0) move.push({ label: 'Поднять в стопке', onSelect: () => actions.place(item, item.lane, keyOf(laneItems[i - 1])) });
  if (i >= 0 && i < laneItems.length - 1) move.push({ label: 'Опустить в стопке', onSelect: () => actions.place(item, item.lane, laneItems[i + 2] && keyOf(laneItems[i + 2])) });
  openPopMenu({ anchor: event.currentTarget, side: 'down', groups: [
    ...(item.of === 'personal' ? [{ items: [{ label: 'Изменить задачу', onSelect: () => actions.create(item, item) }] }] : []),
    { items: move },
    { sep: true, items: [{ label: 'Убрать со стола', onSelect: () => actions.remove(item) }] },
  ] });
}

export function deskCard(item, meta, laneItems, actions, expanded, expand) {
  const ref = keyOf(item), personal = item.of === 'personal';
  const title = personal ? item.title : meta?.title || (meta?.unavailable ? 'Карточка недоступна' : meta?.failed ? 'Данные не загрузились' : 'Загрузка карточки…');
  const todos = item.tasks || [];
  const done = todos.filter((task) => task.done).length;
  const showTodo = personal || !!meta?.href;
  const header = h('div', { class: 'desk-card-head' },
    h('span', { class: 'desk-grip', title: 'Перетащить карточку', 'aria-hidden': 'true' }, '⠿'),
    h('span', { class: 'desk-kind' }, deskKind(item.of)[0]),
    iconButton({ icon: '⋯', size: 'S', label: 'Действия с карточкой ' + title, menu: true, onClick: (e) => moveMenu(item, laneItems, actions, e) }));
  const mainLabel = meta?.href ? h('a', { class: 'desk-title', href: meta.href }, title)
    : personal ? taskCheck(item, (done) => actions.done(item, null, done))
      : h('span', { class: 'desk-title' }, title);
  if (personal) mainLabel.classList.add('desk-personal-label');
  const main = h('div', { class: 'desk-card-main' }, personal ? null : deskMark(item.of, meta?.thumb),
    h('div', null, h('h3', null, mainLabel), meta?.subtitle ? h('p', { class: 'desk-subtitle' }, meta.subtitle) : null,
      taskDate(personal ? item.due : meta?.due, item.done)));
  const branch = meta?.next || meta?.links?.length ? h('div', { class: 'desk-branch' },
    meta.next ? h('div', { class: 'desk-suggestion' }, h('span', null, 'Дальше'), meta.next) : null,
    meta.links.length ? h('div', { class: 'desk-links' }, meta.links.map((link) => h('a', { href: link.href }, link.label))) : null) : null;
  const panelId = 'desk-tasks-' + encodeURIComponent(ref);
  const toggle = todos.length ? button({ size: 'S', kind: 'ghost', cls: 'desk-todo-toggle',
    label: 'Задачи ' + done + '/' + todos.length, onClick: () => expand(ref) }) : null;
  toggle?.setAttribute('aria-expanded', String(expanded)); toggle?.setAttribute('aria-controls', panelId);
  const footer = showTodo ? h('div', { class: 'desk-card-foot' }, toggle,
    button({ size: 'S', kind: 'ghost', cls: 'desk-task-add', label: '+ Задача', title: 'Добавить задачу к карточке', onClick: () => actions.create(item) })) : null;
  return h('article', { class: 'desk-card' + (item.done ? ' is-done' : ''), dataset: { deskCard: ref, deskColor: deskKind(item.of)[4] } },
    header, main, branch, footer,
    showTodo && todos.length ? h('ul', { class: 'desk-todos', id: panelId, hidden: !expanded }, todos.map((task) => todoRow(item, task, actions))) : null);
}
