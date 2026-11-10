/* C057: карточка «Скачать приложение» на вкладке «Подключение».
 * Файл кладёт выкладка; скачать может только админ — поэтому fetch с токеном, не ссылка.
 * Помощники админки ($, api, authFetch, fmtDate, toast) живут внутри admin.js — передаются параметрами
 * (как у backup-nudge.js). 2026-11-10: раньше брались как глобальные — карточка висела на «Проверяю…». */
(function () {
  window.appsCard = async function appsCard({ $, api, authFetch, fmtDate, toast }) {
    const info = $('#cx-app-info'), btn = $('#cx-app-dl');
    if (!info || !btn) return;
    if (!btn.dataset.wired) {
      btn.dataset.wired = '1';
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = 'Скачиваю…';
        try {
          const r = await authFetch('/apps/pdm-loader/download');
          if (!r.ok) throw new Error(r.status === 404 ? 'Приложение ещё не выложено' : `ошибка ${r.status}`);
          // 2026-11-10: файл ~190 МБ — без счётчика «Скачиваю…» висит минуты и непонятно, идёт ли загрузка
          const total = Number(r.headers.get('Content-Length')) || 0;
          const mb = (n) => (n / 1048576).toFixed(0);
          const parts = []; let got = 0;
          const reader = r.body.getReader();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value); got += value.length;
            btn.textContent = total ? `Скачано ${mb(got)} из ${mb(total)} МБ (${Math.floor((got / total) * 100)} %)` : `Скачано ${mb(got)} МБ`;
          }
          btn.textContent = 'Сохраняю файл…';
          const url = URL.createObjectURL(new Blob(parts, { type: 'application/octet-stream' }));
          const link = Object.assign(document.createElement('a'), { href: url, download: 'DataCore.PdmLoader.exe' });
          document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
          toast('Файл DataCore.PdmLoader.exe сохранён в папку «Загрузки»');
        } catch (e) { toast('Не скачалось: ' + e.message); }
        finally { btn.disabled = false; btn.textContent = 'Скачать приложение'; }
      });
    }
    info.textContent = 'Проверяю…';
    try {
      const a = await api('/apps/pdm-loader');
      info.textContent = `Версия ${a.version} · ${(a.size / 1048576).toFixed(0)} МБ · выложено ${fmtDate(a.uploadedAt)}`;
      btn.hidden = false;
    } catch (e) {
      btn.hidden = true;
      info.textContent = e.status === 404 ? 'Приложение ещё не выложено — оно появится после ближайшей выкладки сайта.'
        : e.status === 403 ? 'Скачать может только администратор.' : 'Не удалось проверить: ' + e.message;
    }
  };
})();
