// Снимки «Рабочего места» на любой ширине экрана (CANON §2: 1920/2560/1024/390) — стенд docker-compose.qa.yml.
// Headless Edge + DevTools-протокол, без установки пакетов. Встроенный браузер шире своей панели не показывает.
// QA_DIR=<папка в scratchpad с qa-login.txt> node backend/scripts/qa-screenshot.mjs <ширина> <высота> <#раздел?..|/admin/> <файл.png> [js-после-загрузки]
// Вход один раз (лимит входов 5/мин), токены кэшируются в QA_DIR/qa-tokens.json.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
const [W, H, HASH, OUT, AFTER] = process.argv.slice(2);
const dir = process.env.QA_DIR || process.cwd();
const PW = fs.readFileSync(path.join(dir, 'qa-login.txt'), 'utf8').trim();
const port = 9300 + Math.floor(Math.random() * 500);
const prof = path.join(dir, 'edge-prof-' + port);
const br = spawn('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch { /* ждём */ } await sleep(200); }
const page = list.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const wait = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cmd('Emulation.setDeviceMetricsOverride', { width: +W, height: +H, deviceScaleFactor: 1, mobile: +W < 720 });
await cmd('Page.enable');
const ADMIN = HASH.startsWith('/admin');
await cmd('Page.navigate', { url: 'http://localhost:3002' + (ADMIN ? HASH : '/app/') });
await sleep(1500);
const TOK = path.join(dir, 'qa-tokens.json');
let LR;
if (fs.existsSync(TOK)) { const j = JSON.parse(fs.readFileSync(TOK, 'utf8')); LR = await ev(`localStorage.setItem('dca_access',${JSON.stringify(j.access)});localStorage.setItem('dca_refresh',${JSON.stringify(j.refresh)});localStorage.setItem('dca_user',${JSON.stringify(JSON.stringify(j.user))});'cached'`); }
else { const j = JSON.parse(await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'qa',password:${JSON.stringify(PW)}})}).then(r=>r.text())`)); if (j.access) { fs.writeFileSync(TOK, JSON.stringify(j)); LR = await ev(`localStorage.setItem('dca_access',${JSON.stringify(j.access)});localStorage.setItem('dca_refresh',${JSON.stringify(j.refresh)});localStorage.setItem('dca_user',${JSON.stringify(JSON.stringify(j.user))});'ok'`); } else LR = 'NO ' + JSON.stringify(j).slice(0, 120); }
console.log('login:', LR);
if (process.env.QA_THEME) await ev(`localStorage.setItem('dc-theme',${JSON.stringify(process.env.QA_THEME)});1`); // light | dark
if (ADMIN) {
  // Админка: токен в sessionStorage (dc_token/dc_user), тема — общая (dc-theme). Пример: '/admin/#tables'
  await ev(`sessionStorage.setItem('dc_token',localStorage.getItem('dca_access'));sessionStorage.setItem('dc_user',localStorage.getItem('dca_user'));1`);
  await cmd('Page.reload', { ignoreCache: true });
} else {
  await ev(`location.hash = ${JSON.stringify(HASH)}; 1`);
  await cmd('Page.reload', { ignoreCache: true });
}
await sleep(3000);
if (AFTER) { const res = await ev(AFTER); if (res !== undefined) console.log('after:', res); await sleep(1500); }
const shot = await cmd('Page.captureScreenshot', { format: 'png' });
fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
const errs = await ev(`JSON.stringify(window.__errs||[])`);
console.log('saved', OUT, errs || '');
ws.close(); br.kill();
await sleep(500);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* профиль занят — не важно */ }
process.exit(0);
