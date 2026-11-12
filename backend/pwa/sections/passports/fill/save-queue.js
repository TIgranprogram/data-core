/** После ошибки последующие правки ждут явного повтора. Старый ввод не исчезает при удачной соседней записи. */
export function saveQueue() {
  let tail = Promise.resolve(); let failed = []; let retrying = null;
  const pending = new Set();
  const add = (job) => {
    const task = tail.catch(() => {}).then(async () => {
      if (failed.length) { failed.push(job); return false; }
      try { return await job(); } catch (e) { failed.push(job); throw e; }
    });
    tail = task; pending.add(task);
    task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  return {
    pending, add, failed: () => failed.length > 0,
    retry: () => {
      if (retrying) return retrying;
      retrying = (async () => {
        await Promise.allSettled([...pending]);
        const jobs = failed; failed = [];
        return add(async () => { for (const job of jobs) await job(); });
      })().finally(() => { retrying = null; });
      return retrying;
    },
    discard: async () => { if (retrying) await retrying.catch(() => {}); await Promise.allSettled([...pending]); failed = []; },
  };
}
