// Личный порядок, сроки и задачи хранятся отдельно от состояния исходной записи.
import { api, PREFIX, session } from '../core/api.js';
import { viewAsActive } from '../core/view-as.js';

export const LANES = [
  { key: 'focus', title: 'В фокусе', empty: 'Перенесите сюда то, над чем работаете сейчас.' },
  { key: 'next', title: 'Запланировано', empty: 'Сложите сюда задачи на потом.' },
  { key: 'waiting', title: 'Жду', empty: 'Оставьте здесь то, где нужен ответ или результат.' },
];
export const keyOf = (item) => item.of + ':' + item.id;

const hasOpenTasks = (tasks) => tasks?.some((task) => !task.done);
export function isDeskDone(item) {
  if (hasOpenTasks(item.tasks)) return false;
  return item.done ?? (item.of !== 'personal' && !!item.tasks?.length);
}

function withTasks(item, tasks, action) {
  const next = { ...item, tasks };
  if (item.of === 'personal') return next;
  if (isDeskDone(item)) return { ...next, done: !hasOpenTasks(tasks) };
  if (action.patch?.done === true && !hasOpenTasks(tasks)) return { ...next, done: true };
  return next;
}

function applyFields(value, patch) {
  const next = { ...value, ...patch };
  if (next.due == null) delete next.due;
  if (next.deletedAt == null) delete next.deletedAt;
  return next;
}

export function applyDesk(items, action) {
  const current = items.find((item) => keyOf(item) === action.key);
  if (action.type === 'remove') return items.filter((item) => item !== current);
  if (action.type === 'place') {
    if (!current && !action.item) return items;
    if (!current && items.filter((item) => !item.deletedAt).length >= 60) throw new Error('На столе 60 карточек, включая завершённые. Уберите ненужную карточку и попробуйте ещё раз.');
    const item = current || action.item;
    const next = applyFields(item, { lane: action.lane, ...(isDeskDone(item) ? { done: false } : {}) });
    const remaining = items.filter((item) => item !== current);
    const before = remaining.findIndex((item) => item.lane === action.lane && keyOf(item) === action.before);
    remaining.splice(before < 0 ? remaining.length : before, 0, next);
    return remaining;
  }
  if (!current) return items;
  if (action.type === 'restore' && current.deletedAt && items.filter((item) => !item.deletedAt).length >= 60) {
    throw new Error('На столе 60 карточек. Освободите место, прежде чем восстанавливать задачу.');
  }
  return items.map((item) => {
    if (item !== current) return item;
    if (action.type === 'edit') return applyFields(item, action.patch);
    if (action.type === 'trash') {
      if (item.deletedAt) return item;
      if (items.filter((value) => value.deletedAt).length >= 600) throw new Error('Корзина задач заполнена.');
      return { ...item, deletedAt: action.at };
    }
    if (action.type === 'restore') return applyFields(item, { deletedAt: null });
    if (action.type === 'ref-remove') return { ...item, refs: (item.refs || []).filter((ref) => keyOf(ref) !== keyOf(action.ref)) };
    if (action.type === 'ref-add') {
      const refs = item.refs || [];
      if (refs.some((ref) => keyOf(ref) === keyOf(action.ref))) return item;
      if (refs.length >= 30) throw new Error('В этой задаче уже 30 карточек.');
      return { ...item, refs: [...refs, action.ref] };
    }
    const tasks = item.tasks || [];
    if (action.type === 'task-remove') return withTasks(item, tasks.filter((task) => task.id !== action.id), action);
    const existing = tasks.find((task) => task.id === action.id);
    if (existing) return withTasks(item, tasks.map((task) => task === existing ? applyFields(task, action.patch) : task), action);
    if (!action.task) return item;
    if (tasks.length >= 12) throw new Error('В карточке уже 12 задач. Уберите завершённую, чтобы добавить новую.');
    return withTasks(item, [...tasks, applyFields(action.task)], action);
  });
}

const defaultLanes = () => LANES.map(({ key, title }) => ({ key, title }));

export function applyDeskLayout({ items, lanes }, action) {
  const current = lanes ?? defaultLanes();
  if (action.type === 'lane-save') {
    const { key, title } = action.lane;
    const existing = current.find((lane) => lane.key === key);
    if (action.edit && !existing) return { items, lanes };
    if (current.some((lane) => lane.key !== key && lane.title.toLocaleLowerCase('ru') === title.toLocaleLowerCase('ru'))) {
      throw new Error('Стопка с таким названием уже существует.');
    }
    if (!existing && current.length >= 9) throw new Error('На рабочем столе уже девять стопок.');
    return { items, lanes: existing ? current.map((lane) => lane === existing ? { key, title } : lane) : [...current, { key, title }] };
  }
  if (action.type === 'lane-remove') {
    const remaining = current.filter(({ key }) => key !== action.key);
    if (!remaining.length) throw new Error('На рабочем столе должна остаться хотя бы одна стопка.');
    const target = remaining.find(({ key }) => key === action.target) ?? remaining[0];
    return {
      lanes: remaining,
      items: [...items.filter((item) => item.lane !== action.key),
        ...items.filter((item) => item.lane === action.key).map((item) => ({ ...item, lane: target.key }))],
    };
  }
  const nextAction = action.type === 'place' && !current.some(({ key }) => key === action.lane)
    ? { ...action, lane: current[0].key } : action;
  return { lanes, items: applyDesk(items, nextAction) };
}

const path = '/auth/me/desk';
const userId = () => String(session.realUser?.id || session.realUser?._id || '');

const stores = new Map();
export function deskStorage() {
  const owner = userId();
  if (!stores.has(owner)) stores.set(owner, makeStorage(owner));
  return stores.get(owner);
}

function makeStorage(owner) {
  const listeners = new Set();
  const key = 'dc-desk-pending:' + PREFIX + ':' + owner;
  const mayWrite = () => !!owner && owner === userId() && !viewAsActive(session.realUser);
  let pending = [];
  if (mayWrite()) try {
    const saved = JSON.parse(sessionStorage.getItem(key) || '[]');
    if (Array.isArray(saved)) pending = saved;
  } catch { /* Если вкладка очистила журнал, открываем сохранённый стол. */ }
  const persist = () => { try {
    if (pending.length) sessionStorage.setItem(key, JSON.stringify(pending));
    else sessionStorage.removeItem(key);
  } catch { /* В приватной вкладке операции остаются в памяти. */ } };

  let base = null, saving = false, error = null, loading = false;
  const visible = () => pending.reduce(applyDeskLayout, base ?? { items: [] });
  const state = () => {
    let layout = base ?? { items: [] };
    try { layout = visible(); } catch (e) { error ||= e; }
    return { items: layout.items, lanes: layout.lanes ?? defaultLanes(),
      ready: !!base, saving: saving || (!!pending.length && !error), error, loading };
  };
  const notify = () => listeners.forEach((changed) => changed(state()));
  let write = null, read = null;
  function flush() {
    if (write) return write;
    write = flushPending().finally(() => { write = null; });
    return write;
  }
  async function flushPending() {
    if (!base || saving || !pending.length || !mayWrite()) return;
    saving = true; error = null; notify();
    let conflicts = 0;
    try {
      while (pending.length && mayWrite()) {
        const layout = applyDeskLayout(base, pending[0]);
        try {
          base = await api(path, { method: 'PUT', body: { version: base.version, ...layout }, noWait: true, quiet: true });
          pending.shift(); persist(); conflicts = 0;
        } catch (e) {
          if (e?.status !== 409 || ++conflicts > 3 || !mayWrite()) throw e;
          base = await api(path, { quiet: true });
        }
      }
    } catch (e) { error = e; }
    finally { saving = false; notify(); }
  }
  function load() {
    if (read) return read;
    read = loadLatest().finally(() => { read = null; });
    return read;
  }
  async function loadLatest() {
    if (saving || loading || owner !== userId()) return;
    loading = true; error = null; notify();
    try { base = await api(path, { quiet: true }); }
    catch (e) { error = e; }
    finally { loading = false; notify(); }
    if (!error) await flush();
  }
  return {
    state, load,
    async synced() {
      await flush();
      if (pending.length) throw error || new Error('Дождитесь сохранения задачи и попробуйте снова.');
    },
    subscribe(changed) { listeners.add(changed); return () => listeners.delete(changed); },
    retry() { return base ? flush() : load(); },
    discard() { if (!saving) { pending = []; error = null; persist(); notify(); return load(); } },
    dispatch(action) {
      if (!base || !mayWrite()) return;
      applyDeskLayout(visible(), action);
      pending.push(action); persist(); notify(); void flush();
    },
  };
}
