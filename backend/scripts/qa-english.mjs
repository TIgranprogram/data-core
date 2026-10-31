// Поиск английских слов на экранах «Рабочего места»: обходит те же экраны, что qa-smoke.mjs, открывает первую запись
// и собирает видимый текст со словами латиницей. Не считаются: артикулы и коды (со цифрами), RAL, адреса сайтов, почта, единицы.
// QA_BASE=http://localhost:3102 QA_DIR=<папка с qa-login.txt> node backend/scripts/qa-english.mjs [ширина=1280] → список; код выхода 1, если нашлось.
// Только чтение. Допустимые слова — в ALLOW ниже.
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
const hashes = [...new Set([...sections, 'money?tab=calendar', 'money?tab=debts', 'money?tab=forecast', 'docs?tab=queue', 'docs?tab=orders', 'docs?tab=archive', 'stock', 'movements', 'dicts', 'trash', 'history', 'help'])];
// допустимая латиница: единицы, бренд, форматы, стандарты
const ALLOW = new Set(['ral', 'pdf', 'xlsx', 'csv', 'png', 'jpg', 'jpeg', 'mm', 'cm', 'kg', 'шт', 'ip', 'qr', 'id', 'gost', 'ooo', 'ip', 'pro', 'crm', 'kppd', 'rs', 'dxf', 'dwg', 'cad', 'isbn', 'ph', 'led', 'wifi', 'usb', 'ok', 'a4', 'a3', 'inn', 'kpp', 'ogrn', 'excel', 'esc', 'ctrl', 'enter', 'shift', 'tab', 'wifi']);

const port = 9300 + Math.floor(Math.random() * 500);
const prof = path.join(dir, 'edge-english-' + port);
const br = spawn(process.env.EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch { /* ждём браузер */ } await sleep(200); }
const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const wait = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); } });
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
await cmd('Runtime.enable'); await cmd('Page.enable');
await cmd('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: 900, deviceScaleFactor: 1, mobile: WIDTH < 720 });
await cmd('Page.navigate', { url: BASE + '/app/' }); await sleep(1500);
const login = JSON.parse(await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:${JSON.stringify(USER)},password:${JSON.stringify(PW)}})}).then(r=>r.text())`));
if (!login.access) { console.log('вход не удался'); br.kill(); process.exit(2); }
await ev(`localStorage.setItem('dca_access',${JSON.stringify(login.access)});localStorage.setItem('dca_refresh',${JSON.stringify(login.refresh ?? '')});localStorage.setItem('dca_user',${JSON.stringify(JSON.stringify(login.user ?? {}))});1`);
await cmd('Page.reload', { ignoreCache: true }); await sleep(2500);

const settle = `new Promise(r=>{let n=0;const t=setInterval(()=>{const b=document.querySelector('.is-loading,.skeleton,[aria-busy="true"]');if(!b||++n>30){clearInterval(t);r(1)}},100)})`;
const OPEN = `(()=>{const row=document.querySelector('table.list tbody tr:not(.static):not(.group-row), article.tcard, .gal > *, article.db-order .db-oh');if(!row)return 0;row.click();return 1})()`;
// видимый текст: узлы-тексты без script/style/input; плюс подписи placeholder и title
const TEXT = `(()=>{const out=[];const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=w.nextNode()){const p=n.parentElement;if(!p||/^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName))continue;const r=p.getBoundingClientRect();if(!r.width&&!r.height)continue;const t=n.nodeValue.replace(/\\s+/g,' ').trim();if(t)out.push(t)}
document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(e=>{for(const a of ['placeholder','title','aria-label']){const t=e.getAttribute(a);if(t)out.push(t)}});return out})()`;

// В тексте с русскими словами названия товаров и брендов (KRAFTOOL, DIN) не считаем — ловим служебные коды вида «income.updated»
// и целиком английские подписи. Слово-пометка латиницей в русской фразе (excel, pcs) — в ALLOW или чинится.
// слово — латиница из 3+ букв без цифр; пропускаем адреса, почту, артикулы, RAL
const CODE = /[a-z]+(.[a-z]+)+/g;
function foreign(text) {
  if (/[А-Яа-яЁё]/.test(text)) { const c = text.match(CODE); return c ? c.map((x) => x) : /(pcs|шт.?)/.test(text) && /pcs/.test(text) ? ['pcs'] : []; }
  const t = text.replace(/https?:\/\/\S+|www\.\S+|\S+@\S+|\b[\w-]+\.(ru|com|net|org|su|рф)\b/gi, ' ').replace(/\bRAL\s*\d+\b/gi, ' ');
  const words = [];
  for (const tok of t.split(/[\s,;:()«»"'/\\]+/)) {
    if (/\d/.test(tok) || /[А-Яа-яЁё]/.test(tok)) continue; // артикулы (с цифрами) и смешанные слова — не считаем
    for (const m of tok.matchAll(/[A-Za-z]{3,}/g)) if (!ALLOW.has(m[0].toLowerCase())) words.push(m[0]);
  }
  return words;
}

const found = new Map(); // слово → { screens:Set, sample }
for (const hash of hashes) {
  await ev(`location.hash=${JSON.stringify('#' + hash)};1`);
  await sleep(500); await ev(settle);
  const snapshots = [await ev(TEXT)];
  if (await ev(OPEN)) { await sleep(900); await ev(settle); snapshots.push(await ev(TEXT)); }
  for (const texts of snapshots) for (const t of texts || []) {
    const w = foreign(t);
    if (!w.length) continue;
    for (const x of w) { const e = found.get(x) || { screens: new Set(), sample: t.slice(0, 80) }; e.screens.add(hash); found.set(x, e); }
  }
}
for (const [w, e] of [...found].sort((a, b) => a[0].localeCompare(b[0]))) console.log(`${w.padEnd(20)} ${[...e.screens].join(', ')}  | ${e.sample}`);
console.log(`\nанглийских слов ${found.size}, экранов ${hashes.length}, ширина ${WIDTH}`);
ws.close(); br.kill(); await sleep(500);
try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* профиль занят — не важно */ }
process.exit(found.size ? 1 : 0);
