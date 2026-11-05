// Сценарные проверки «как человек» на стенде-копии: паспорт, документация, проектирование, продукция, доски.
//   node tools/scenarios.mjs [адрес=http://localhost:3102] [A,B,C,D,E]   (вход — tools/logs/stand-login.local.env или STAND_LOGIN / STAND_PASSWORD)
// Каждый сценарий — шаги, ожидание, снимок экрана при ошибке: tools/logs/scenarios/<дата>/<сценарий>.png.
// Сценарий A временно меняет число в изделии и возвращает исходное значение. Остальное — только чтение.
// Без зависимостей: Edge/Chrome по Chrome DevTools Protocol. Код выхода: 0 чисто · 1 дефекты · 2 сбой запуска.
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] && /^http/.test(process.argv[2]) ? process.argv[2] : process.env.STAND_URL || 'http://localhost:3102').replace(/\/+$/, '').replace(/\/app$/, '');
const ONLY = new Set((process.argv.find((a) => /^[A-E](,[A-E])*$/.test(a)) || 'A,B,C,D,E').split(','));

const envFile = path.join(ROOT, 'tools/logs/stand-login.local.env');
const fromFile = fs.existsSync(envFile)
  ? Object.fromEntries(fs.readFileSync(envFile, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')]))
  : {};
const cfg = { STAND_LOGIN: process.env.STAND_LOGIN || fromFile.STAND_LOGIN, STAND_PASSWORD: process.env.STAND_PASSWORD || fromFile.STAND_PASSWORD };
const say = (s) => console.log(s);
if (!cfg.STAND_LOGIN || !cfg.STAND_PASSWORD) { say('В stand-login.local.env пусты STAND_LOGIN / STAND_PASSWORD'); process.exit(2); }

const exe = [process.env.EDGE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
if (!exe) { say('Не найден Chrome/Edge'); process.exit(2); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const day = new Date().toISOString().slice(0, 10);
const OUT = path.join(ROOT, 'tools/logs/scenarios', day);
fs.mkdirSync(OUT, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 300);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'scenarios-'));
const br = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let ws;
const finish = async (code) => { try { ws?.close(); } catch { /* закрыт */ } br.kill(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* занят */ } process.exit(code); };

let list;
for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch { /* ждём */ } await sleep(200); }
if (!list?.length) { say('Браузер не запустился'); await finish(2); }
ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const wait = new Map();
const reqs = new Map(); // requestId → {method,url}
let net = []; // ответы сервера: {method,url,status}
let jsErrors = [];
// Только для отладки (SCN_PATCH_DOCS=1): дописать docs.js недостающий экспорт, чтобы пройти дальше «Документации», если она сломана целиком.
const PATCH_DOCS = process.env.SCN_PATCH_DOCS === '1';
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Fetch.requestPaused') {
    const u = m.params.request.url;
    if (/\/sections\/docs\.js(\?|$)/.test(u)) {
      const body = fs.readFileSync(path.join(ROOT, 'backend/pwa/sections/docs.js'), 'utf8') + "\nexport { orderpass } from './order-passport-plan.js';\n";
      ws.send(JSON.stringify({ id: ++id, method: 'Fetch.fulfillRequest', params: { requestId: m.params.requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }], body: Buffer.from(body).toString('base64') } }));
    } else ws.send(JSON.stringify({ id: ++id, method: 'Fetch.continueRequest', params: { requestId: m.params.requestId } }));
  }
  if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); }
  if (m.method === 'Network.requestWillBeSent') reqs.set(m.params.requestId, { method: m.params.request.method, url: m.params.request.url, post: (m.params.request.postData || '').slice(0, 300) });
  if (m.method === 'Network.responseReceived') { const q = reqs.get(m.params.requestId); net.push({ method: q?.method || '?', url: m.params.response.url.replace(BASE, ''), status: m.params.response.status, post: q?.post, rid: m.params.requestId }); }
  if (m.method === 'Runtime.exceptionThrown') jsErrors.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0].slice(0, 140));
});
const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result; if (r?.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]); return r?.result?.value; };
await cmd('Runtime.enable'); await cmd('Network.enable'); await cmd('Page.enable');
if (PATCH_DOCS) await cmd('Fetch.enable', { patterns: [{ urlPattern: '*/sections/*.js' }] });
await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
// перехват скачиваний: PDF создаётся в странице как blob → копия попадает в window.__blobs
await cmd('Page.addScriptToEvaluateOnNewDocument', { source: `window.__blobs=[];const _c=URL.createObjectURL.bind(URL);URL.createObjectURL=(b)=>{try{window.__blobs.push(b)}catch(e){}return _c(b)};` });
await cmd('Page.navigate', { url: BASE + '/app/' }); await sleep(2000);
const loginJson = await ev(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:${JSON.stringify(cfg.STAND_LOGIN)},password:${JSON.stringify(cfg.STAND_PASSWORD)}})}).then(r=>r.text()).catch(()=>'')`);
let login = {}; try { login = JSON.parse(loginJson); } catch { /* не json */ }
if (!login.access) { say(`Вход на ${BASE} не удался (стенд не поднят или неверный логин)`); await finish(2); }
await ev(`localStorage.setItem('dca_access',${JSON.stringify(login.access)});localStorage.setItem('dca_refresh',${JSON.stringify(login.refresh ?? '')});localStorage.setItem('dca_user',${JSON.stringify(JSON.stringify(login.user ?? {}))});1`);
await cmd('Page.reload', { ignoreCache: true }); await sleep(2500);

// ── помощники ──
const settle = `new Promise(r=>{let n=0;const t=setInterval(()=>{const b=document.querySelector('.is-loading,.skeleton,.skel,[aria-busy="true"]');if(!b||++n>40){clearInterval(t);r(1)}},100)})`;
const ready = async (ms = 700) => { await sleep(ms); await ev(settle); };
const nav = async (hash, ms = 900) => { await ev(`location.hash=${JSON.stringify(hash)};1`); await ready(ms); };
const jget = (p) => ev(`fetch('/api${p}',{headers:{Authorization:'Bearer '+localStorage.getItem('dca_access')}}).then(r=>r.json())`);
const jsend = (method, p, body) => ev(`fetch('/api${p}',{method:${JSON.stringify(method)},headers:{'Content-Type':'application/json',Authorization:'Bearer '+localStorage.getItem('dca_access'),'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify(${JSON.stringify(body)})}).then(async r=>({status:r.status,body:await r.text()}))`);
/** Ждёт, пока выражение станет истинным (до ms). */
const until = async (expr, ms = 8000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(`!!(${expr})`)) return true; await sleep(200); } return false; };
/** Клик по видимому элементу с текстом (регэксп) внутри селектора. */
const clickText = (re, sel = 'button, a, [role=button], .btn, summary') => ev(`(()=>{const re=new RegExp(${JSON.stringify(re)},'i');const b=[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.offsetParent&&!x.disabled&&re.test((x.innerText||x.title||x.getAttribute('aria-label')||'').trim()));if(!b)return 0;b.click();return 1})()`);
const shot = async (name) => { try { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT, name + '.png'), Buffer.from(r.result.data, 'base64')); return path.relative(ROOT, path.join(OUT, name + '.png')).replace(/\\/g, '/'); } catch { return ''; } };

/** «Документация» не открывается целиком (main.js ждёт экспорт, которого нет в docs.js) — один понятный дефект вместо каскада. */
const docsBroken = (check) => ev(`/Раздел не открылся/.test(document.body.innerText)`).then((bad) => { if (bad) check(false, 'раздел «Документация» не открывается: «Раздел не открылся — Приложение обновилось» (main.js:67 ждёт экспорт orderpass из sections/docs.js, а он в sections/order-passport-plan.js:94)'); return !!bad; });

const results = []; // { id, title, fails:[], notes:[] }
async function scenario(sid, title, fn) {
  if (!ONLY.has(sid)) return;
  const res = { id: sid, title, fails: [], notes: [] };
  net = []; jsErrors = [];
  const check = (ok, text) => { if (!ok) res.fails.push(text); return ok; };
  try { await fn(check, res.notes); } catch (e) { res.fails.push('сбой сценария: ' + String(e.message).slice(0, 160)); }
  const bad5 = net.filter((n) => n.status >= 500); if (bad5.length) res.fails.push('ответ сервера 5xx: ' + [...new Set(bad5.map((n) => `${n.method} ${n.url.split('?')[0]} ${n.status}`))].slice(0, 3).join('; '));
  if (jsErrors.length) res.fails.push('исключение в странице: ' + jsErrors[0]);
  if (res.fails.length) res.shot = await shot(sid);
  results.push(res);
}

// ── A. Паспорт: шаблон → не хватает → сохранить → предпросмотр ──
const PDF_BAD = /undefined|\[object|NaN|\{[^}]{0,40}\}/;
async function pdfInfo() {
  const info = await ev(`(async()=>{const b=(window.__blobs||[]).slice(-1)[0];if(!b)return null;const buf=new Uint8Array(await b.arrayBuffer());let s='';for(let i=0;i<buf.length;i+=8192)s+=String.fromCharCode(...buf.subarray(i,i+8192));return {size:buf.length,type:b.type,b64:btoa(s)}})()`);
  if (!info) return null;
  const raw = Buffer.from(info.b64, 'base64');
  // распаковка потоков (Flate) и поиск «мусора» в тексте-операторах Tj/TJ; шрифты с кодами глифов дают нечитаемое — тогда заметка
  const chunks = [raw.toString('latin1')];
  let pos = 0;
  while (true) {
    const a = raw.indexOf('stream', pos); if (a < 0) break;
    const z = raw.indexOf('endstream', a); if (z < 0) break;
    let st = a + 6; if (raw[st] === 13) st++; if (raw[st] === 10) st++;
    try { chunks.push(zlib.inflateSync(raw.subarray(st, z)).toString('latin1')); } catch { /* не Flate */ }
    pos = z + 9;
  }
  const all = chunks.join('\n');
  const strings = [...all.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj|\[((?:[^\]]*))\]\s*TJ/g)].map((m) => m[1] ?? [...m[2].matchAll(/\(((?:[^()\\]|\\.)*)\)/g)].map((x) => x[1]).join('')).join(' ');
  const readable = /[A-Za-z]{4,}/.test(strings);
  return { size: info.size, type: info.type, header: raw.subarray(0, 5).toString('latin1'), text: strings, readable, bad: PDF_BAD.exec(readable ? strings : '')?.[0] || '' };
}

await scenario('A', 'Паспорт: шаблон, «Не хватает», сохранение, предпросмотр', async (check, notes) => {
  // изделие с категорией, у которого не хватает числа «Пользователей одновременно» (maxUsers)
  const sc = await jget('/showcase?limit=200');
  const items = sc.items || [];
  let pick = null;
  for (const it of items.filter((x) => x.passportCategory || x.group).slice(0, 80)) {
    const r = await jsend('POST', '/passports/check', { productId: it.id, mode: 'template', variant: 'short' });
    let b; try { b = JSON.parse(r.body); } catch { continue; }
    if ((b.missing || []).some((m) => m && m.key === 'maxUsers')) { pick = it; break; }
  }
  if (!check(!!pick, 'на стенде нет изделия, где не хватает «Пользователей одновременно» (maxUsers) — сценарий не на чем гонять')) return;
  const before = await jget(`/showcase/${pick.id}`);
  const origPd = before.passportDefaults || {};
  notes.push(`изделие ${pick.sku || ''} ${pick.name}`.slice(0, 80));
  try {
    await nav('#products?open=' + pick.id, 1200);
    check(await clickText('^Шаблон паспорта', 'button, a, .btn'), 'в карточке изделия нет кнопки «Шаблон паспорта»');
    await until(`/шаблон паспорта ·|Раздел не открылся/i.test(document.body.innerText)`, 8000);
    if (await docsBroken(check)) return;
    check(await until(`/шаблон паспорта ·/i.test(document.body.innerText)`, 8000), 'форма не открылась: нет заголовка «Шаблон паспорта · …»');
    check(await until(`/не хватает для паспорта \\(\\d+\\)/i.test(document.body.innerText)`, 8000), 'нет блока «Не хватает для паспорта (N)»');
    const field = `(()=>{const f=[...document.querySelectorAll('.drawer .field')].find(x=>/Пользователей одновременно/.test(x.innerText)&&x.querySelector('input'));return f})()`;
    if (!check(await until(field), 'в «Не хватает» нет поля «Пользователей одновременно»')) return;
    const nBefore = await ev(`(+((document.body.innerText.match(/не хватает для паспорта \\((\\d+)\\)/i)||[])[1])||0)`);
    await ev(`(()=>{const f=${field};const i=f.querySelector('input');i.focus();const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,'12');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
    check(await ev(`(()=>{const f=${field};const b=[...f.querySelectorAll('button')].find(x=>/Сохранить в изделии/.test(x.innerText));if(!b)return 0;b.click();return 1})()`), 'у поля нет кнопки «Сохранить в изделии»');
    const gone = await until(`!${field}`, 8000);
    check(gone, 'после «Сохранить в изделии» пункт «Пользователей одновременно» не исчез из «Не хватает»');
    const nAfter = await ev(`(+((document.body.innerText.match(/не хватает для паспорта \\((\\d+)\\)/i)||[])[1])||0)`);
    check(nAfter < nBefore || !(await ev(`/Не хватает для паспорта \\(/i.test(document.body.innerText)`)), `счётчик «Не хватает» не уменьшился (${nBefore} → ${nAfter})`);
    // предпросмотр
    await ev(`window.__blobs.length=0;1`);
    if (!(await ev(`[...document.querySelectorAll('.drawer button')].some(x=>x.offsetParent&&/^Предпросмотр/.test(x.innerText))`))) {
      check(false, 'в форме «Шаблон паспорта · …» нет кнопки «Предпросмотр» (она только в просмотре карточки, docs.js:80) — после «Сохранить в изделии» её не видно, пока не нажать «Отмена»');
      await clickText('^Отмена$', '.drawer button'); await ready(900);
    }
    check(await clickText('^Предпросмотр', '.drawer button, button, a, .btn'), 'нет кнопки «Предпросмотр»');
    const got = await until(`window.__blobs.length>0`, 30000);
    if (check(got, 'предпросмотр не отдал файл (PDF не скачался за 30 с)')) {
      const p = await pdfInfo();
      if (check(!!p, 'не удалось прочитать файл предпросмотра')) {
        check(p.header.startsWith('%PDF'), 'предпросмотр отдал не PDF (начало файла: ' + JSON.stringify(p.header) + ')');
        check(p.size > 10 * 1024, `PDF слишком мал: ${p.size} байт (нужно > 10 КБ)`);
        if (p.readable) check(!p.bad, 'в тексте PDF мусор: ' + p.bad);
        else notes.push('текст PDF не извлечён (шрифт с кодами глифов) — проверены заголовок и размер ' + p.size);
      }
    }
  } finally {
    // вернуть исходное значение
    const keep = Object.fromEntries(Object.entries(origPd).filter(([k, v]) => v !== null && v !== undefined && v !== '' && k !== 'textChoices' && k !== 'passportCategory' || (k === 'passportCategory' && v)));
    const r = await jsend('PUT', `/showcase/${pick.id}/passport-defaults`, { ...keep, textChoices: origPd.textChoices || {} });
    const now = (await jget(`/showcase/${pick.id}`)).passportDefaults || {};
    const same = (now.maxUsers ?? null) === (origPd.maxUsers ?? null);
    notes.push(`значение возвращено (${r.status})` + (same ? '' : ': maxUsers ' + (now.maxUsers ?? '—') + ' ≠ исходное ' + (origPd.maxUsers ?? '—')));
    if (!same) check(false, 'исходное значение «Пользователей одновременно» не вернулось в изделие ' + pick.id);
  }
});

// ── B. Документация ──
await scenario('B', 'Документация: разделы, крошки, «По заказам», «Выпущенные паспорта»', async (check, notes) => {
  await nav('#docs', 1200);
  if (await docsBroken(check)) return;
  const tabs = await ev(`[...document.querySelectorAll('button,a,[role=tab]')].filter(x=>x.offsetParent).map(x=>x.innerText.trim().replace(/\s+/g,' '))`);
  for (const t of ['Нужно сделать паспорт', 'По заказам', 'Выпущенные паспорта']) check((tabs || []).includes(t), `в «Документации» нет вкладки «${t}»`);
  // «По заказам»
  check(await clickText('^По заказам'), 'нет вкладки «По заказам»');
  await ready(1200);
  const okRows = await until(`document.querySelectorAll('.do-group').length>0`, 10000);
  check(okRows, '«По заказам»: нет ни одной строки');
  check(!(await ev(`/Не удалось|Ошибка/.test(document.body.innerText)`)), '«По заказам»: на экране сообщение об ошибке');
  const nOrd = await ev(`document.querySelectorAll('.do-group').length`);
  notes.push(`«По заказам»: строк ${nOrd}`);
  // «Выпущенные паспорта»
  check(await clickText('^Выпущенные паспорта'), 'нет вкладки «Выпущенные паспорта»');
  await ready(1200);
  const hasArch = await until(`document.querySelectorAll('table.list tbody tr:not(.static), article.tcard').length>0 || /пока нет|Нет выпущенных|ничего не найдено/i.test(document.body.innerText)`, 10000);
  check(hasArch, '«Выпущенные паспорта»: ни строк, ни пустого состояния с подсказкой');
  const nArch = await ev(`document.querySelectorAll('table.list tbody tr:not(.static), article.tcard').length`);
  notes.push(`«Выпущенные паспорта»: строк ${nArch}`);
  check(!(await ev(`/Не удалось|Ошибка/.test(document.body.innerText)`)), '«Выпущенные паспорта»: на экране сообщение об ошибке');
});

// ── C. Проектирование ──
await scenario('C', 'Проектирование: «Заказы» слева, группы на доске, ⇕, сохранение состояния', async (check, notes) => {
  await nav('#design', 1800);
  await until(`document.querySelector('.board')`, 10000);
  // слева — только заказы с нераспределёнными позициями (бейдж «не взято N»)
  const side = await ev(`(()=>{const t=[...document.querySelectorAll('.toolbar b')].find(b=>/^Заказы · \\d+/.test(b.innerText));if(!t)return null;const items=[...document.querySelectorAll('.k-side-item')].filter(x=>x.querySelector('.card, .k-card, article')&&x.offsetParent);return {head:t.innerText,total:+t.innerText.match(/\\d+/)[0],cards:items.length,withFree:items.filter(x=>/не взято\\s*\\d+/.test(x.innerText)).length}})()`);
  if (check(!!side, 'слева нет блока «Заказы · N»')) {
    notes.push(`слева: ${side.head}, карточек ${side.cards}, с «не взято» ${side.withFree}`);
    check(side.total === 0 || side.withFree >= side.total, `слева есть заказы без нераспределённых позиций: показано ${side.total}, с «не взято» ${side.withFree}`);
    // сверка с API: у видимых заказов counts.free > 0
  }
  // клик по группе-заказу на доске
  const g = `document.querySelector('.board article.db-order.k-gfold')`;
  if (check(!!(await ev(`!!${g}`)), 'на доске нет групп-заказов (article.db-order)')) {
    const was = await ev(`${g}.getAttribute('aria-expanded')`);
    await ev(`${g}.querySelector('.db-oh').click();1`); await sleep(300);
    const now = await ev(`document.querySelector('.board article.db-order.k-gfold').getAttribute('aria-expanded')`);
    check(now !== was, `клик по группе-заказу не переключил её (aria-expanded ${was} → ${now})`);
    await ev(`document.querySelector('.board article.db-order.k-gfold').querySelector('.db-oh').click();1`); await sleep(300);
    // ⇕ в шапке колонки
    const folds = `[...document.querySelectorAll('.board .col-fold')].filter(x=>!x.hidden&&x.offsetParent)`;
    if (check(!!(await ev(`${folds}.length`)), 'в шапке колонок нет кнопки ⇕ (видимой)')) {
      const col = await ev(`(()=>{const b=${folds}[0];return b.closest('.col').dataset.key})()`);
      const cnt = (open) => ev(`(()=>{const c=document.querySelector('.board .col[data-key=${JSON.stringify(col)}]');const a=[...c.querySelectorAll('article.k-gfold')];return {n:a.length,open:a.filter(x=>x.getAttribute('aria-expanded')==='true').length}})()`);
      const s0 = await cnt();
      await ev(`${folds}.find(b=>b.closest('.col').dataset.key===${JSON.stringify(col)}).click();1`); await sleep(500);
      const s1 = await cnt();
      // ожидание: после клика все группы колонки в одном состоянии, отличном от «не все были такими»
      const toAll = s0.open < s0.n;
      check(toAll ? s1.open === s1.n : s1.open === 0, `⇕ не ${toAll ? 'раскрыл' : 'свернул'} все группы колонки «${col}»: было ${s0.open}/${s0.n}, стало ${s1.open}/${s1.n}`);
      await sleep(1500); // сохранение предпочтений уходит отложенно
      const patches = net.filter((n) => n.method === 'PATCH' && /\/auth\/me\/prefs/.test(n.url));
      if (check(patches.length > 0, 'после ⇕ нет запроса PATCH /auth/me/prefs (состояние не сохраняется)')) {
        const bad = patches.filter((n) => n.status !== 200);
        let why = '';
        if (bad.length) { try { why = ' · тело запроса ' + bad[0].post + ' · ответ ' + ((await cmd('Network.getResponseBody', { requestId: bad[0].rid })).result?.body || '').slice(0, 200); } catch { /* тело недоступно */ } }
        check(!bad.length, 'PATCH /auth/me/prefs ответил ' + bad.map((n) => n.status).join(',') + ' (ждали 200)' + why);
      }
      // после перезагрузки состояние то же
      await cmd('Page.reload', { ignoreCache: true }); await sleep(2500); await ev(settle);
      await until(`document.querySelector('.board .col[data-key=${JSON.stringify(col)}] article.k-gfold')`, 10000);
      await sleep(600);
      const s2 = await cnt();
      check(s2.open === s1.open && s2.n === s1.n, `после перезагрузки состояние групп колонки «${col}» не сохранилось: было ${s1.open}/${s1.n}, стало ${s2.open}/${s2.n}`);
      // вернуть как было
      if (s2.open !== s0.open) { await ev(`[...document.querySelectorAll('.board .col-fold')].find(b=>b.closest('.col').dataset.key===${JSON.stringify(col)})?.click();1`); await sleep(1500); }
    }
  }
});

// ── D. Продукция ──
await scenario('D', 'Продукция: плитки, фильтр «Раздел», галочка и панель «Выбрано»', async (check, notes) => {
  await ev(`sessionStorage.removeItem('dc-prod-sec');1`);
  await nav('#products', 1500);
  const tiles = await ev(`document.querySelectorAll('.sec-tile, .cat-tile').length`);
  check(tiles > 0, 'на старте «Продукции» нет стартовых плиток разделов');
  notes.push('плиток: ' + tiles);
  await nav('#products?all=1', 1800);
  // фильтр «Раздел»: раскрыт, значения с иконками
  const ff = await ev(`(()=>{const h=document.querySelector('.ff-gh[data-fk="g:sec"]');return h?{exp:h.getAttribute('aria-expanded'),ico:document.querySelectorAll('.ff-body .ff-ico').length,opts:document.querySelectorAll('.ff-body .ff-opt, .ff-body button.ff-v, .ff-body [data-fk^="v:"]').length}:null})()`);
  if (check(!!ff, 'в «Продукции» (все изделия) нет фильтра «Раздел» (.ff-gh g:sec)')) {
    check(ff.exp !== 'false', 'фильтр «Раздел» свёрнут, а должен быть раскрыт');
    check(ff.ico > 0, 'у значений фильтра «Раздел» нет иконок (.ff-ico)');
    notes.push(`«Раздел»: иконок ${ff.ico}`);
  }
  check(!(await ev(`[...document.querySelectorAll('button,a,.btn')].some(x=>x.offsetParent&&/^\\s*Выбрать\\s*$/.test(x.innerText))`)), 'на экране «Продукция» есть кнопка «Выбрать» (должна быть убрана)');
  // галочка → «Выбрано: 1» → снять → панель исчезла
  const cb = `document.querySelector('.t-pick input, input.pick-cb[type=checkbox]:not(.pick-all)')`;
  if (check(await until(cb, 8000), 'на карточках изделий нет галочки выбора')) {
    await ev(`${cb}.click();1`); await sleep(500);
    const bar = () => ev(`(()=>{const b=[...document.querySelectorAll('.bulk-bar, .bulkbar, [class*=bulk]')].find(x=>x.offsetParent&&/Выбрано/.test(x.innerText));return b?b.innerText.replace(/\\s+/g,' ').slice(0,80):(/Выбрано: \\d+/.test(document.body.innerText)?document.body.innerText.match(/Выбрано: \\d+/)[0]:'')})()`);
    const t1 = await bar();
    check(/Выбрано:\s*1\b/.test(t1), `после галочки нет панели «Выбрано: 1» (на экране: «${t1}»)`);
    await ev(`${cb}.click();1`); await sleep(500);
    const t2 = await bar();
    check(!/Выбрано/.test(t2), `после снятия галочки панель осталась («${t2}»)`);
  }
});

// ── E. Доски «В работе» / «Заказы» ──
await scenario('E', 'Доски: колонки 290 px, фото ≤ 140 px, текст не столбиком', async (check, notes) => {
  for (const [hash, name] of [['#work', '«В работе»'], ['#salesorders', '«Заказы»']]) {
    await nav(hash, 1500);
    if (hash === '#salesorders') { await clickText('^(Доска|Колонки)'); await ready(1000); }
    if (!check(await until(`document.querySelector('.board .col')`, 10000), `${name}: доски с колонками нет`)) continue;
    await until(`!document.querySelector('.board .col .skel')`, 8000);
    const m = await ev(`(()=>{const cols=[...document.querySelectorAll('.board .col')].filter(x=>x.offsetParent);const w=cols.map(c=>Math.round(c.getBoundingClientRect().width));
      const pics=[...document.querySelectorAll('.board .t-pic')].map(i=>Math.round(i.getBoundingClientRect().height));
      const titles=[...document.querySelectorAll('.board .t-title')].filter(t=>t.offsetParent&&t.innerText.trim().length>12).map(t=>({w:Math.round(t.getBoundingClientRect().width),lines:Math.round(t.getBoundingClientRect().height/(parseFloat(getComputedStyle(t).lineHeight)||16)),len:t.innerText.trim().length}));
      return {w,pics,titles}})()`);
    check(m.w.length > 0 && m.w.every((x) => Math.abs(x - 290) <= 2), `${name}: ширина колонок не 290 px: ${[...new Set(m.w)].join(', ')}`);
    check(m.pics.every((x) => x <= 140), `${name}: фото выше 140 px: ${Math.max(0, ...m.pics)}`);
    const col = m.titles.filter((t) => t.w < 80 || t.lines > Math.ceil(t.len / 4));
    check(!col.length, `${name}: текст названия столбиком (${col.length} карточек, пример: ширина ${col[0]?.w} px, строк ${col[0]?.lines})`);
    notes.push(`${name}: колонок ${m.w.length}, фото ${m.pics.length}, названий ${m.titles.length}`);
  }
});

// ── итог ──
const fails = results.flatMap((r) => r.fails.map((f) => `${r.id}: ${f}`));
const lines = [`Сценарии ${BASE}/app/: ${results.length}, дефектов ${fails.length}`];
for (const r of results) lines.push(`  ${r.fails.length ? '❌' : '✅'} ${r.id}. ${r.title}${r.notes.length ? ' — ' + r.notes.join('; ') : ''}`);
for (const f of fails.slice(0, 20)) lines.push('  ! ' + f);
for (const r of results) if (r.shot) lines.push(`  снимок ${r.id}: ${r.shot}`);
say(lines.join('\n'));
fs.writeFileSync(path.join(OUT, 'summary.txt'), lines.join('\n') + '\n');
await finish(fails.length ? 1 : 0);
