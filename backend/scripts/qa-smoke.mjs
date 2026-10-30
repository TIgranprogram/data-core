// Обход всех экранов «Рабочего места» на стенде docker-compose.qa.yml: открыть раздел, открыть первую запись, собрать сбои.
// Только чтение: нажимает лишь строки списка, ничего не сохраняет. Это единственная проверка кода экранов целиком.
// QA_DIR=<папка с qa-login.txt> node backend/scripts/qa-smoke.mjs [ширина=1280] → таблица; код выхода 1, если есть сбои.
// Вход — как в qa-screenshot.mjs (пользователь qa, стенд :3002). QA_USER=qa-director — другая роль.
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const WIDTH = +(process.argv[2] || 1280);
const BASE = process.env.QA_BASE || 'http://localhost:3002';
const dir = process.env.QA_DIR || process.cwd();
const USER = process.env.QA_USER || 'qa';
const PW = fs.readFileSync(path.join(dir, USER === 'qa' ? 'qa-login.txt' : `${USER}.txt`), 'utf8').trim();
const main = fs.readFileSync(new URL('../pwa/main.js', import.meta.url), 'utf8');
const sections = [...(main.match(/const NAV = \[(.+?)\];/s)?.[1] ?? '').matchAll(/\['(\w+)',\s*'/g)].map((m) => m[1]);
// разделы и вкладки, которых нет в главном меню
const hashes = [...new Set([...sections, 'money?tab=calendar', 'money?tab=debts', 'money?tab=forecast', 'docs?tab=queue', 'docs?tab=orders', 'docs?tab=archive', 'stock', 'movements', 'dicts', 'trash', 'history', 'help'])];

const port = 9300 + Math.floor(Math.random() * 500);
const prof = path.join(dir, 'edge-smoke-' + port);
const br = spawn(process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch { /* ждём браузер */ } await sleep(200); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const wait = new Map(); let problems = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') problems.push('ошибка: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 500) problems.push(`сервер ${m.params.response.status}: ${m.params.response.url.replace(BASE, '')}`);
});
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cmd('Runtime.enable'); await cmd('Network.enable'); await cmd('Page.enable');
await cmd('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: WIDTH < 720 });
await cmd('Page.navigate', { url: BASE + '/app/' }); await sleep(1500);
const login = JSON.parse(await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:${JSON.stringify(USER)},password:${JSON.stringify(PW)}})}).then(r=>r.text())`));
if (!login.access) { console.log('вход не удался'); br.kill(); process.exit(2); }
await ev(`localStorage.setItem('dca_access',${JSON.stringify(login.access)});localStorage.setItem('dca_refresh',${JSON.stringify(login.refresh ?? '')});localStorage.setItem('dca_user',${JSON.stringify(JSON.stringify(login.user ?? {}))});1`);
await cmd('Page.reload', { ignoreCache: true }); await sleep(2500);

const FAILED = `[...document.querySelectorAll('.is-failed')].map(x=>x.innerText.replace(/\\s+/g,' ').slice(0,110))`;
const settle = `new Promise(r=>{let n=0;const t=setInterval(()=>{const b=document.querySelector('.is-loading,.skeleton,[aria-busy="true"]');if(!b||++n>30){clearInterval(t);r(1)}},100)})`;
const OPEN = `(()=>{const row=document.querySelector('table.list tbody tr:not(.static):not(.group-row), article.tcard, .gal > *, article.db-order .db-oh');if(!row)return 0;row.click();return 1})()`;
const rows = [];
for (const hash of hashes) {
  problems = [];
  const t0 = Date.now();
  await ev(`location.hash=${JSON.stringify('#' + hash)};1`);
  await sleep(500); await ev(settle);
  const ms = Date.now() - t0;
  const opened = await ev(OPEN);
  if (opened) { await sleep(900); await ev(settle); }
  const failed = (await ev(FAILED)) || [];
  const wide = await ev('document.documentElement.scrollWidth>innerWidth+1');
  const bad = [...new Set([...problems, ...failed.map((x) => 'экран: ' + x), ...(wide ? ['шире экрана'] : [])])];
  rows.push({ hash, ms, opened: !!opened, bad });
  console.log(`${bad.length ? '✗' : '✓'} ${hash.padEnd(24)} ${String(ms).padStart(5)} мс ${opened ? 'запись открыта' : 'без записи'}${bad.length ? '\n    ' + bad.join('\n    ') : ''}`);
}
const n = rows.filter((r) => r.bad.length).length;
console.log(`\nэкранов ${rows.length}, со сбоями ${n}, ширина ${WIDTH}, пользователь ${USER}`);
ws.close(); br.kill(); await sleep(500);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* профиль занят — не важно */ }
process.exit(n ? 1 : 0);
