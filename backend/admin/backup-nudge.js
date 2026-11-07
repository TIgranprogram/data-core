/* Напоминание администратору о копии на компьютере (КОПИЯ-НАПОМИНАНИЕ, 2026-11-07): один запрос при входе в админку,
 * без фонового опроса. Вынесено из admin.js (файл и так длиннее 400 строк). Помощники передаёт admin.js при вызове. */
(function () {
  // ---- Напоминание при входе: копия на компьютере устарела? (один запрос при открытии админки, без опроса; сама не качает) ----
  window.backupNudge = async function backupNudge({ api, $, el, store, saveBackup, toast }) {
    const box = $('#backup-nudge');
    box.hidden = true;
    if (!store.user || !['admin', 'director'].includes(store.user.role)) return;
    try {
      const r = await api('/health/backups/reminder');
      const fmt = (v) => new Date(v).toLocaleDateString('ru-RU');
      if (r.lastDownloadAt && !r.releasesSince) return; // копия свежее последнего обновления сайта
      const prog = el('span', 'muted srv-prog');
      const text = r.lastDownloadAt
        ? `Копия на вашем компьютере от ${fmt(r.lastDownloadAt)}, после неё ${r.releasesSince} ${pluralRu(r.releasesSince, 'обновление', 'обновления', 'обновлений')} сайта — сохранить свежую?`
        : 'Копию на компьютер ещё не сохраняли — сохранить?';
      const b = el('button', 'btn small', 'Сохранить копию на диск'); b.type = 'button';
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          const d = await api('/health/backups');
          const it = d.items && d.items[0];
          if (!it) { toast('Копий на сервере пока нет — они создаются ночью'); return; }
          await saveBackup(it.stamp, 'all', prog, it.single);
          if (!prog.textContent) box.hidden = true;
        } catch (e) { toast('Не удалось начать: ' + e.message); } finally { b.disabled = false; }
      });
      box.replaceChildren(el('p', null, text), b, prog); box.hidden = false;
    } catch { /* напоминание не обязательно */ }
  }
  // склонение — для текста напоминания
  const pluralRu = (n, a, b, c) => { const m = Math.abs(n) % 100, d = m % 10; return m > 10 && m < 20 ? c : d > 1 && d < 5 ? b : d === 1 ? a : c; };
})();
