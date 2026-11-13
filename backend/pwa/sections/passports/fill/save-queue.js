/** После ошибки последующие правки ждут повтора. Старый ввод не исчезает при удачной соседней записи.
 *  Р2 (C112): если сервер на паузе записи (503 READ_ONLY, retryAfter) или нет связи, очередь сама повторяет
 *  через delayOf(e) мс (до max раз подряд); пользователь видит «сохраню, когда сервер вернётся» через onWait/onResume.
 *  Явные retry()/discard() работают как раньше. Без опции auto поведение прежнее. */
export function saveQueue({ auto } = {}) {
  let tail = Promise.resolve(); let failed = []; let retrying = null;
  let timer = null; let tries = 0;
  const pending = new Set();
  const setTimer = auto?.setTimer || ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = auto?.clearTimer || ((t) => clearTimeout(t));
  const stopTimer = () => { if (timer != null) { clearTimer(timer); timer = null; } };
  const schedule = (e) => {
    const ms = auto?.delayOf ? auto.delayOf(e) : 0;
    if (!(ms > 0) || tries >= (auto.max || 5) || timer != null) return;
    tries++;
    auto.onWait?.(ms, e, tries);
    timer = setTimer(() => { timer = null; if (failed.length) api.retry().then(() => { if (!failed.length) auto.onResume?.(); }, () => {}); }, ms);
  };
  const add = (job) => {
    const task = tail.catch(() => {}).then(async () => {
      if (failed.length) { failed.push(job); return false; }
      try { const out = await job(); tries = 0; return out; } catch (e) { failed.push(job); schedule(e); throw e; }
    });
    tail = task; pending.add(task);
    task.then(() => pending.delete(task), () => pending.delete(task));
    return task;
  };
  const api = {
    pending, add, failed: () => failed.length > 0, waiting: () => timer != null,
    retry: () => {
      stopTimer();
      if (retrying) return retrying;
      retrying = (async () => {
        await Promise.allSettled([...pending]);
        const jobs = failed; failed = [];
        return add(async () => { for (const job of jobs) await job(); });
      })().finally(() => { retrying = null; });
      return retrying;
    },
    discard: async () => { stopTimer(); tries = 0; if (retrying) await retrying.catch(() => {}); await Promise.allSettled([...pending]); failed = []; },
  };
  return api;
}
