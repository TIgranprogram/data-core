/* Service worker «Рабочее место» (CANON §3): кэширует только оболочку — данные всегда с сервера.
 * Оболочка (html/css/js/иконки) — «сеть, иначе кэш»: при сети всегда свежая версия.
 * Фото (/uploads/*) — «кэш, иначе сеть»: файлы неизменяемые (uuid в имени).
 */
const SHELL = 'dc-app-shell-v8';
const PHOTOS = 'dc-app-photos-v1';
const SHELL_FILES = ['./', './index.html', './main.js', './ui/tokens.css', './ui/base.css', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

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
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html'))),
  );
});
