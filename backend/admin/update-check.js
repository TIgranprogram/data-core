/* Новая версия админки (просьба пользователя 2026-10-31: «обновление приходит — админка обновляется или надо догадываться?»).
 * Отпечаток — ETag/Last-Modified файла admin.js (выкладка меняет его). Проверка — раз в 2 минуты и при возврате в окно.
 * Изменился: окно в фоне — перезагрузка сама; окно открыто — полоса «Админка обновилась · Обновить» (не сбивать ввод). */
(function () {
  const probe = () => fetch('admin.js', { method: 'HEAD', cache: 'no-store' })
    .then((r) => (r.ok ? r.headers.get('etag') || r.headers.get('last-modified') : null)).catch(() => null);
  let first = null; let bar = null;
  function show() {
    if (bar) return;
    bar = document.createElement('div');
    bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9999;display:flex;gap:12px;align-items:center;padding:10px 16px;border-radius:10px;background:var(--surface,#fff);color:var(--text,#111);border:1px solid var(--border,#ccc);box-shadow:0 6px 24px rgba(0,0,0,.18);font:inherit';
    const t = document.createElement('span'); t.textContent = 'Админка обновилась';
    const b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-primary'; b.textContent = 'Обновить';
    b.onclick = () => location.reload();
    bar.append(t, b); document.body.append(bar);
  }
  async function check() {
    const v = await probe(); if (!v) return;
    if (first === null) { first = v; return; }
    if (v === first) return;
    if (document.visibilityState === 'hidden') location.reload(); else show();
  }
  check();
  setInterval(check, 120000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
})();
