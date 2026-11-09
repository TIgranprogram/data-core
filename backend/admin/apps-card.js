/* C057: карточка «Скачать приложение» на вкладке «Подключение».
 * Файл кладёт выкладка; скачать может только админ — поэтому fetch с токеном, не ссылка. */
async function loadAppCard() {
  const info = $('#cx-app-info'), btn = $('#cx-app-dl');
  if (!info || !btn) return;
  try {
    const a = await api('/apps/pdm-loader');
    info.textContent = `Версия ${a.version} · ${(a.size / 1048576).toFixed(0)} МБ · выложено ${fmtDate(a.uploadedAt)}`;
    btn.hidden = false;
  } catch (e) {
    btn.hidden = true;
    info.textContent = e.status === 404 ? 'Приложение ещё не выложено — оно появится после ближайшей выкладки сайта.'
      : e.status === 403 ? 'Скачать может только администратор.' : 'Не удалось проверить: ' + e.message;
  }
}

function wireAppCardDownload() {
  const btn = $('#cx-app-dl');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', async (ev) => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Скачиваю…';
    try {
      const r = await authFetch('/apps/pdm-loader/download');
      if (!r.ok) throw new Error(r.status === 404 ? 'Приложение ещё не выложено' : `ошибка ${r.status}`);
      const url = URL.createObjectURL(await r.blob());
      const link = Object.assign(document.createElement('a'), { href: url, download: 'DataCore.PdmLoader.exe' });
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) { toast('Не скачалось: ' + e.message); }
    finally { b.disabled = false; b.textContent = 'Скачать приложение'; }
  });
}

wireAppCardDownload();
