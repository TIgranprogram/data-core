// Обход экранов «Рабочего места» на стенде: ищет «детские» дефекты, которые видит пользователь.
//   node tools/screen-walk.mjs [адрес=http://localhost:3102]   (вход — tools/logs/stand-login.local.env: STAND_LOGIN, STAND_PASSWORD)
// Для каждого пункта меню: открыть, открыть первую запись и панель «Новый/Добавить»; собрать
//  - тексты и подсказки с «[object », undefined, NaN, null, Invalid Date, метками {…} (правило — pwa/core/garbage.js);
//  - заголовки правых панелей из одного общего слова («Изменить», «Новый», «Карточка»);
//  - ошибки консоли и ответы сервера 5xx.
// Только чтение: ничего не сохраняет. Без зависимостей: Edge/Chrome по Chrome DevTools Protocol. Код выхода: 0 чисто · 1 находки · 2 сбой.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || process.env.STAND_URL || 'http://localhost:3102').replace(/\/+$/, '').replace(/\/app$/, '');
const { GARBAGE } = await import(pathToFileURL(path.join(ROOT, 'backend/pwa/core/garbage.js')).href);

const envFile = path.join(ROOT, 'tools/logs/stand-login.local.env');
// Переменные окружения STAND_LOGIN / STAND_PASSWORD (так зовёт ночной прогон) главнее файла.
const fromFile = fs.existsSync(envFile)
  ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]))
  : {};
const cfg = { STAND_LOGIN: process.env.STAND_LOGIN || fromFile.STAND_LOGIN, STAND_PASSWORD: process.env.STAND_PASSWORD || fromFile.STAND_PASSWORD };
if (!cfg.STAND_LOGIN || !cfg.STAND_PASSWORD) { console.log('В stand-login.local.env пусты STAND_LOGIN / STAND_PASSWORD'); process.exit(2); }

const main = fs.readFileSync(path.join(ROOT, 'backend/pwa/main.js'), 'utf8');
const sections = [...(main.match(/const NAV = \[(.+?)\];/s)?.[1] ?? '').matchAll(/\['(\w+)',\s*'/g)].map((m) => m[1]);
if (!sections.length) { console.log('Не нашёл меню (NAV) в backend/pwa/main.js'); process.exit(2); }

const exe = [process.env.EDGE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
if (!exe) { console.log('Не найден Chrome/Edge'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 9800 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'screen-walk-'));
const br = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const finish = async (code) => { try { ws?.close(); } catch { /* уже закрыт */ } br.kill(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* занят */ } process.exit(code); };

let ws, list;
for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch { /* ждём браузер */ } await sleep(200); }
if (!list?.length) { console.log('Браузер не запустился'); await finish(2); }
ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const wait = new Map(); let events = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') events.push('исключение: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 120));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') events.push('консоль: ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 140));
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 500) events.push(`сервер ${m.params.response.status}: ${m.params.response.url.replace(BASE, '').split('?')[0]}`);
});
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cmd('Runtime.enable'); await cmd('Network.enable'); await cmd('Page.enable');
await cmd('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await cmd('Page.navigate', { url: BASE + '/app/' }); await sleep(2000);
const loginJson = await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:${JSON.stringify(cfg.STAND_LOGIN)},password:${JSON.stringify(cfg.STAND_PASSWORD)}})}).then(r=>r.text()).catch(()=>'')`);
let login = {}; try { login = JSON.parse(loginJson); } catch { /* не json */ }
if (!login.access) { console.log(`Вход на ${BASE} не удался (стенд не поднят или неверный логин)`); await finish(2); }
await ev(`localStorage.setItem('dca_access',${JSON.stringify(login.access)});localStorage.setItem('dca_refresh',${JSON.stringify(login.refresh ?? '')});localStorage.setItem('dca_user',${JSON.stringify(JSON.stringify(login.user ?? {}))});1`);
await cmd('Page.reload', { ignoreCache: true }); await sleep(2500);

const settle = `new Promise(r=>{let n=0;const t=setInterval(()=>{const b=document.querySelector('.is-loading,.skeleton,[aria-busy="true"]');if(!b||++n>30){clearInterval(t);r(1)}},100)})`;
const OPEN_ROW = `(()=>{const row=document.querySelector('table.list tbody tr:not(.static):not(.group-row), article.tcard, .gal > *, article.db-order .db-oh');if(!row)return 0;row.click();return 1})()`;
const OPEN_NEW = `(()=>{const b=[...document.querySelectorAll('main button, .toolbar button, .panel button')].find(x=>x.offsetParent&&!x.disabled&&/^\\s*(\\+|Нов|Добав|Создать)/.test(x.innerText||''));if(!b)return 0;b.click();return 1})()`;
const CLOSE = `(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const c=document.querySelector('.drawer-back');if(c)c.click();return 1})()`;
const SCAN = `(()=>{const re=new RegExp(${JSON.stringify(GARBAGE.source)},'u');const bad=[];
  const seen=new Set();const add=(k,t)=>{t=String(t).replace(/\\s+/g,' ').trim();if(t&&!seen.has(k+t)){seen.add(k+t);bad.push(k+': '+t.slice(0,90))}};
  for(const l of document.body.innerText.split('\\n')) if(re.test(l)) add('текст',l);
  for(const el of document.querySelectorAll('[title],[aria-label],[placeholder]')) for(const a of ['title','aria-label','placeholder']){const v=el.getAttribute(a);if(v&&re.test(v))add(a,v)}
  const GENERIC=/^(изменить|новый|новая|новое|карточка|редактировать|добавить|создать|просмотр)$/i;
  const heads=[...document.querySelectorAll('.drawer h2')].filter(h=>h.offsetParent).map(h=>h.innerText.trim());
  for(const t of heads) if(GENERIC.test(t)) add('заголовок панели из одного слова',t);
  return bad})()`;

const found = [];
let screens = 0, panels = 0;
for (const sec of sections) {
  events = [];
  await ev(`location.hash=${JSON.stringify('#' + sec)};1`);
  await sleep(600); await ev(settle);
  screens++;
  const here = [...(await ev(SCAN) || [])];
  for (const [name, expr] of [['запись', OPEN_ROW], ['новая', OPEN_NEW]]) {
    if (await ev(expr)) {
      panels++; await sleep(900); await ev(settle);
      here.push(...((await ev(SCAN)) || []).map((x) => `[${name}] ${x}`));
      await ev(CLOSE); await sleep(400);
      await ev(`location.hash=${JSON.stringify('#' + sec)};1`); await sleep(300);
    }
  }
  const all = [...new Set([...here, ...events])];
  for (const x of all) found.push(`${sec}: ${x}`);
}
const total = found.length;
console.log(`Обход ${BASE}/app/: экранов ${screens}, панелей ${panels}, находок ${total}`);
for (const f of found.slice(0, 12)) console.log('  ' + f);
if (total > 12) console.log(`  … и ещё ${total - 12}`);
await finish(total ? 1 : 0);
