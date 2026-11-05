#!/usr/bin/env node
// Большая проверка сайта: обход всех экранов стенда на трёх ширинах + правила a–l + design-lint, pwa-import-check, tsc.
//   node tools/site-audit.mjs [адрес=http://localhost:3102]       dc audit · dc audit last
// Результат: tools/logs/audit/<дата>/REPORT.md, summary.json, снимки <экран>[-card|-new]-<ширина>.png.
// Только чтение: ничего не сохраняет в базе стенда. Код выхода: 0 нет находок · 1 есть · 2 сбой.
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { standUp, standRefresh, API_PORT } from './night.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : process.env.STAND_URL || `http://localhost:${API_PORT}`).replace(/\/+$/, '').replace(/\/app$/, '');
const WIDTHS = [390, 1024, 1600];
const SLOW_MS = 1500;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const d0 = new Date();
const DAY = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`;
export const AUDIT_DIR = path.join(ROOT, 'tools', 'logs', 'audit', DAY);

export const RULES = {
  a: 'мусор в тексте', b: 'заголовок панели из одного слова', c: '«скоро / в разработке / TODO»', d: 'горизонтальная прокрутка страницы (реальная)',
  e: 'сжатый текст «столбиком»', f: 'картинка выше 200px или шире колонки', g: 'кликабельное меньше 36px по меньшей стороне (390)', h: 'вкладка со счётчиком 0 / пустая без подсказки',
  i: 'внутренние коды на экране', j: 'inline style / класс, которого нет ни в CSS, ни в JS', k: 'ошибки консоли, API ≥ 400 или медленнее 1500 мс', l: 'карточки .tcard выглядят по-разному',
  m: 'мелко: кликабельное 36–39px (390), не ошибка', x: 'проверки кода (design-lint, импорты, tsc)',
  n: 'счёт с идентификатором в группе не открывается отдельной ссылкой',
  o: 'группы реквизитов правой панели разбросаны без карточной структуры',
  p: 'объект фотографии превращён в URL',
};

// ---------- чистые функции (проверяются в site-audit.test.mjs) ----------

/** Структурные регрессии: только безопасные DOM-признаки, без данных форм и токенов. */
export function panelStructureFindings({ groups = [], flatGroupHeadings = 0, imageSources = [] } = {}) {
  const findings = [];
  for (const g of groups) {
    if (/^[a-f0-9]{24}$/i.test(g.key || '') && /^Счёт(?:\s|$)/i.test(g.label || '') && !g.hasEntry) {
      findings.push({ rule: 'n', sel: '.k-gfold .db-inv-chip', text: 'Номер счёта только раскрывает группу: отдельной ссылки в панель нет' });
    }
  }
  if (flatGroupHeadings > 1) findings.push({ rule: 'o', sel: '.drawer dl.fields', text: 'Несколько групп реквизитов собраны в одну простыню вместо компактных карточных блоков' });
  if (imageSources.some((src) => /\[object(?:\s|%20)Object\]/i.test(String(src)))) findings.push({ rule: 'p', sel: 'img[src]', text: 'В адрес изображения попал объект вместо thumb/url' });
  return findings;
}

export function panelStructureSnapshot(doc = document) {
  return {
    groups: [...doc.querySelectorAll('.k-gfold[data-group-key]')].map((el) => {
      const name = el.querySelector('.db-inv-chip, .db-oname');
      return { key: el.dataset.groupKey, label: name?.textContent?.trim() || '', hasEntry: !!(name?.matches('button,a,[role="link"]') || name?.querySelector('button,a,[role="link"]')) };
    }),
    flatGroupHeadings: doc.querySelectorAll('.drawer dl.fields > dt .fields-grp').length,
    imageSources: [...doc.querySelectorAll('img[src]')].map((img) => img.getAttribute('src')),
  };
}

/** Склеивает находки с одинаковым правилом/экраном/селектором/текстом: ширины собираются в список. */
export function mergeFindings(list) {
  const map = new Map();
  for (const f of list) {
    const key = [f.rule, f.screen, f.sel, f.text].join('|');
    const cur = map.get(key);
    if (cur) { if (f.w && !cur.widths.includes(f.w)) cur.widths.push(f.w); if (!cur.shot && f.shot) cur.shot = f.shot; } else map.set(key, { ...f, widths: f.w ? [f.w] : [], w: undefined });
  }
  return [...map.values()];
}

/** Отчёт REPORT.md, не длиннее maxLines строк. */
export function buildReport(findings, meta, maxLines = 200) {
  const out = [`# Большая проверка сайта — ${meta.date}`, '', `Стенд ${meta.base} · экранов ${meta.screens} · панелей ${meta.panels} · ширины ${WIDTHS.join('/')} · находок ${findings.length}`, '', '## Сводка по правилам', ''];
  for (const [k, t] of Object.entries(RULES)) out.push(`- ${k}) ${t}: ${findings.filter((f) => f.rule === k).length}`);
  for (const c of meta.code || []) out.push(`- ${c}`);
  out.push('', '## Топ-5 мест по правилам', '');
  for (const k of Object.keys(RULES)) {
    const fl = findings.filter((f) => f.rule === k); if (!fl.length) continue;
    const cnt = new Map(); for (const f of fl) cnt.set(f.screen, (cnt.get(f.screen) || 0) + 1);
    out.push(`- ${k}: ` + [...cnt].sort((x, y) => y[1] - x[1]).slice(0, 5).map(([s, n]) => `${s} (${n})`).join(', '));
  }
  out.push('', '## Находки по экранам', '');
  const by = new Map();
  for (const f of findings) { if (!by.has(f.screen)) by.set(f.screen, []); by.get(f.screen).push(f); }
  const FULL = 'chkl';
  const fmt = (f) => `- ${f.rule} · ${f.widths.join('/') || '—'} · ${f.sel || '—'} · ${String(f.text).replace(/\s+/g, ' ').slice(0, 110)}${f.shot ? ' · ' + f.shot : ''}`;
  const full = findings.filter((f) => FULL.includes(f.rule));
  const rest = findings.filter((f) => !FULL.includes(f.rule));
  out.length -= 2; out.push('## Находки c, h, k, l — полностью', '');
  for (const f of full) out.push(`${fmt(f)} · ${f.screen}`);
  out.push('', '## Остальные находки по экранам', '');
  by.clear();
  for (const f of rest) { if (!by.has(f.screen)) by.set(f.screen, []); by.get(f.screen).push(f); }
  const room = maxLines - out.length - 2;
  let used = 0, hidden = 0;
  for (const [screen, arr] of by) {
    if (used + arr.length + 2 > room) { hidden += arr.length; continue; }
    out.push(`### ${screen}`);
    for (const f of arr) out.push(`- ${f.rule} · ${f.widths.join('/') || '—'} · ${f.sel || '—'} · ${String(f.text).replace(/\s+/g, ' ').slice(0, 110)}${f.shot ? ' · ' + f.shot : ''}`);
    out.push('');
    used += arr.length + 2;
  }
  if (hidden) out.push(`… ещё ${hidden} находок — полный список в summary.json`);
  return out.slice(0, maxLines).join('\n') + '\n';
}

// ---------- браузер ----------

function findBrowser() {
  return [process.env.EDGE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
}

function readLogin() {
  const f = path.join(ROOT, 'tools/logs/stand-login.local.env');
  const fromFile = fs.existsSync(f)
    ? Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]))
    : {};
  const creds = { login: process.env.STAND_LOGIN || fromFile.STAND_LOGIN, password: process.env.STAND_PASSWORD || fromFile.STAND_PASSWORD };
  // Нет входа — создать сам: логин stand-test и случайный пароль; пользователя стенда заведёт main() (stand-test-user.js), файл читают и обход, и сценарии
  if (!creds.login || !creds.password) {
    creds.login = 'stand-test';
    creds.password = crypto.randomBytes(18).toString('base64url');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `STAND_LOGIN=${creds.login}\nSTAND_PASSWORD=${creds.password}\n`);
  }
  return creds;
}

async function apiLogin(login, password) {
  try {
    const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: login, password }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    return j.access ? j : null;
  } catch { return null; }
}

async function ready() {
  try { return (await fetch(`${BASE}/api/health/ready`, { signal: AbortSignal.timeout(5000) })).status === 200; } catch { return false; }
}

// ---------- сканер в странице ----------
// Возвращает массив {rule, sel, text}. Выполняется внутри браузера.
const SCAN = (mode) => `(()=>{
const mode=${JSON.stringify(mode)};
const out=[];const seen=new Set();
const add=(rule,sel,text)=>{text=String(text).replace(/\\s+/g,' ').trim().slice(0,120);const k=rule+sel+text;if(seen.has(k)||(!'chkl'.includes(rule)&&out.filter(o=>o.rule===rule).length>=8))return;seen.add(k);out.push({rule,sel,text})};
const vis=el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(el).visibility!=='hidden'&&el.offsetParent!==null};
const sel=el=>{let s=el.tagName.toLowerCase();if(el.id)s+='#'+el.id;const c=[...el.classList].slice(0,3).join('.');if(c)s+='.'+c;return s};
const HOOKS=new Set(${JSON.stringify(JS_TOKENS)});
const GARB=new RegExp(${JSON.stringify(GARBAGE_SRC)},'u');
const text=document.body.innerText.split('\\n');
for(const l of text){
  if(GARB.test(l))add('a','body',l);
  if(/(^|[^\\p{L}«])(скоро|в разработке|todo)([^\\p{L}.]|$)/iu.test(l))add('c','body',l);
  if(/\\b(BLG|WRK|TRN|DIO|DSP|MAF)\\b|\\bimg_[\\w-]+|\\b[0-9a-f]{24}\\b/.test(l))add('i','body',l);
}
for(const el of document.querySelectorAll('[title],[aria-label],[placeholder]'))for(const a of ['title','aria-label','placeholder']){const v=el.getAttribute(a);if(v&&GARB.test(v))add('a',sel(el)+'['+a+']',v)}
const GEN=/^(изменить|новый|новая|новое|карточка|редактировать|редактирование|добавить|создать|просмотр)$/i;
for(const h of document.querySelectorAll('.drawer h2,.drawer h3,.drawer-head *'))if(h.children.length===0&&vis(h)&&GEN.test(h.innerText.trim()))add('b',sel(h),h.innerText.trim());
if(document.documentElement.scrollWidth>innerWidth+1){window.scrollTo(300,0);const sx=window.scrollX;window.scrollTo(0,0);
  if(sx>0){let worst=null,wr=0;for(const el of document.querySelectorAll('body *')){if(!vis(el))continue;const r=el.getBoundingClientRect();if(r.right<=innerWidth+1||r.right<=wr)continue;
    let p=el.parentElement,clip=false;while(p&&p!==document.body){const o=getComputedStyle(p);if(/(auto|scroll|hidden|clip)/.test(o.overflowX)){clip=true;break}p=p.parentElement}
    if(!clip){worst=el;wr=r.right}}
  add('d',worst?sel(worst):'documentElement','страница прокручивается вбок на '+sx+'px; виновник right='+Math.round(wr))}}
for(const el of document.querySelectorAll('main *,.drawer *')){
  if(!vis(el)||el.closest('svg,button .badge,.pic'))continue; // .pic: «нет фото» в квадрате-заглушке — так задумано
  const own=[...el.childNodes].filter(n=>n.nodeType===3).map(n=>n.textContent).join('').trim();
  if(own.length>3){const r=el.getBoundingClientRect();const lh=parseFloat(getComputedStyle(el).lineHeight)||16;
    const fs=parseFloat(getComputedStyle(el).fontSize)||14;const lw=Math.max(...own.split(/\\s+/).map(w=>w.length))*fs*0.5;
    if(r.height>1.5*lh&&((r.width<60&&r.height>3*lh)||r.width<lw))add('e',sel(el),own+' ('+Math.round(r.width)+'×'+Math.round(r.height)+')')}
}
for(const img of document.querySelectorAll('.drawer img,.tcard img,article img,.card img')){
  if(!vis(img))continue;const r=img.getBoundingClientRect();const p=(img.parentElement||img).getBoundingClientRect();
  if(r.height>200||r.width>p.width+1)add('f',sel(img),Math.round(r.width)+'×'+Math.round(r.height)+' в колонке '+Math.round(p.width))}
if(innerWidth<=420)for(const el of document.querySelectorAll('button,a[href],[role=button],[role=tab],input:not([type=hidden]),select,.chip')){
  if(!vis(el))continue;const r=el.getBoundingClientRect();
  if(el.tagName==='A'&&el.parentElement&&getComputedStyle(el).display==='inline'&&[...el.parentElement.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>2))continue;
  const mn=Math.min(r.width,r.height);if(mn<40)add(mn<36?'g':'m',sel(el),(el.innerText||el.getAttribute('aria-label')||el.title||'').trim().slice(0,40)+' '+Math.round(r.width)+'×'+Math.round(r.height))}
for(const el of document.querySelectorAll('.chip[role=tab],.k-seg-btn,.chips .chip')){
  if(!vis(el))continue;const t=el.innerText.replace(/\\s+/g,' ').trim();
  if(/(^|[\\s(])0\\)?$/.test(t)&&!/^все\\b/i.test(t))add('h',sel(el),t)}
if(!window.__cssClasses){const s=new Set();for(const sh of document.styleSheets){try{for(const r of sh.cssRules){const walk=x=>{if(x.selectorText)for(const m of x.selectorText.matchAll(/\\.([\\w-]+)/g))s.add(m[1]);if(x.cssRules)for(const y of x.cssRules)walk(y)};walk(r)}}catch(e){}}window.__cssClasses=s}
const unk=new Map();
for(const el of document.querySelectorAll('main *,.drawer *,nav *'))for(const c of el.classList)if(!window.__cssClasses.has(c)&&!HOOKS.has(c)&&!/^(js-|is-|has-|td-b-|on$|active$|open$|hidden$)/.test(c)&&!unk.has(c))unk.set(c,el);
for(const [c,el] of unk)add('j',sel(el),'класс «'+c+'» не найден ни в одном CSS');
for(const el of document.querySelectorAll('main [style],.drawer [style]')){
  if(el.closest('svg')||el.tagName==='svg')continue;
  if(el.tagName==='I'&&/^\\s*flex:[^;]*;?\\s*$/.test(el.getAttribute('style')||''))continue; // ширина доли в полосе — из данных
  const st=el.getAttribute('style')||'';const props=st.split(';').map(x=>x.trim()).filter(Boolean).filter(x=>!x.startsWith('--'));
  if(props.length)add('j',sel(el),'inline style: '+props.join('; '))}
for(const f of (${panelStructureFindings.toString()}) ((${panelStructureSnapshot.toString()})()))add(f.rule,f.sel,f.text);
return out})()`;

const JS_TOKENS = (() => {
  const set = new Set();
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') walk(f); } else if (/\.m?js$/.test(e.name)) for (const t of fs.readFileSync(f, 'utf8').match(/[A-Za-z_][\w-]*/g) || []) set.add(t); } };
  try { walk(path.join(ROOT, 'backend/pwa')); } catch { /* нет pwa */ }
  return [...set];
})();

const GARBAGE_SRC = await (async () => {
  const { GARBAGE } = await import(pathToFileURL(path.join(ROOT, 'backend/pwa/core/garbage.js')).href);
  return GARBAGE.source;
})();

// характеристики карточки .tcard для правила l
const TCARD = `(()=>{const c=document.querySelector('article.tcard,.tcard');if(!c)return null;
const hd=c.querySelector('h1,h2,h3,h4,[class*=title],[class*=head],header')||c.firstElementChild;
const cs=getComputedStyle(c),hs=getComputedStyle(hd||c);
return {шрифт_заголовка:hs.fontSize,вес_заголовка:hs.fontWeight,отступы_карточки:cs.padding,межстрочный_заголовка:hs.lineHeight}})()`;

const settle = `new Promise(r=>{let n=0;const t=setInterval(()=>{const b=document.querySelector('.is-loading,.skeleton,[aria-busy="true"]');if(!b||++n>30){clearInterval(t);r(1)}},100)})`;
const OPEN_ROW = `(()=>{const row=document.querySelector('table.list tbody tr:not(.static):not(.group-row), article.tcard, .gal > *, article.db-order .db-oh');if(!row)return 0;row.click();return 1})()`;
const OPEN_NEW = `(()=>{const b=[...document.querySelectorAll('main button, .toolbar button, .panel button')].find(x=>x.offsetParent&&!x.disabled&&/^\\s*(\\+|Нов|Добав|Создать)/.test(x.innerText||''));if(!b)return 0;b.click();return 1})()`;
const CLOSE = `(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));const c=document.querySelector('.drawer-back');if(c)c.click();return 1})()`;

// ---------- шаги кода ----------
function codeSteps() {
  const run = (cmd, args, cwd = ROOT) => { const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: cmd === 'npx' && process.platform === 'win32', timeout: 300000, maxBuffer: 32e6 }); return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') }; };
  const res = [];
  const items = [
    ['design-lint', process.execPath, ['backend/scripts/design-lint.mjs']],
    ['pwa-import-check', process.execPath, ['backend/scripts/pwa-import-check.mjs']],
    ['tsc --noEmit', 'npx', ['tsc', '--noEmit'], path.join(ROOT, 'backend')],
  ];
  for (const [name, cmd, args, cwd] of items) {
    const r = run(cmd, args, cwd);
    const last = r.out.trim().split('\n').filter(Boolean).slice(-1)[0] || '';
    res.push({ name, code: r.code, line: `${name}: ${r.code === 0 ? 'ок' : 'ОШИБКИ'} — ${last.slice(0, 100)}`, out: r.out.slice(-1500) });
  }
  return res;
}

// ---------- основной ход ----------
async function main() {
  const sayErr = (s) => console.log(s);
  const creds = readLogin();
  if (!creds.login || !creds.password) { sayErr('В tools/logs/stand-login.local.env пусты STAND_LOGIN / STAND_PASSWORD'); return 2; }
  const exe = findBrowser();
  if (!exe) { sayErr('Не найден Chrome/Edge'); return 2; }

  // 1) стенд
  if (!(await ready())) {
    if (BASE !== `http://localhost:${API_PORT}`) { sayErr(`Стенд ${BASE} не отвечает`); return 2; }
    sayErr('Стенд не поднят — поднимаю (3–10 мин)…');
    const code = await standUp({ say: sayErr, log: () => {} });
    if (code || !(await ready())) { sayErr('Стенд не поднялся'); return 2; }
  } else if (BASE === `http://localhost:${API_PORT}`) {
    // поднятый стенд мог остаться на старой сборке — тогда новые адреса дают 404/400 (ложные находки k)
    sayErr('Стенд поднят — пересобираю сервер из текущего кода…');
    if (await standRefresh({ say: sayErr, log: () => {} }) || !(await ready())) { sayErr('Стенд не пересобрался'); return 2; }
  }
  let login = await apiLogin(creds.login, creds.password);
  if (!login) {
    sayErr('Вход не прошёл — создаю пользователя стенда');
    // Имя контейнера — из паспорта уникального night-стенда (не legacy dcnight-backend).
    const passport = path.join(ROOT, 'tools', '.night', 'current-stand.json');
    let backend = null;
    try {
      const run = JSON.parse(fs.readFileSync(passport, 'utf8'));
      if (run?.project) backend = `${run.project}-backend`;
    } catch { /* нет паспорта */ }
    if (!backend) { sayErr('Нет паспорта стенда (tools/.night/current-stand.json) — поднимите: dc stand up'); return 2; }
    const r = spawnSync('docker', ['exec', '-i', '-w', '/app', '-e', 'STAND=1', '-e', `STAND_PASSWORD=${creds.password}`, backend, 'node', '-'], { input: fs.readFileSync(path.join(ROOT, 'backend/scripts/stand-test-user.js')), encoding: 'utf8', env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
    if (r.status) { sayErr('Не удалось создать вход: ' + (r.stderr || r.stdout || '').trim().slice(0, 120)); return 2; }
    login = await apiLogin(creds.login, creds.password);
    if (!login) { sayErr('Вход на стенде не удался'); return 2; }
  }

  const main = fs.readFileSync(path.join(ROOT, 'backend/pwa/main.js'), 'utf8');
  const sections = [...(main.match(/const NAV = \[(.+?)\];/s)?.[1] ?? '').matchAll(/\['(\w+)',\s*'/g)].map((m) => m[1]);
  if (!sections.length) { sayErr('Не нашёл меню (NAV) в backend/pwa/main.js'); return 2; }

  fs.rmSync(AUDIT_DIR, { recursive: true, force: true });
  fs.mkdirSync(AUDIT_DIR, { recursive: true });

  // браузер
  const port = 9800 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'site-audit-'));
  const br = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
  let ws;
  const closeAll = async () => { try { ws?.close(); } catch { /* закрыт */ } br.kill(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* занят */ } };
  try {
    let list;
    for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch { /* ждём */ } await sleep(200); }
    if (!list?.length) { sayErr('Браузер не запустился'); return 2; }
    ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let id = 0; const wait = new Map(); let events = []; const reqs = new Map();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
      const p = m.params;
      if (m.method === 'Runtime.exceptionThrown') events.push(['исключение: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text).split('\n')[0].slice(0, 120), 'console']);
      if (m.method === 'Runtime.consoleAPICalled' && p.type === 'error') events.push(['консоль: ' + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 140), 'console']);
      if (m.method === 'Network.requestWillBeSent' && p.request.url.includes('/api/')) reqs.set(p.requestId, { t: p.timestamp, url: p.request.url });
      if (m.method === 'Network.responseReceived' && p.response.status >= 400 && p.response.url.includes('/api/')) events.push([`API ${p.response.status}: ${p.response.url.replace(BASE, '').split('?')[0]}`, 'api']);
      if (m.method === 'Network.loadingFinished' && reqs.has(p.requestId)) {
        const r = reqs.get(p.requestId); const ms = (p.timestamp - r.t) * 1000;
        if (ms > SLOW_MS) events.push([`API медленно ${Math.round(ms)} мс: ${r.url.replace(BASE, '').split('?')[0]}`, 'api']);
        reqs.delete(p.requestId);
      }
    });
    const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr) => (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
    await cmd('Runtime.enable'); await cmd('Network.enable'); await cmd('Page.enable');
    await cmd('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await cmd('Page.navigate', { url: BASE + '/app/' }); await sleep(2000);
    await ev(`localStorage.setItem('dca_access',${JSON.stringify(login.access)});localStorage.setItem('dca_refresh',${JSON.stringify(login.refresh ?? '')});localStorage.setItem('dca_user',${JSON.stringify(JSON.stringify(login.user ?? {}))});1`);
    await cmd('Page.reload', { ignoreCache: true }); await sleep(2500);

    const shot = async (name) => {
      const r = await cmd('Page.captureScreenshot', { format: 'png' });
      if (!r.result?.data) return undefined;
      fs.writeFileSync(path.join(AUDIT_DIR, name), Buffer.from(r.result.data, 'base64'));
      return `tools/logs/audit/${DAY}/${name}`;
    };
    const all = []; const tcards = {}; let screens = 0, panels = 0;
    const take = async (screen, w, kind, shotName) => {
      const found = (await ev(SCAN(kind))) || [];
      const file = await shot(shotName);
      for (const f of found) all.push({ ...f, screen: kind === 'main' ? screen : `${screen} [${kind}]`, w, shot: file });
      return file;
    };
    for (const w of WIDTHS) {
      await cmd('Emulation.setDeviceMetricsOverride', { width: w, height: w < 600 ? 800 : 900, deviceScaleFactor: 1, mobile: false });
      for (const sec of sections) {
        events = [];
        await ev(`location.hash=${JSON.stringify('#' + sec)};1`);
        await sleep(700); await ev(settle);
        if (w === WIDTHS[0]) screens++;
        await take(sec, w, 'main', `${sec}-${w}.png`);
        if (w === 1600) { const t = await ev(TCARD); if (t) tcards[sec] = t; }
        // вкладки и фильтры — один раз, на средней ширине
        if (w === 1024) {
          const n = (await ev(`document.querySelectorAll('.chip[role=tab],.k-seg-btn').length`)) || 0;
          for (let i = 0; i < Math.min(n, 8); i++) {
            const label = await ev(`(()=>{const t=[...document.querySelectorAll('.chip[role=tab],.k-seg-btn')][${i}];if(!t||!t.offsetParent)return null;t.click();return t.innerText.replace(/\\s+/g,' ').trim()})()`);
            if (label == null) continue;
            await sleep(500); await ev(settle);
            // ждём конца загрузки вкладки: нет индикатора и прошло ≥ 1500 мс после клика
            for (let t = 500; t < 6000; t += 250) {
              const busy = await ev(`!!document.querySelector('main .loading, main [class*=loading], main [aria-busy=true], main .skeleton, main .spinner')`);
              if (t >= 1500 && !busy) break;
              await sleep(250);
            }
            const empty = await ev(`(()=>{const has=document.querySelector('main table.list tbody tr, main .tcard, main .gal > *, main .empty, main [class*=empty], main [class*=hint], main .state, main .state-hint, main .db-order');return has?0:1})()`);
            if (empty) all.push({ rule: 'h', sel: '.chip[role=tab]', text: `вкладка «${label}»: ни записей, ни подсказки`, screen: sec, w });
          }
          await ev(`location.hash=${JSON.stringify('#' + sec)};1`); await sleep(300);
        }
        for (const [kind, expr] of [['card', OPEN_ROW], ['new', OPEN_NEW]]) {
          if (await ev(expr)) {
            if (w === WIDTHS[0]) panels++;
            await sleep(900); await ev(settle);
            await take(sec, w, kind, `${sec}-${kind}-${w}.png`);
            await ev(CLOSE); await sleep(400);
            await ev(`location.hash=${JSON.stringify('#' + sec)};1`); await sleep(300);
          }
        }
        for (const [text, kind] of events) all.push({ rule: 'k', sel: kind, text, screen: sec, w });
      }
    }
    // правило l
    const secs = Object.keys(tcards);
    if (secs.length > 1) {
      for (const key of Object.keys(tcards[secs[0]])) {
        const vals = new Map();
        for (const s of secs) { const v = tcards[s][key]; if (!vals.has(v)) vals.set(v, []); vals.get(v).push(s); }
        if (vals.size > 1) all.push({ rule: 'l', sel: '.tcard', text: `${key.replace(/_/g, ' ')}: ` + [...vals].map(([v, ss]) => `${v} (${ss.join(', ')})`).join(' ≠ '), screen: 'карточки между досками' });
      }
    }

    // код
    const code = codeSteps();
    for (const c of code) if (c.code) all.push({ rule: 'x', sel: c.name, text: c.line, screen: 'код' });
    const findings = mergeFindings(all);
    const meta = { date: DAY, base: BASE, screens, panels, code: code.map((c) => c.line) };
    fs.writeFileSync(path.join(AUDIT_DIR, 'REPORT.md'), buildReport(findings, meta));
    const byRule = Object.fromEntries(Object.keys(RULES).map((k) => [k, findings.filter((f) => f.rule === k).length]));
    fs.writeFileSync(path.join(AUDIT_DIR, 'summary.json'), JSON.stringify({ ...meta, total: findings.length, byRule, findings }, null, 1));
    console.log(summaryLines({ ...meta, total: findings.length, byRule }).join('\n'));
    return findings.length ? 1 : 0;
  } finally { await closeAll(); }
}

export function summaryLines(s) {
  const parts = Object.entries(s.byRule).filter(([, n]) => n).map(([k, n]) => `${k}:${n}`).join(' ');
  return [`Большая проверка ${s.date}: экранов ${s.screens}, панелей ${s.panels}, находок ${s.total}`, parts ? 'По правилам: ' + parts : 'Находок нет', ...(s.code || []).map((c) => '  ' + c), `Отчёт: tools/logs/audit/${s.date}/REPORT.md (снимки рядом)`];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c), (e) => { console.log('Сбой: ' + (e.stack || e.message).split('\n').slice(0, 3).join(' | ')); process.exit(2); });
}
