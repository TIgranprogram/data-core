/* Service worker «Рабочее место» (CANON §3): кэширует только оболочку — данные всегда с сервера.
 * «Сначала кэш, версия — фоном» (аудит скорости 2026-10-29): страница и модули отдаются из кэша сразу, без ожидания сети.
 * Целостность версии: кэш оболочки носит имя версии (`dc-shell-<v>`, v — из `version.json`, кладёт release.sh).
 * Указатель `cur` (какой кэш рабочий) и `pend` (новая версия, готовая к переключению) лежат в кэше `dc-app-meta`.
 *  - Страница открыта на версии A → все её модули берутся только из кэша A (или сети, если файла в кэше нет).
 *  - Вышла версия B: в фоне собирается кэш B (свежие index.html и ядро), `cur` не трогается — открытая вкладка не мешает смесью.
 *  - «Обновить» (сообщение `apply`) или свежий запуск без других окон: `cur` = B, остальные кэши удаляются, страница
 *    грузится целиком из B. Файла нет в B — сеть (а сеть уже на версии B) и кладётся в B.
 * Нет version.json (стенд, локально) — кэш `dc-shell-nov`: «сеть, иначе кэш», как раньше.
 * Фото (/uploads/*) — «кэш, иначе сеть»: файлы неизменяемые (uuid в имени).
 */
const PHOTOS = 'dc-app-photos-v1';
const META = 'dc-app-meta';
const NOV = 'dc-shell-nov';
const SHELL_FILES = ['./', './index.html', './main.js', './ui/tokens.css', './ui/base.css', './ui/list.css', './ui/form.css', './ui/screens.css', './ui/panels.css', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

const getMeta = async (k) => { try { const hit = await (await caches.open(META)).match('./__' + k); return hit ? await hit.json() : null; } catch { return null; } };
const setMeta = async (k, v) => (await caches.open(META)).put('./__' + k, new Response(JSON.stringify(v)));
const delMeta = async (k) => (await caches.open(META)).delete('./__' + k);

self.addEventListener('install', (e) => { e.waitUntil(self.skipWaiting()); });

self.addEventListener('activate', (e) => {
  e.waitUntil(cleanup().then(() => self.clients.claim()));
});

/** Удалить кэши, не нужные ни рабочей, ни новой версии (в т. ч. старый `dc-app-shell-v*`). */
async function cleanup() {
  const keep = new Set([META, PHOTOS]);
  const cur = await getMeta('cur'); const pend = await getMeta('pend');
  if (cur) keep.add(cur.name);
  if (pend) keep.add(pend.name);
  await Promise.all((await caches.keys()).filter((k) => !keep.has(k)).map((k) => caches.delete(k)));
}

/** Положить файлы оболочки в кэш по одному (канал медленный); сбой файла не страшен — подтянется при запросе. */
async function fill(name, files, fresh) {
  const c = await caches.open(name);
  for (const f of files) {
    try { if (fresh || !(await c.match(f))) { const r = await fetch(f, { cache: 'reload' }); if (r.ok) await c.put(f, r); } } catch { /* позже */ }
  }
}

let checking = null;
/** Сверить версию с сервером. Первая — становится рабочей; новая — готовится в `pend`. Одна проверка за раз. */
function check() {
  return (checking ??= (async () => {
    let r;
    try { r = await fetch('version.json', { cache: 'no-store' }); } catch { return; } // нет сети — работаем тем, что есть
    const cur = await getMeta('cur');
    if (!r.ok) { if (!cur) await setMeta('cur', { name: NOV, v: null }); return; } // версий нет (стенд)
    let j; try { j = await r.json(); } catch { return; }
    const v = j?.v;
    if (!v) { if (!cur) await setMeta('cur', { name: NOV, v: null }); return; }
    const name = 'dc-shell-' + v;
    if (!cur || !cur.v) { // первый запуск (или стенд получил версии): рабочий сразу
      await setMeta('cur', { name, v, info: j }); await delMeta('pend');
      cleanup().catch(() => {});
      fill(name, SHELL_FILES, false).catch(() => {});
      return;
    }
    if (cur.v === v) return;
    const pend = await getMeta('pend');
    if (pend?.v === v) return;
    await delMeta('pend');
    await caches.delete(name); // недособранный кэш этой версии — с нуля
    await fill(name, ['./', './index.html', './main.js'], true);
    const c = await caches.open(name);
    if (!(await c.match('./index.html'))) return; // страницу не получили — переключаться нельзя
    await setMeta('pend', { name, v, info: j });
    cleanup().catch(() => {});
    fill(name, SHELL_FILES.slice(3), false).catch(() => {});
  })().catch(() => {}).finally(() => { checking = null; }));
}

/** Переключить рабочий кэш на новую версию. true — переключили. */
async function apply() {
  const pend = await getMeta('pend');
  if (!pend) return false;
  await setMeta('cur', pend); await delMeta('pend');
  await cleanup();
  return true;
}

self.addEventListener('message', (e) => {
  const port = e.ports?.[0];
  if (e.data?.type === 'ver') { e.waitUntil(getMeta('cur').then((c) => port?.postMessage(c?.info || null))); return; } // версия, из которой открыта страница
  if (e.data?.type !== 'apply') return;
  e.waitUntil((async () => {
    try { await check(); await apply(); } catch { /* перезагрузка пройдёт и так */ }
    port?.postMessage('done');
  })());
});

async function fromNetwork(req, name) {
  try {
    const res = await fetch(req);
    if (res.ok && name) { const copy = res.clone(); caches.open(name).then((c) => c.put(req, copy)); } // клон — сразу, пока тело не прочитано
    return res;
  } catch {
    return (await caches.match(req)) || (await caches.match('./index.html')) || Response.error();
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/api/')) return;

  if (url.pathname.includes('/uploads/')) {
    e.respondWith(caches.open(PHOTOS).then(async (c) => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  const scope = new URL(self.registration.scope).pathname;
  if (!url.pathname.startsWith(scope)) return;
  if (url.pathname.endsWith('/version.json')) return; // версия — всегда с сервера (её же сверяет update-check)

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      let cur = await getMeta('cur');
      if (cur?.v) { // версионный кэш: свежий запуск (других окон нет) подхватывает готовую новую версию
        const wins = await self.clients.matchAll({ type: 'window' });
        if (wins.length <= 1 && (await apply())) cur = await getMeta('cur');
        const c = await caches.open(cur.name);
        const hit = (await c.match(req, { ignoreSearch: true })) || (await c.match('./index.html'));
        if (hit) { e.waitUntil(check()); return hit; } // страница из кэша сразу, версия — фоном
      }
      // нет кэша (первый заход) или стенд без версий: сеть, версия — параллельно
      const net = fetch(req); net.catch(() => {});
      await check();
      cur = await getMeta('cur');
      try {
        const res = await net;
        if (res.ok && cur) { const copy = res.clone(); caches.open(cur.name).then((c) => c.put(req, copy)); }
        return res;
      } catch {
        return (await caches.match(req, { ignoreSearch: true })) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const cur = await getMeta('cur');
    if (cur?.v) {
      const hit = await (await caches.open(cur.name)).match(req);
      if (hit) return hit;
    }
    return fromNetwork(req, cur?.name);
  })());
});
