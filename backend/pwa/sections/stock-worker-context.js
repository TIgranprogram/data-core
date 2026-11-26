import { workerMaterialId } from './stock-worker-model.js';

const pageSize = 20;
const listKinds = ['requests', 'reservations'];
const pathOf = (id, kind) => '/stock/items/' + encodeURIComponent(id) + '/' + kind;
const viewClosed = new Error('Подстрока закрыта.');
export const contextCancelled = error => error === viewClosed;
const knownRejection = error => [400, 403, 404, 409, 422, 429].includes(error?.status);
const newList = () => ({ items: [], page: 0, more: true, pending: null, error: null });
const resetLists = state => { for (const kind of listKinds) state[kind] = newList(); };
const readList = ({ items, page, more, error }) => ({ items, page, more, error });
function uuidV4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  // На HTTP-стенде randomUUID недоступен, но getRandomValues остаётся доступным.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

/** Ленивые адресные страницы и намерение заказа принадлежат рабочему экрану. */
export function workerStockContext(api, { storage, actorId, uuid = uuidV4 } = {}) {
  const cache = new Map(), queue = [];
  let active = 0, destroyed = false;

  function pump() {
    while (!destroyed && active < 2 && queue.length) {
      const task = queue.shift();
      active++;
      Promise.resolve().then(() => {
        if (destroyed || task.cancelled()) throw viewClosed;
        return task.load();
      }).then(task.resolve, task.reject).finally(() => { active--; pump(); });
    }
  }
  function request(load, cancelled, clear) {
    const pending = new Promise((resolve, reject) => queue.push({ load, cancelled, resolve, reject, clear }));
    pump();
    return pending;
  }
  function cancelQueued() {
    for (const task of queue.splice(0)) { task.clear(); task.reject(viewClosed); }
  }
  function persist(state, intent) {
    state.intent = intent;
    try {
      if (state.key && intent) storage?.setItem(state.key, JSON.stringify({ qty: intent.qty, clientUid: intent.clientUid }));
      else if (state.key) storage?.removeItem(state.key);
    } catch { /* Недоступное хранилище: намерение всё равно остаётся на экране. */ }
  }
  function stateOf(id) {
    if (cache.has(id)) return cache.get(id);
    const key = actorId ? 'dc-stock-request:' + actorId + ':' + id : null;
    let intent = null;
    try {
      const saved = key ? JSON.parse(storage?.getItem(key) || 'null') : null;
      if (Number.isFinite(saved?.qty) && saved.qty > 0 && /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(saved.clientUid)) {
        intent = { ...saved, uncertain: true };
      }
    } catch { /* Повреждённый черновик не используется. */ }
    const state = { key, intent, requests: newList(), reservations: newList(), saving: false, result: null };
    cache.set(id, state);
    return state;
  }
  function fetchPage(id, state, kind, { more = false, retry = false } = {}) {
    if (destroyed) return Promise.reject(viewClosed);
    const list = state[kind];
    if (list.pending) return list.pending;
    if (list.error && !retry) return Promise.reject(list.error);
    if (!list.more || (list.page && !more && !retry)) return Promise.resolve(readList(list));
    const page = list.page + 1;
    list.error = null;
    const cancelled = () => state[kind] !== list;
    const clear = () => { if (list.pending === pending) list.pending = null; };
    const pending = request(() => api(pathOf(id, kind), { query: { page, limit: pageSize }, quiet: true }), cancelled, clear)
      .then(response => {
        if (destroyed || cancelled()) throw viewClosed;
        const { items, total, limit } = response ?? {};
        if (!Array.isArray(items) || !Number.isInteger(total) || total < 0 || !Number.isInteger(limit) || limit < 1
          || response.page !== page || (!items.length && (page - 1) * limit < total)) {
          throw new Error('Сервер вернул неполную страницу.');
        }
        list.items = [...new Map([...list.items, ...items].map(row => [row.id, row])).values()];
        list.page = page;
        list.more = page * limit < total;
        return readList(list);
      })
      .catch(error => {
        if (!destroyed && !cancelled() && error !== viewClosed) list.error = error;
        throw error;
      })
      .finally(clear);
    list.pending = pending;
    return pending;
  }
  async function order(id, item, state, qty, { readOnly, additional } = {}) {
    const list = state.requests;
    if (destroyed || readOnly) throw new Error('Создание заявки недоступно.');
    if (!item.unit?.trim()) throw new Error('У материала не указана единица учёта.');
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Введите положительное количество.');
    if (state.saving) throw new Error('Заявка уже отправляется.');
    if (!list.page || list.error || list.more) throw new Error('Сначала загрузите все открытые заявки этого материала.');
    if (state.intent && state.intent.qty !== qty) throw new Error('Сначала повторите отправку предыдущей заявки с тем же количеством.');
    if (!state.intent && list.items.length && !additional) throw new Error('Подтвердите дополнительную заявку.');
    const intent = state.intent || { qty, clientUid: uuid(), uncertain: false };
    persist(state, intent);
    state.result = null;
    state.saving = true;
    try {
      const result = await api(pathOf(id, 'request'), { method: 'POST', body: { qty, clientUid: intent.clientUid }, noWait: true });
      if (!result?.id || result.queued || result.materialId !== id) {
        throw new Error('Создание пока не подтверждено. Повторите отправку с тем же количеством.');
      }
      persist(state, null);
      state.result = result;
      state.requests = newList();
      return result;
    } catch (error) {
      if (knownRejection(error) && !intent.uncertain) persist(state, null);
      else intent.uncertain = true;
      throw error;
    } finally { state.saving = false; }
  }

  return {
    begin() { cancelQueued(); cache.forEach(resetLists); },
    cancelQueued,
    invalidate(id) {
      const state = cache.get(id);
      if (state) resetLists(state);
    },
    destroy() { destroyed = true; cancelQueued(); cache.clear(); },
    material(item) {
      const id = workerMaterialId(item), state = stateOf(id);
      return {
        requests: options => fetchPage(id, state, 'requests', options),
        reservations: options => fetchPage(id, state, 'reservations', options),
        order(quantity, options) {
          const wasSaving = state.saving;
          const pending = order(id, item, state, quantity, options);
          if (!wasSaving && state.saving) {
            state.pendingOrder = pending;
            const clear = () => { if (state.pendingOrder === pending) state.pendingOrder = null; };
            pending.then(clear, clear);
          }
          return pending;
        },
        get pendingOrder() { return state.pendingOrder; },
        get orderState() { return { pendingQty: state.intent?.qty, saving: state.saving, result: state.result }; },
      };
    },
  };
}
