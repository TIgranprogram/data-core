// Личный порядок, сроки и задачи хранятся отдельно от состояния исходной записи.
import { api, PREFIX, session } from '../core/api.js';
import { viewAsActive } from '../core/view-as.js';

export const LANES = [
  { key: 'focus', title: 'В фокусе', empty: 'Перенесите сюда то, над чем работаете сейчас.' },
  { key: 'next', title: 'Дальше', empty: 'Сложите дела, к которым вернётесь дальше.' },
  { key: 'waiting', title: 'Жду', empty: 'Оставьте здесь то, где нужен ответ или результат.' },
];
export const keyOf = (item) => item.of + ':' + item.id;

function applyFields(value, patch) {
  const next = { ...value, ...patch };
  if (next.due == null) delete next.due;
  return next;
}

export function applyDesk(items, action) {
  const current = items.find((item) => keyOf(item) === action.key);
  if (action.type === 'remove') return items.filter((item) => item !== current);
  if (action.type === 'place') {
    if (!current && !action.item) return items;
    if (!current && items.length >= 60) throw new Error('На столе 60 карточек. Освободите место и попробуйте ещё раз.');
    const next = applyFields(current || action.item, { lane: action.lane });
    const remaining = items.filter((item) => item !== current);
    const before = remaining.findIndex((item) => item.lane === action.lane && keyOf(item) === action.before);
    remaining.splice(before < 0 ? remaining.length : before, 0, next);
    return remaining;
  }
  if (!current) return items;
  return items.map((item) => {
    if (item !== current) return item;
    if (action.type === 'edit') return applyFields(item, action.patch);
    const tasks = item.tasks || [];
    if (action.type === 'task-remove') return { ...item, tasks: tasks.filter((task) => task.id !== action.id) };
    const existing = tasks.find((task) => task.id === action.id);
    if (existing) return { ...item, tasks: tasks.map((task) => task === existing ? applyFields(task, action.patch) : task) };
    if (!action.task) return item;
    if (tasks.length >= 12) throw new Error('В карточке уже 12 задач. Уберите завершённую, чтобы добавить новую.');
    return { ...item, tasks: [...tasks, applyFields(action.task)] };
  });
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
  const visible = () => pending.reduce(applyDesk, base?.items || []);
  const state = () => {
    let items = base?.items || [];
    try { items = visible(); } catch (e) { error ||= e; }
    return { items, ready: !!base, saving: saving || (!!pending.length && !error), error, loading };
  };
  const notify = () => listeners.forEach((changed) => changed(state()));
  async function flush() {
    if (!base || saving || !pending.length || !mayWrite()) return;
    saving = true; error = null; notify();
    let conflicts = 0;
    try {
      while (pending.length && mayWrite()) {
        const items = applyDesk(base.items, pending[0]);
        try {
          base = await api(path, { method: 'PUT', body: { version: base.version, items }, noWait: true, quiet: true });
          pending.shift(); persist(); conflicts = 0;
        } catch (e) {
          if (e?.status !== 409 || ++conflicts > 3 || !mayWrite()) throw e;
          base = await api(path, { quiet: true });
        }
      }
    } catch (e) { error = e; }
    finally { saving = false; notify(); }
  }
  async function load() {
    if (saving || loading || owner !== userId()) return;
    loading = true; error = null; notify();
    try { base = await api(path, { quiet: true }); }
    catch (e) { error = e; }
    finally { loading = false; notify(); }
    if (!error) await flush();
  }
  return {
    state, load,
    subscribe(changed) { listeners.add(changed); return () => listeners.delete(changed); },
    retry() { return base ? flush() : load(); },
    discard() { if (!saving) { pending = []; error = null; persist(); notify(); return load(); } },
    dispatch(action) {
      if (!base || !mayWrite()) return;
      applyDesk(visible(), action);
      pending.push(action); persist(); notify(); void flush();
    },
  };
}
