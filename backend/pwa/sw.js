/* Service worker «Рабочее место» (CANON §3): кэширует только оболочку — данные всегда с сервера.
 * Оболочка (html/css/js/шрифты/иконки) — по версии выкладки: `version.json` (кладёт release.sh) проверяется при каждом
 * открытии приложения; версия та же — файлы из кэша (мгновенно, без ~70 запросов через туннель), новая — кэш
 * очищается и файлы берутся с сервера. Нет version.json (стенд, локально) — «сеть, иначе кэш», как раньше.
 * Фото (/uploads/*) — «кэш, иначе сеть»: файлы неизменяемые (uuid в имени).
 */
const SHELL = 'dc-app-shell-v27';
const PHOTOS = 'dc-app-photos-v1';
const SHELL_FILES = ['./', './index.html', './main.js', './ui/tokens.css', './ui/base.css', './ui/list.css', './ui/form.css', './ui/screens.css', './ui/panels.css', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];
const VER_KEY = './__version';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, PHOTOS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Версия выкладки: сверить с сервером, при смене — очистить оболочку. null — версий нет (стенд). */
async function syncVersion() {
  const cached = async () => { const hit = await caches.match(VER_KEY); return hit ? hit.text() : null; };
  let v;
  try {
    const r = await fetch('version.json', { cache: 'no-store' });
    if (!r.ok) return null;
    v = (await r.json()).v;
  } catch { return cached(); } // нет сети — работаем тем, что в кэше
  if (!v) return null;
  if ((await cached()) !== v) {
    await caches.delete(SHELL);
    await (await caches.open(SHELL)).put(VER_KEY, new Response(v));
  }
  return v;
}
let ver = null; // проверка версии — одна на открытие приложения (и после перезапуска самого SW)

async function fromNetwork(req) {
  try {
    const res = await fetch(req);
    if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); } // клон — сразу, пока тело не прочитано
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
    // страница — всегда с сервера; параллельно — сверка версии, чтобы модули после неё брались уже из верного кэша
    const net = fetch(req);
    net.catch(() => {}); // ошибка разбирается ниже
    ver = syncVersion();
    e.respondWith((async () => {
      await ver.catch(() => null);
      try {
        const res = await net;
        if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
        return res;
      } catch {
        return (await caches.match(req)) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }
  e.respondWith((async () => {
    const v = await (ver ??= syncVersion()).catch(() => null);
    if (!v) return fromNetwork(req);
    const hit = await caches.match(req);
    return hit || fromNetwork(req);
  })());
});
