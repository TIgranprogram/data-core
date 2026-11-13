# Как войти встроенным браузером на стенд :3102

Для живой приёмки интерфейса (снимки «Рабочего места»). Только изолированный стенд `http://localhost:3102`. Прод — нельзя (`api.sh` пускает BROWSER только для `stand`).

## Почему так

- CSP стенда — `connect-src 'self'`: страница стенда не может запросить токены с другого порта.
- COOP `same-origin` стирает `window.name` при переходе на стенд.
- Cookie не зависят от порта. Поэтому токены передаются одноразовой cookie с `localhost:3199` на `localhost:3102`.
- Токены не пишутся в файлы и не попадают в вывод. Печатается только одноразовая ссылка (живёт 120 с, срабатывает один раз).

## Шаги

1. Агент `datacore-access` (haiku) из корня запускает в фоне:
   `nohup bash deploy/synology/api.sh stand BROWSER tools/logs/stand-browser-login.mjs > tools/logs/stand-browser-login.out 2>&1 &`
   и возвращает строку со ссылкой `http://localhost:3199/<код>` из `tools/logs/stand-browser-login.out`.
2. Координатор за 120 с открывает ссылку во встроенном браузере (`mcp__Claude_Browser__navigate`). Сервер ставит cookie `dc_handoff_a`/`dc_handoff_r` (Path `/app/`, 2 мин) и уводит на `http://localhost:3102/app/`.
3. На `/app/` один вызов `javascript_tool` переносит вход в `localStorage` и удаляет cookie. Значения не возвращаются:

```js
(async()=>{const c=Object.fromEntries(document.cookie.split('; ').filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]}));const a=c.dc_handoff_a,r=c.dc_handoff_r;for(const k of ['dc_handoff_a','dc_handoff_r'])document.cookie=k+'=; Path=/app/; Max-Age=0';if(!a||!r)return 'нет передачи (ссылка устарела?)';const me=await fetch('/api/auth/me',{headers:{Authorization:'Bearer '+a}});if(!me.ok)return 'auth/me HTTP'+me.status;localStorage.setItem('dca_access',a);localStorage.setItem('dca_refresh',r);localStorage.setItem('dca_user',JSON.stringify(await me.json()));location.replace('/app/');return 'вход выполнен'})()
```

4. Открывается «Рабочее место» под тестовой учёткой «Проверка». Дальше — обычные `navigate` / `screenshot`. Вход держится через `dca_refresh`; повторять шаги нужно только после выхода или очистки хранилища.

## Сценарий `tools/logs/stand-browser-login.mjs`

Папка `tools/logs/` не в git (а `api.sh` берёт сценарии только оттуда). Если файла нет — создать его из текста ниже.

```js
import http from 'node:http';
import crypto from 'node:crypto';
const chunks = []; for await (const c of process.stdin) chunks.push(c);
const s = JSON.parse(Buffer.concat(chunks));
if (!s.access || !s.refresh) { console.error('нет токенов'); process.exit(2); }
const nonce = crypto.randomBytes(24).toString('hex');
const port = Number(process.env.HANDOFF_PORT || 3199);
const ttl = 120;
const target = 'http://localhost:3102/app/';
const cookie = (k, v) => `${k}=${encodeURIComponent(v)}; Path=/app/; Max-Age=${ttl}; SameSite=Strict`;
let done = false;
const handler = (req, res) => {
  if (done || req.url !== '/' + nonce) { res.writeHead(404).end(); return; }
  done = true;
  res.writeHead(302, { Location: target, 'Set-Cookie': [cookie('dc_handoff_a', s.access), cookie('dc_handoff_r', s.refresh)], 'Cache-Control': 'no-store' }).end();
  console.log('Передано в браузер. Сценарий завершён.');
  setTimeout(() => process.exit(0), 300);
};
const servers = ['127.0.0.1', '::1'].map(host => { const srv = http.createServer(handler); srv.on('error', () => {}); srv.listen(port, host); return srv; });
servers[0].on('listening', () => console.log(`Открыть во встроенном браузере (одноразово, ${ttl} с): http://localhost:${port}/${nonce}`));
servers[0].on('error', e => { console.error('порт занят:', e.code); process.exit(2); });
setTimeout(() => { console.error('Ссылку не открыли за ' + ttl + ' с — повторите.'); process.exit(1); }, ttl * 1000);
```

## Пробный вход — 2026-11-12

Хранилище стенда в браузере очищено → экран «Вход». Ссылка от `datacore-access` открыта → `javascript_tool` вернул «вход выполнен» → «Сегодня · Рабочее место», «Добрый вечер, Проверка». Сценарий напечатал «Передано в браузер» и завершился, порт 3199 свободен.
