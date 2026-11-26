/** Группируем только соседние одинаковые типы, не меняя хронологический порядок ответа. */
export function workerOperationGroups(items) {
  const groups = [];
  for (const item of items) {
    const previous = groups.at(-1);
    if (previous && previous.type === item.type && previous.kind === item.kind) previous.items.push(item);
    else groups.push({ type: item.type, kind: item.kind, items: [item] });
  }
  return groups;
}

/** Очередь ленивой истории одного view: не более двух запросов, повторное раскрытие использует кэш. */
export function workerHistory(load) {
  const cache = new Map(), queue = [];
  let active = 0, destroyed = false;
  function pump() {
    while (!destroyed && active < 2 && queue.length) {
      const task = queue.shift(); active++;
      Promise.resolve().then(() => { if (destroyed) throw new Error('Экран закрыт'); return load(task.id); }).then(task.resolve, task.reject).finally(() => { active--; pump(); });
    }
  }
  return {
    get(id, retry = false) {
      if (destroyed) return Promise.reject(new Error('Экран закрыт'));
      if (retry) cache.delete(id);
      if (!cache.has(id)) {
        const promise = new Promise((resolve, reject) => queue.push({ id, resolve, reject }));
        cache.set(id, promise); pump();
      }
      return cache.get(id);
    },
    invalidate(id) { cache.delete(id); },
    destroy() { destroyed = true; cache.clear(); for (const task of queue.splice(0)) task.reject(new Error('Экран закрыт')); },
  };
}
