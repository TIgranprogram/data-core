#!/usr/bin/env node
// ИИ-тестировщик: локальная модель (LM Studio) ходит по «Рабочему месту» на стенде этого ПК как менеджер,
// выполняет задания, создаёт записи с меткой ТЕСТ-ИИ и пишет отчёт. Рабочий сайт не трогает (только localhost).
//   node tools/ai-tester/run.mjs --check            проверить, всё ли готово (по шагам, с подсказками)
//   node tools/ai-tester/run.mjs [--minutes N]      работать N минут (по умолчанию 480 = рабочий день)
//   node tools/ai-tester/run.mjs --detach --minutes N  то же в фоне (кнопка пульта): пульт не ждёт, окно можно закрыть
//   node tools/ai-tester/run.mjs --stop             попросить остановиться (закончит текущий шаг, напишет отчёт)
//   node tools/ai-tester/run.mjs --cleanup          убрать записи ТЕСТ-ИИ, созданные сегодня (и раньше)
//   node tools/ai-tester/run.mjs --last             коротко: последний отчёт
//   node tools/ai-tester/run.mjs --watchdog         сторож (Планировщик Windows, раз в 10 мин и при входе): упал — продолжить до конца срока
//   node tools/ai-tester/run.mjs --resume           продолжить прерванный запуск (зовёт сторож)
//   node tools/ai-tester/run.mjs --session-stdin --no-watchdog --minutes 15  разовая проба с готовой сессией стенда
//   node tools/ai-tester/run.mjs --reviewed [дата]  отчёт разобран — dc start его больше не показывает
// Отчёт: tools/logs/ai-tester/<дата>/REPORT.md, снимки — там же. Код выхода: 0 норма · 1 есть ошибки сайта · 2 сбой.
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { TAG, isLocalStand, tagText, createdFrom, screenGarbage, blockedClick, buildReport, screenChange } from './lib.mjs';
import { sessionFromStdin } from './stand-session.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LOGS = path.join(ROOT, 'tools', 'logs', 'ai-tester');
const STOP_FILE = path.join(LOGS, 'STOP');
const CREATED_FILE = path.join(LOGS, 'created.json');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const suppliedSession = has('--session-stdin') ? sessionFromStdin(process.stdin) : null;
const noWatchdog = Boolean(suppliedSession) || has('--no-watchdog');
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 && Number(args[i + 1]) > 0 ? Number(args[i + 1]) : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const say = (s) => console.log(s);
const pad = (n) => String(n).padStart(2, '0');
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const d0 = new Date();
const RUN_FILE = path.join(LOGS, 'run.json'); // идущий запуск: { until, day, pid, beat } — по нему сторож видит обрыв
const readRun = () => { try { return JSON.parse(fs.readFileSync(RUN_FILE, 'utf8')); } catch { return null; } };
// продолжение после обрыва пишет в отчёт того же дня, что и начало (даже после полуночи)
let DAY = `${d0.getFullYear()}-${pad(d0.getMonth() + 1)}-${pad(d0.getDate())}`;
if (args.includes('--resume') && readRun()?.day) DAY = readRun().day;
const OUT = path.join(LOGS, DAY);
const STATE_FILE = path.join(OUT, 'state.json'); // задания и находки — чтобы продолжение дописало отчёт, а не начало с нуля
const BEAT_MS = 60000; const DEAD_MS = 4 * BEAT_MS;
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Сторож: запуск должен идти, а процесса нет (перезагрузка, свет, сбой) — продолжить скрыто до конца срока. */
function watchdog() {
  const r = readRun();
  if (!r || r.noWatchdog) return 0;
  if (fs.existsSync(STOP_FILE) || Date.now() >= r.until) { fs.rmSync(RUN_FILE, { force: true }); return 0; }
  if (Date.now() - (r.beat || 0) < DEAD_MS && alive(r.pid)) return 0; // работает
  fs.mkdirSync(LOGS, { recursive: true });
  const log = fs.openSync(path.join(LOGS, 'watchdog.log'), 'a');
  fs.writeSync(log, `
${new Date().toISOString()} сторож: тестировщик не работает — продолжаю до ${new Date(r.until).toLocaleTimeString('ru-RU')}
`);
  const ch = spawn(process.execPath, [path.join(HERE, 'run.mjs'), '--resume'], { cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
  ch.unref();
  return 0;
}

/** Задача Планировщика Windows: при входе и раз в 10 мин — сторож. Без прав администратора, только для этого пользователя. */
function ensureWatchdogTask() {
  if (process.platform !== 'win32') return;
  const vbs = path.join(HERE, 'watchdog.vbs');
  const ps = `$a=New-ScheduledTaskAction -Execute 'wscript.exe' -Argument '//B "${vbs}"';` +
    `$t1=New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME;` +
    `$t2=New-ScheduledTaskTrigger -Once -At (Get-Date) -RepetitionInterval (New-TimeSpan -Minutes 10);` +
    `$st=New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5);` +
    `Register-ScheduledTask -TaskName 'DataCore AI tester watchdog' -Action $a -Trigger $t1,$t2 -Settings $st -Force | Out-Null`;
  const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8', windowsHide: true });
  say(r.status ? '⚠ Сторож не поставлен в Планировщик — при обрыве тестировщик не продолжит сам.' : 'Сторож включён: при обрыве тестировщик продолжит сам (проверка раз в 10 мин и при входе в Windows).');
}

/** Не давать Windows уснуть, пока идёт этот процесс (SetThreadExecutionState; настройки питания не меняются). */
function keepAwake() {
  if (process.platform !== 'win32') return null;
  const ps = `$k=Add-Type -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);' -Name K -Namespace W -PassThru;` +
    `while (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { [void]$k::SetThreadExecutionState(0x80000001); Start-Sleep 30 }`;
  return spawn('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { stdio: 'ignore', windowsHide: true });
}

// ---------- настройки ----------
function loadSettings() {
  const f = path.join(HERE, 'settings.json');
  if (!fs.existsSync(f)) fs.copyFileSync(path.join(HERE, 'settings.example.json'), f);
  const s = JSON.parse(fs.readFileSync(f, 'utf8'));
  return { stepsPerTask: 20, temperature: 0.3, apiKey: 'lm-studio', stand: 'http://localhost:3102', ...s, baseUrl: String(s.baseUrl || '').replace(/\/+$/, ''), stand: String(s.stand || 'http://localhost:3102').replace(/\/+$/, '') };
}

// ---------- модель ----------
async function llm(s, body, ms = 240000) {
  const r = await fetch(`${s.baseUrl}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.apiKey}` },
    body: JSON.stringify({ model: s.model, temperature: s.temperature, ...body }), signal: AbortSignal.timeout(ms),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`ИИ ответил ${r.status}: ${text.slice(0, 200)}`);
  return JSON.parse(text);
}

/**
 * LM Studio закрыт или модель не загружена — запустить сервер и загрузить модель консольной командой lms
 * (ставится вместе с LM Studio). Память модели — 16 тыс. токенов: по умолчанию её меньше, и длинный экран не влезает.
 */
const LMS = path.join(os.homedir(), '.lmstudio', 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
async function llmUp(s) { try { return (await (await fetch(`${s.baseUrl}/models`, { headers: { Authorization: `Bearer ${s.apiKey}` }, signal: AbortSignal.timeout(6000) })).json())?.data || null; } catch { return null; } }
async function modelLoaded(s) {
  try { const j = await (await fetch(s.baseUrl.replace(/\/v1$/, '') + '/api/v0/models', { signal: AbortSignal.timeout(6000) })).json(); return j.data?.find((m) => m.id === s.model)?.state === 'loaded'; } catch { return false; }
}
async function ensureLLM(s, log = say) {
  let local = false; let port = '1234';
  try { const u = new URL(s.baseUrl); local = ['localhost', '127.0.0.1'].includes(u.hostname); port = u.port || '1234'; } catch { /* адрес кривой */ }
  if (!(await llmUp(s))) {
    if (!local || !fs.existsSync(LMS)) return false;
    log('   LM Studio не отвечает — запускаю его сервер…');
    spawnSync(LMS, ['server', 'start', '--port', port], { encoding: 'utf8', timeout: 90000, windowsHide: true });
    for (let i = 0; i < 20 && !(await llmUp(s)); i++) await sleep(1500);
    if (!(await llmUp(s))) return false;
  }
  if (local && fs.existsSync(LMS) && !(await modelLoaded(s))) {
    log(`   Загружаю модель ${s.model} (до 1 минуты)…`);
    spawnSync(LMS, ['unload', '--all'], { encoding: 'utf8', timeout: 60000, windowsHide: true }); // две модели в 16 ГБ не влезут
    spawnSync(LMS, ['load', s.model, '--context-length', '16384', '--gpu', 'max', '-y'], { encoding: 'utf8', timeout: 180000, windowsHide: true });
  }
  return true;
}

// ---------- стенд ----------
async function standReady(base) {
  try { return (await fetch(`${base}/api/health/ready`, { signal: AbortSignal.timeout(5000) })).status === 200; } catch { return false; }
}
function readLogin() {
  const f = path.join(ROOT, 'tools/logs/stand-login.local.env');
  const kv = fs.existsSync(f) ? Object.fromEntries(fs.readFileSync(f, 'utf8').split(/\r?\n/).map((l) => l.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean).map((m) => [m[1], m[2].replace(/^["']|["']$/g, '')])) : {};
  let login = kv.STAND_LOGIN, password = kv.STAND_PASSWORD;
  if (!login || !password) {
    login = 'stand-test'; password = crypto.randomBytes(18).toString('base64url');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `STAND_LOGIN=${login}\nSTAND_PASSWORD=${password}\n`);
  }
  return { login, password };
}
async function apiLogin(base, { login, password }) {
  try {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: login, password }), signal: AbortSignal.timeout(15000) });
    const j = await r.json().catch(() => ({}));
    return j.access ? j : null;
  } catch { return null; }
}
/** Вход на стенд; нет пользователя — заводит его тем же скриптом, что «Большая проверка сайта». */
async function standLogin(base) {
  if (suppliedSession) {
    const session = await suppliedSession(base);
    try {
      const response = await fetch(`${base}/api/auth/me`, {
        headers: { Authorization: `Bearer ${session.access}` }, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (response.ok) return session;
    } catch { /* У сессии из stdin нет запасного входа. */ }
    return null;
  }
  const creds = readLogin();
  let login = await apiLogin(base, creds);
  if (login) return login;
  let backend = null;
  try { backend = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/.night/current-stand.json'), 'utf8'))?.project; } catch { /* нет паспорта */ }
  if (!backend) return null;
  const r = spawnSync('docker', ['exec', '-i', '-w', '/app', '-e', 'STAND=1', '-e', `STAND_PASSWORD=${creds.password}`, `${backend}-backend`, 'node', '-'], { input: fs.readFileSync(path.join(ROOT, 'backend/scripts/stand-test-user.js')), encoding: 'utf8', windowsHide: true, env: { ...process.env, MSYS_NO_PATHCONV: '1' } });
  if (r.status) return null;
  return apiLogin(base, creds);
}
const DAY_MS = 86400000;
const fmtDay = (t) => (t ? new Date(t).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) : '?');
let STAND_BASE = ''; // для шапки отчёта: из какой копии база стенда

/** Docker не запущен (например, после перезагрузки) — запустить Docker Desktop и подождать до 4 минут. */
async function ensureDocker() {
  if (!spawnSync('docker', ['info'], { encoding: 'utf8', windowsHide: true }).status) return true;
  const exe = [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'DockerDesktop', 'Docker Desktop.exe'), path.join(process.env.ProgramFiles || 'C:\\Program Files', 'Docker', 'Docker', 'Docker Desktop.exe')].find((f) => fs.existsSync(f));
  if (!exe) return false;
  say('Docker не запущен — запускаю Docker Desktop (до 4 минут)…');
  spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 48; i++) { await sleep(5000); if (!spawnSync('docker', ['info'], { encoding: 'utf8', windowsHide: true }).status) { say('Docker запущен.'); return true; } }
  return false;
}

/**
 * База стенда должна быть свежей: есть копия новее, а базе стенда больше 2 дней — новый стенд из свежей копии
 * (старый откладывается без удаления). Копия на самом ПК старше 2 дней — предупреждение (её качает задача «Копия базы на ПК в 10:00»).
 */
async function ensureFreshBase() {
  const { standInfo, standRenew } = await import('../night.mjs');
  let i; try { i = standInfo(); } catch (e) { say('⚠ Не узнал, из какой копии база стенда: ' + e.message.slice(0, 100)); return; }
  if (!i.latest) { say('⚠ На этом ПК нет копии базы — стенд не обновить. Пульт → Копии базы и сервер → «Скачать копию базы на этот ПК».'); STAND_BASE = 'копии на ПК нет'; }
  else if (Date.now() - i.latestAt > 2 * DAY_MS) say(`⚠ Копия базы на ПК старая (от ${fmtDay(i.latestAt)}). Пульт → Копии базы и сервер → «Скачать копию базы на этот ПК».`);
  const newer = i.latest && i.latestAt && (!i.dataAt || i.latestAt > i.dataAt) && i.backup !== i.latest;
  if (i.run && newer && (!i.dataAt || Date.now() - i.dataAt > 2 * DAY_MS)) {
    say(`База стенда от ${fmtDay(i.dataAt)}, на ПК есть копия от ${fmtDay(i.latestAt)} — собираю стенд из свежей копии (5–15 минут). Рабочий сайт не затрагивается.`);
    try { await standRenew({ say, log: () => {} }); } catch (e) { say('⚠ Новый стенд не собрался (' + e.message.slice(0, 120) + ') — работаю на прежнем.'); }
    try { i = standInfo(); } catch { /* ниже — что есть */ }
  }
  if (!STAND_BASE) STAND_BASE = i.run ? `копия от ${fmtDay(i.dataAt)}${i.backup ? ` (${i.backup})` : ''}` : 'стенд будет создан из последней копии';
}

async function ensureStand(base) {
  await ensureFreshBase();
  if (await standReady(base)) {
    // поднятый стенд мог остаться на старом коде — тогда находки ложные (как в «Большой проверке сайта»)
    say('Стенд работает — обновляю его до текущего кода (около 2 минут)…');
    const { standRefresh } = await import('../night.mjs');
    try { await standRefresh({ say: () => {}, log: () => {} }); } catch (e) { say('⚠ Стенд не обновился (' + String(e.message).slice(0, 120) + ') — работаю на том, что есть.'); }
    for (let i = 0; i < 60 && !(await standReady(base)); i++) await sleep(2000);
    return standReady(base);
  }
  say('Стенд не запущен — запускаю его (3–10 минут)…');
  const docker = spawnSync('docker', ['info'], { encoding: 'utf8', windowsHide: true });
  if (docker.status) { say('❌ Docker не запущен. Откройте программу Docker Desktop, дождитесь зелёной надписи «Running» и нажмите кнопку ещё раз.'); return false; }
  const { standUp } = await import('../night.mjs');
  const code = await standUp({ say, log: () => {} });
  if (code) return false;
  // сохранённый стенд стартует со старым образом (compose start) — пересобрать под текущий код, иначе находки ложные (2026-11-10: 400 на client-errors после исправления)
  say('Обновляю стенд до текущего кода (около 2 минут)…');
  const { standRefresh } = await import('../night.mjs');
  try { await standRefresh({ say: () => {}, log: () => {} }); } catch (e) { say('⚠ Стенд не обновился (' + String(e.message).slice(0, 120) + ') — работаю на том, что есть.'); }
  for (let i = 0; i < 60 && !(await standReady(base)); i++) await sleep(2000);
  return standReady(base);
}

// ---------- список разделов из меню приложения ----------
function readNav() {
  const main = fs.readFileSync(path.join(ROOT, 'backend/pwa/main.js'), 'utf8');
  return [...(main.match(/const NAV = \[(.+?)\];/s)?.[1] ?? '').matchAll(/\['([\w-]+)',\s*'([^']+)'/g)].map((m) => ({ id: m[1], title: m[2] }));
}

// ---------- задания ----------
// make: создаёт запись (название получит метку ТЕСТ-ИИ). look: только смотрит.
const TASKS = [
  { id: 'partner', section: 'partners', make: true, task: 'Создай нового контрагента — поставщика. Название придумай. Заполни, что сможешь (ИНН — ровно {inn}, телефон). Сохрани. Найди его в списке и открой карточку.' },
  { id: 'request', section: 'requests', make: true, task: 'Создай новую заявку на закупку. Добавь 1–2 материала из предложенных и количество. Сохрани. Убедись, что заявка видна в списке.' },
  { id: 'expense', section: 'expenses', make: true, task: 'Нажми кнопку добавления расхода. Заполни сумму 1500 и комментарий, остальные обязательные поля выбери из списков. Нажми «Сохранить» один раз. Если сайт пишет, что не так, — исправь это поле. Затем finish.' },
  { id: 'staff', section: 'staff', task: 'Осмотри «Сотрудников»: найди кого-нибудь поиском, открой карточку, посмотри вкладки. Ничего не меняй, новых пользователей не создавай.' },
  { id: 'stock', section: 'stock', task: 'Найди через поиск любой материал (например «труба»). Открой карточку, посмотри все вкладки. Ничего не меняй.' },
  { id: 'orders', section: 'salesorders', task: 'Нажми на строку одного заказа — справа откроется панель. В панели нажми 2 разные вкладки. Затем finish. Ничего не меняй.' },
  { id: 'products', section: 'products', task: 'Нажми на строку одного изделия — справа откроется панель. В панели нажми 2 разные вкладки. Затем finish. Ничего не меняй.' },
  { id: 'money', section: 'money', task: 'Осмотри раздел: переключи вкладки и фильтры, открой одну запись. Проверь, что суммы и даты выглядят нормально. Ничего не меняй.' },
  { id: 'home', section: 'home', task: 'Осмотри экран «Сегодня». Нажми на 2–3 карточки или ссылки и проверь, что открывается нужное. Ничего не меняй.' },
  { id: 'work', section: 'work', task: 'Осмотри раздел «В работе»: нажми на одну запись, посмотри, что открылось. Если что-то непонятно — report_problem. Затем finish. Ничего не меняй.' },
  { id: 'docs', section: 'docs', task: 'Осмотри «Документацию»: пройди по вкладкам, открой одну запись. Ничего не меняй.' },
  { id: 'contracts', section: 'contracts', task: 'Нажми на строку одного договора — справа откроется панель. В панели нажми 2 разные вкладки. Затем finish. Ничего не меняй.' },
  { id: 'catalog', section: 'suppliercatalog', task: 'Осмотри «Каталог номенклатуры»: найди что-нибудь поиском, открой карточку. Ничего не меняй.' },
  { id: 'free', section: null, task: 'Свободный осмотр этого раздела: нажимай кнопки и вкладки, которые выглядят важными, ищи ошибки и непонятные места. Чужие записи не меняй.' },
];

const SYSTEM = `Ты — тестировщик сайта «Рабочее место» (заявки, склад, заказы, деньги, сотрудники). Работаешь на тестовой копии сайта.
Каждый ход ты получаешь снимок экрана: адрес, текст и список элементов с номерами [N]. Вызывай ровно ОДИН инструмент за ход.
Правила:
1. Названия новых записей программа сама начнёт с «${TAG}». Пиши просто: «Поставщик Ромашка».
2. Чужие записи (без «${TAG}») не удаляй и не меняй.
3. Ввод данных — в правой панели. Обычно после заполнения нужна кнопка «Сохранить» или «Создать».
4. Если сайт работает не так, как ожидает человек, выглядит сломанным, непонятно подписан или долго грузится — вызови report_problem: что сделал, что ожидал, что увидел. Коротко, по-русски.
5. Не повторяй одно действие больше двух раз. Не получилось — попробуй по-другому или заверши.
6. Когда задание выполнено или ты в тупике — вызови finish.`;

const TOOLS = [
  { name: 'click', description: 'Нажать элемент по номеру из списка', parameters: { type: 'object', properties: { n: { type: 'integer' } }, required: ['n'] } },
  { name: 'fill', description: 'Ввести текст в поле по номеру', parameters: { type: 'object', properties: { n: { type: 'integer' }, text: { type: 'string' } }, required: ['n', 'text'] } },
  { name: 'choose', description: 'Выбрать вариант в выпадающем списке по номеру поля и тексту варианта', parameters: { type: 'object', properties: { n: { type: 'integer' }, option: { type: 'string' } }, required: ['n', 'option'] } },
  { name: 'key', description: 'Нажать клавишу: Enter или Escape (закрыть окно)', parameters: { type: 'object', properties: { key: { type: 'string', enum: ['Enter', 'Escape'] } }, required: ['key'] } },
  { name: 'open_section', description: 'Открыть раздел меню по названию', parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'report_problem', description: 'Записать найденную проблему в отчёт', parameters: { type: 'object', properties: { what: { type: 'string', description: 'что сделал, что ожидал, что увидел' }, kind: { type: 'string', enum: ['ошибка', 'неудобно', 'непонятно'] } }, required: ['what', 'kind'] } },
  { name: 'finish', description: 'Закончить задание', parameters: { type: 'object', properties: { result: { type: 'string', enum: ['получилось', 'не получилось'] }, summary: { type: 'string' } }, required: ['result', 'summary'] } },
].map((f) => ({ type: 'function', function: f }));

// ---------- браузер (Chrome DevTools Protocol, без зависимостей) ----------
/** После обрыва остаются браузеры без окна и их временные профили (ai-tester-*) — убрать перед новым запуском. */
function cleanLeftovers() {
  if (process.platform === 'win32') {
    const ps = "Get-CimInstance Win32_Process -Filter \"Name='msedge.exe' OR Name='chrome.exe'\" | Where-Object { $_.CommandLine -like '*--user-data-dir=*ai-tester-*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
    spawnSync('powershell', ['-NoProfile', '-Command', ps], { windowsHide: true });
  }
  for (const d of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('ai-tester-'))) { try { fs.rmSync(path.join(os.tmpdir(), d), { recursive: true, force: true }); } catch { /* занят */ } }
}

function findBrowser() {
  return [process.env.EDGE, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find((p) => fs.existsSync(p));
}

async function openBrowser(base) {
  const exe = findBrowser();
  const port = 9600 + Math.floor(Math.random() * 300);
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-tester-'));
  const br = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${prof}`, '--no-first-run', ...(suppliedSession ? ['--incognito'] : []), 'about:blank'], { stdio: 'ignore' });
  let list;
  for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch { /* ждём */ } await sleep(200); }
  if (!list?.length) { br.kill(); throw new Error('Браузер не запустился'); }
  const ws = new WebSocket(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0; const wait = new Map(); const reqs = new Map();
  const b = { net: [], jsErrors: [], created: [], ws };
  const cmd = (method, params = {}) => new Promise((r) => { const i = ++id; wait.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.addEventListener('message', async (e) => {
    const m = JSON.parse(e.data);
    if (m.id && wait.has(m.id)) { wait.get(m.id)(m); wait.delete(m.id); return; }
    const p = m.params;
    if (m.method === 'Network.requestWillBeSent') reqs.set(p.requestId, { method: p.request.method, url: p.request.url, t: p.timestamp });
    if (m.method === 'Network.responseReceived') { const q = reqs.get(p.requestId); if (q) { q.status = p.response.status; q.ms = Math.round((p.timestamp - q.t) * 1000); } }
    if (m.method === 'Network.loadingFinished') {
      const q = reqs.get(p.requestId); if (!q || !q.url.startsWith(base + '/api/')) return;
      const n = { method: q.method, url: q.url.slice(base.length), status: q.status, ms: q.ms };
      b.net.push(n);
      if (q.method !== 'GET' && q.status >= 400) {
        // что ответил сервер — по нему видно, ошибка сайта или модель ввела не то
        const r = await cmd('Network.getResponseBody', { requestId: p.requestId });
        try { const j = JSON.parse(r.result?.body || '{}'); n.msg = [].concat(j.message || j.error || '').join('; ').slice(0, 160); } catch { /* не json */ }
      }
      if (q.method === 'POST' && q.status >= 200 && q.status < 300) {
        const r = await cmd('Network.getResponseBody', { requestId: p.requestId });
        const c = createdFrom(q.method, q.url, q.status, r.result?.body);
        if (c) b.created.push(c);
      }
    }
    if (m.method === 'Runtime.exceptionThrown') b.jsErrors.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text).split('\n')[0].slice(0, 160));
  });
  b.ev = async (expr) => { const r = (await cmd('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result; if (r?.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text).split('\n')[0]); return r?.result?.value; };
  b.cmd = cmd;
  b.shot = async (name) => { try { const r = await cmd('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true }); const f = path.join(OUT, 'shots', name + '.png'); fs.writeFileSync(f, Buffer.from(r.result.data, 'base64')); return path.relative(ROOT, f).replace(/\\/g, '/'); } catch { return ''; } };
  b.key = async (key) => { const code = key === 'Enter' ? 13 : 27; for (const type of ['keyDown', 'keyUp']) await cmd('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }); };
  b.close = async () => { try { ws.close(); } catch { /* закрыт */ } br.kill(); await sleep(400); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* занят */ } };
  await cmd('Runtime.enable'); await cmd('Network.enable'); await cmd('Page.enable');
  await cmd('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  return b;
}

const SETTLE = `new Promise(r=>{let n=0;const t=setInterval(()=>{const b=document.querySelector('.is-loading,.skeleton,.skel,[aria-busy="true"]');if(!b||++n>40){clearInterval(t);r(1)}},100)})`;

/** Снимок экрана для модели: текст и пронумерованные элементы (сначала правая панель и окна). */
const LOOK = `(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const s = getComputedStyle(el); return s.visibility !== 'hidden' && s.display !== 'none' && +s.opacity > 0.05 && r.bottom > -50 && r.top < innerHeight * 2.5; };
  const clean = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const fieldLabel = (el) => {
    if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) return clean(l.innerText); }
    const f = el.closest('label, .field, .k-field, .form-row'); const t = f ? clean([...f.childNodes].filter((n) => n !== el && !(n.contains && n.contains(el))).map((n) => n.textContent).join(' ')) : '';
    return t || clean(el.getAttribute('aria-label') || el.placeholder || el.name || '');
  };
  const sel = 'button,a[href],[role=button],[role=tab],[role=option],[role=menuitem],summary,input:not([type=hidden]),select,textarea,[contenteditable=true]';
  let els = [...document.querySelectorAll(sel)];
  for (const el of document.querySelectorAll('div,li,tr,article,span,td,label')) {
    if (getComputedStyle(el).cursor !== 'pointer' || el.closest(sel)) continue;
    const p = el.parentElement; if (p && getComputedStyle(p).cursor === 'pointer') continue;
    els.push(el);
  }
  els = els.filter((el) => vis(el) && !el.disabled && !el.closest('[aria-hidden=true], aside.sidebar, .side-back'));
  const layer = document.querySelector('.modal:not([hidden]), dialog[open], .drawer.open, .drawer:not([hidden])');
  if (layer) els.sort((a, b) => (layer.contains(b) ? 1 : 0) - (layer.contains(a) ? 1 : 0));
  els = [...new Set(els)].slice(0, 55);
  window.__ai = els;
  const out = els.map((el, i) => {
    const tag = el.tagName.toLowerCase(); const n = i + 1;
    if (tag === 'select') return '[' + n + '] список «' + fieldLabel(el) + '» = «' + clean(el.selectedOptions[0]?.text) + '»; варианты: ' + [...el.options].slice(0, 12).map((o) => clean(o.text)).filter(Boolean).join(' | ');
    if (tag === 'input' || tag === 'textarea' || el.isContentEditable) {
      const t = el.type || 'text';
      if (t === 'checkbox' || t === 'radio') return '[' + n + '] ' + (t === 'checkbox' ? 'галочка' : 'переключатель') + ' «' + fieldLabel(el) + '» ' + (el.checked ? '(вкл)' : '(выкл)');
      return '[' + n + '] поле «' + fieldLabel(el) + '»' + (t !== 'text' ? ' (' + t + ')' : '') + ' = «' + clean(el.value ?? el.innerText).slice(0, 40) + '»';
    }
    const kind = el.getAttribute('role') === 'tab' ? 'вкладка' : tag === 'a' ? 'ссылка' : tag === 'button' || el.getAttribute('role') === 'button' ? 'кнопка' : 'строка';
    return '[' + n + '] ' + kind + ' «' + clean(el.innerText || el.title || el.getAttribute('aria-label')).slice(0, 70) + '»' + (layer && layer.contains(el) ? ' (в панели)' : '');
  });
  const scope = layer || document.querySelector('main, #app, .content') || document.body;
  const toast = [...document.querySelectorAll('.toast, .k-toast, .alert, [role=alert], .error')].filter(vis).map((x) => clean(x.innerText)).filter(Boolean).slice(0, 3);
  const bad = [...document.querySelectorAll('.err, [aria-invalid=true], .invalid')].filter(vis).map((x) => fieldLabel(x)).filter(Boolean).slice(0, 5);
  return { hash: location.hash, layer: layer ? clean((layer.querySelector('h1,h2,h3,.drawer-title,.k-title') || {}).innerText) || 'открыта' : '', toast, bad, text: clean(scope.innerText).slice(0, 1100), all: clean(document.body.innerText).slice(0, 6000), els: out };
})()`;

async function look(b) {
  await sleep(500); await b.ev(SETTLE);
  return b.ev(LOOK);
}
function lookText(o, nav) {
  const cur = nav.find((n) => (o.hash || '').replace(/^#/, '').split(/[?/]/)[0] === n.id);
  return [`Раздел: ${cur?.title || o.hash || '—'}${o.layer ? ` · Открыта панель: ${o.layer}` : ''}`,
    o.toast.length ? `Сообщения: ${o.toast.join(' / ')}` : '',
    o.bad?.length ? `Поля с ошибкой (заполни их): ${o.bad.join(', ')}` : '',
    `Текст: ${o.text}`, 'Элементы:', ...o.els, `Разделы меню: ${nav.map((n) => n.title).join(', ')}`].filter(Boolean).join('\n');
}

/** Выполнить действие модели. Возвращает текст «что вышло» для модели. */
async function act(b, call, nav, ctxText) {
  const a = call.args;
  const el = (n) => `window.__ai && window.__ai[${Number(n) - 1}]`;
  const label = (n) => b.ev(`(()=>{const e=${el(n)};return e?String(e.innerText||e.value||e.title||e.getAttribute('aria-label')||'').trim().slice(0,80):null})()`);
  if (call.name === 'click') {
    const l = await label(a.n); if (l == null) return `Элемента [${a.n}] нет. Посмотри список заново.`;
    const why = blockedClick(l, ctxText); if (why) return `Нельзя: ${why}.`;
    await b.ev(`(()=>{const e=${el(a.n)};e.scrollIntoView({block:'center'});e.click();return 1})()`);
    return `Нажал «${l}».`;
  }
  if (call.name === 'fill') {
    const info = await b.ev(`(()=>{const e=${el(a.n)};if(!e)return null;return {tag:e.tagName.toLowerCase(),type:e.type||'',search:e.type==='search'||/поиск|найти|search/i.test((e.placeholder||'')+(e.getAttribute('aria-label')||'')),combo:e.getAttribute('role')==='combobox'||!!e.getAttribute('list')||!!e.getAttribute('aria-autocomplete'),ce:e.isContentEditable}})()`);
    if (!info) return `Поля [${a.n}] нет.`;
    if (info.tag === 'select') return `[${a.n}] — выпадающий список, в него не пишут. Вызови choose с n=${a.n} и вариантом.`;
    const text = tagText(a.text, info);
    await b.ev(`(()=>{const e=${el(a.n)};e.scrollIntoView({block:'center'});e.focus();
      if(e.isContentEditable){e.innerText=${JSON.stringify(text)};}
      else if(e.tagName==='INPUT'||e.tagName==='TEXTAREA'){const pr=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(pr,'value').set.call(e,${JSON.stringify(text)});}
      else{return 0;}
      e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 1})()`);
    return `Ввёл «${text}».`;
  }
  if (call.name === 'choose') {
    const r = await b.ev(`(()=>{const e=${el(a.n)};if(!e)return 'нет поля';const want=${JSON.stringify(String(a.option || '').toLowerCase())};
      if(e.tagName==='SELECT'){const o=[...e.options].find(o=>o.text.toLowerCase().includes(want));if(!o)return 'нет варианта';e.value=o.value;e.dispatchEvent(new Event('change',{bubbles:true}));return 'выбрал «'+o.text.trim()+'»'}
      e.click();return 'открыл список'})()`);
    if (r === 'открыл список') {
      await sleep(600);
      const r2 = await b.ev(`(()=>{const want=${JSON.stringify(String(a.option || '').toLowerCase())};const o=[...document.querySelectorAll('[role=option],li,.option,.k-opt,.dd-item,button')].filter(x=>x.offsetParent).find(x=>x.innerText.trim().toLowerCase().includes(want));if(!o)return 'список открыт, варианта «'+want+'» не нашёл — посмотри элементы';o.click();return 'выбрал «'+o.innerText.trim().slice(0,60)+'»'})()`);
      return r2;
    }
    return r;
  }
  if (call.name === 'key') { await b.key(a.key === 'Enter' ? 'Enter' : 'Escape'); return `Нажал ${a.key}.`; }
  if (call.name === 'open_section') {
    const w = String(a.name || '').toLowerCase();
    const s = nav.find((n) => n.title.toLowerCase() === w) || nav.find((n) => n.title.toLowerCase().includes(w) || w.includes(n.title.toLowerCase()));
    if (!s) return `Раздела «${a.name}» нет. Есть: ${nav.map((n) => n.title).join(', ')}.`;
    await b.ev(`location.hash=${JSON.stringify('#' + s.id)};1`);
    return `Открыл раздел «${s.title}».`;
  }
  return `Неизвестный инструмент ${call.name}.`;
}

/** Ошибки, которые видит программа (не модель): исключения, ответы 5xx, отказы при сохранении, медленно, мусор на экране. */
function autoFindings(b, o, seenGarbage) {
  const out = [];
  for (const n of b.net.splice(0)) {
    const p = n.url.split('?')[0];
    if (n.status >= 500) out.push(`сервер ответил ошибкой ${n.status} на ${n.method} ${p}`);
    // 409 «такая запись уже есть» — сайт верно отказал на повтор (модель ввела то же), не ошибка сайта
    else if (n.status >= 400 && n.status !== 401 && n.status !== 409 && n.method !== 'GET') out.push(`сохранение не прошло: ${n.method} ${p} → ${n.status}${n.msg ? ` «${n.msg}»` : ''}`);
    else if (n.status === 404 && n.method === 'GET') out.push(`нет данных по адресу ${p} (404)`);
    if (n.ms > 3000) out.push(`медленно: ${n.method} ${p} — ${(n.ms / 1000).toFixed(1)} с`);
  }
  for (const e of b.jsErrors.splice(0)) out.push(`сбой в странице: ${e}`);
  const g = screenGarbage(o?.all);
  if (g && !seenGarbage.has(o.hash + g)) { seenGarbage.add(o.hash + g); out.push(`служебное значение на экране: «${g}»`); }
  return out;
}

// ---------- запуск одного задания ----------
async function runTask(s, b, nav, t, state) {
  const section = t.section ? nav.find((n) => n.id === t.section) : nav[Math.floor(Math.random() * nav.length)];
  const title = `${section?.title || '—'}: ${t.id}`;
  const rec = { at: nowTime(), title, result: 'не получилось', steps: 0, summary: '' };
  // каждое задание — с чистого экрана: панели и окна прошлого задания закрыты
  // ?t= — полная загрузка страницы: смена одного #адреса не закрывает панели прошлого задания
  await b.cmd('Page.navigate', { url: `${s.stand}/app/?t=${Date.now()}#${section?.id || 'home'}` });
  await sleep(2500);
  b.net.length = 0; b.jsErrors.length = 0;
  let o = await look(b);
  const msgs = [{ role: 'system', content: SYSTEM }, { role: 'user', content: `Задание: ${t.task.replace('{inn}', String(Math.floor(1e9 + Math.random() * 9e9)))}\n\nЭкран сейчас:\n${lookText(o, nav)}` }];
  const add = (f) => {
    state.findings.push(f);
    say(`  ⚠ ${f.kind}: ${f.text}`);
  };
  let idle = 0; let refused = 0; const history = [];
  for (let step = 1; step <= s.stepsPerTask; step++) {
    if (fs.existsSync(STOP_FILE) || Date.now() > state.until) { rec.summary = 'остановлено по времени или кнопке'; break; }
    rec.steps = step;
    // старые снимки экрана — коротко, чтобы влезть в память модели
    for (let i = 2; i < msgs.length - 2; i++) if (msgs[i].role === 'tool' && msgs[i].content.length > 200) msgs[i].content = msgs[i].content.split('\n')[0] + ' (старый снимок экрана)';
    let res;
    try { res = await llm(s, { messages: msgs, tools: TOOLS, tool_choice: 'required', max_tokens: 700 }); }
    catch (e) {
      // LM Studio упал или выгрузил модель — поднять и повторить шаг один раз
      say('  ИИ не ответил (' + e.message.slice(0, 80) + ') — перезапускаю модель и пробую снова');
      await sleep(5000);
      await ensureLLM(s, say);
      try { res = await llm(s, { messages: msgs, tools: TOOLS, tool_choice: 'required', max_tokens: 700 }); }
      catch (e2) { rec.summary = 'ИИ не ответил: ' + e2.message.slice(0, 150); state.llmErrors++; break; }
    }
    state.llmErrors = 0;
    const m = res.choices?.[0]?.message || {};
    const tc = (m.tool_calls || [])[0];
    if (!tc) {
      if (++idle > 2) { rec.summary = 'ИИ перестал вызывать инструменты'; break; }
      msgs.push({ role: 'assistant', content: m.content || '' }, { role: 'user', content: 'Вызови один инструмент (click, fill, choose, key, open_section, report_problem или finish).' });
      continue;
    }
    idle = 0;
    let callArgs = {}; try { callArgs = JSON.parse(tc.function.arguments || '{}'); } catch { /* пусто */ }
    const call = { name: tc.function.name, args: callArgs };
    msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: tc.id, type: 'function', function: { name: call.name, arguments: tc.function.arguments || '{}' } }] });
    fs.appendFileSync(path.join(OUT, 'steps.log'), `${nowTime()} ${title} #${step} ${call.name} ${JSON.stringify(callArgs)}\n`);
    if (call.name === 'finish') { rec.result = callArgs.result === 'получилось' ? 'получилось' : 'не получилось'; rec.summary = callArgs.summary || ''; break; }
    if (call.name === 'report_problem') {
      const shot = await b.shot(`${t.id}-${Date.now()}`);
      add({ kind: ['ошибка', 'неудобно', 'непонятно'].includes(callArgs.kind) ? `ИИ: ${callArgs.kind}` : 'ИИ: замечание', text: String(callArgs.what || '').slice(0, 300), where: o.hash, task: title, shot });
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: 'Записал в отчёт. Продолжай задание.' });
      continue;
    }
    // хождение по кругу: то же действие 3-й раз за последние 8 шагов (в т. ч. «13, 14, 13, 14») — не выполнять;
    // 4 таких отказа — задание закрыть
    const sig = call.name + JSON.stringify(callArgs);
    const loop = history.slice(-8).filter((x) => x === sig).length >= 2;
    history.push(sig);
    let result;
    if (loop) {
      if (++refused >= 4) { rec.summary = 'ходил по кругу — задание закрыто программой'; break; }
      result = 'Ты уже делал это, и ничего не изменилось — ты ходишь по кругу. Прочитай сообщения на экране. Если сайт мешает выполнить задание — вызови report_problem, затем finish. Иначе сделай другое действие.';
    } else { try { result = await act(b, call, nav, o.text); } catch (e) { result = 'Не вышло: ' + e.message.slice(0, 120); } }
    const prev = o;
    o = await look(b).catch(() => o);
    if (!loop && call.name !== 'fill') result += ' ' + screenChange(prev, o);
    for (const text of autoFindings(b, o, state.garbage)) add({ kind: 'ошибка', text, where: o.hash, task: title, shot: await b.shot(`${t.id}-${Date.now()}`) });
    msgs.push({ role: 'tool', tool_call_id: tc.id, content: `${result}\n\nЭкран сейчас:\n${lookText(o, nav)}` });
  }
  state.tasks.push(rec);
  say(`${rec.at} ${rec.title} — ${rec.result} (${rec.steps} шаг.) ${rec.summary.slice(0, 100)}`);
}

// ---------- созданные записи ----------
function loadCreated() { try { return JSON.parse(fs.readFileSync(CREATED_FILE, 'utf8')); } catch { return []; } }
function saveCreated(list) { fs.mkdirSync(LOGS, { recursive: true }); fs.writeFileSync(CREATED_FILE, JSON.stringify(list, null, 1)); }

async function cleanup(s, browserAccess) {
  const list = loadCreated();
  if (!list.length) { say('Тестовых записей нет — убирать нечего.'); return 0; }
  if (!isLocalStand(s.stand)) { say('❌ Адрес стенда не на этом ПК — отказ.'); return 2; }
  if (!(await standReady(s.stand))) { say('❌ Стенд не запущен. Записи остались в списке — уберу при следующем запуске.'); return 2; }
  const login = browserAccess ? { access: browserAccess } : await standLogin(s.stand);
  if (!login) { say('❌ Не удалось войти на стенд.'); return 2; }
  const left = []; const refusedDel = []; let ok = 0;
  for (const c of list) {
    try {
      const r = await fetch(`${s.stand}/api${c.path}/${c.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${login.access}` }, redirect: suppliedSession ? 'error' : 'follow', signal: AbortSignal.timeout(15000) });
      if (r.ok || r.status === 404) ok++;
      else {
        refusedDel.push(`${c.path} (${r.status})`);
        if (suppliedSession) left.push(c);
      }
    } catch { left.push(c); } // нет связи — попробуем в следующий раз
  }
  saveCreated(left);
  say(`Убрано тестовых записей: ${ok}.${refusedDel.length ? ` Сайт не дал удалить: ${refusedDel.join(', ')} — на стенде это не мешает, копия базы обновится.` : ''}`);
  return suppliedSession && left.length ? 2 : 0;
}

// ---------- проверка готовности (по шагам) ----------
async function check(s, { hint = true } = {}) {
  let bad = 0;
  const ok = (t) => say('✅ ' + t);
  const no = (t, hint) => { bad++; say('❌ ' + t); for (const h of hint) say('   → ' + h); };
  say('Проверяю ИИ-тестировщика по шагам:\n');
  // 1. LM Studio (закрыт — запускаем сами)
  await ensureLLM(s, say);
  let data = await llmUp(s);
  for (let i = 0; i < 10 && !data; i++) { await sleep(2000); data = await llmUp(s); } // во время загрузки модели сервер отвечает медленно
  const models = data ? { data } : null;
  if (!models?.data) no(`1. LM Studio не отвечает по адресу ${s.baseUrl}`, ['Откройте программу LM Studio.', 'Слева нажмите зелёный значок «Developer» (или «Разработчик»).', 'Вверху включите переключатель «Status: Running».', 'Проверьте номер порта: он должен совпадать с адресом выше (Settings → Server Port).', 'Нажмите эту кнопку ещё раз.']);
  else ok(`1. LM Studio отвечает (${s.baseUrl})`);
  // 2. модель
  if (models?.data) {
    if (!models.data.some((m) => m.id === s.model)) no(`2. В LM Studio нет модели «${s.model}»`, ['В LM Studio откройте вкладку «Discover» (лупа) и скачайте Gemma 4 12B.', `Или откройте настройки тестировщика и впишите в "model" одну из: ${models.data.filter((m) => !/embed/i.test(m.id)).map((m) => m.id).join(', ')}.`]);
    else {
      ok(`2. Модель «${s.model}» есть`);
      // 3. модель умеет нажимать
      say('   Загружаю модель и даю пробное задание (до 2 минут)…');
      try {
        const t0 = Date.now();
        const r = await llm(s, { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Задание: открой раздел «Заявки».\n\nЭкран сейчас:\nАдрес: #home\nЭлементы:\n[1] кнопка «Заявки»\nРазделы меню: Сегодня, Заявки' }], tools: TOOLS, tool_choice: 'auto', max_tokens: 400 }, 180000);
        const tc = r.choices?.[0]?.message?.tool_calls?.[0];
        if (tc) ok(`3. Модель умеет нажимать кнопки (ответ за ${Math.round((Date.now() - t0) / 1000)} с: ${tc.function.name})`);
        else no('3. Модель отвечает текстом и не нажимает кнопки', ['В LM Studio выберите другую модель — с пометкой «Tool use» (молоток).']);
      } catch (e) {
        const ctx = /context|length|n_ctx|token/i.test(e.message);
        no('3. Модель не ответила: ' + e.message.slice(0, 120), ctx
          ? ['В LM Studio: вкладка «Developer» → справа у модели «Context Length» — поставьте 16384 и перезагрузите модель.']
          : ['В LM Studio: вкладка «Developer» → нажмите «Load Model» и выберите модель вручную.', 'Если не хватает памяти — закройте игры и тяжёлые программы.']);
      }
    }
  }
  // 4. браузер
  if (findBrowser()) ok('4. Браузер Edge/Chrome найден'); else no('4. Нет браузера Edge или Chrome', ['Установите Google Chrome или Microsoft Edge.']);
  // 5. стенд
  if (!isLocalStand(s.stand)) no(`5. Адрес стенда «${s.stand}» не на этом ПК`, ['Тестировщик работает только на стенде этого компьютера. Верните "stand": "http://localhost:3102".']);
  else if (await standReady(s.stand)) ok(`5. Стенд работает (${s.stand})`);
  else {
    if (!(await ensureDocker())) no('5. Docker не запущен — стенд поднять нельзя', ['Откройте программу Docker Desktop (значок кита).', 'Дождитесь внизу слева зелёной надписи «Engine running».', 'Нажмите эту кнопку ещё раз.']);
    else say('➖ 5. Стенд не запущен — тестировщик запустит его сам при старте (3–10 мин).');
  }
  if (hint || bad) say(bad ? `\nНе готово: ${bad}. Сделайте шаги со стрелкой → и нажмите «Проверить готовность» ещё раз.` : '\nВсё готово. Нажмите «Запустить ИИ-тестировщика».');
  return bad ? 1 : 0;
}

// ---------- последний отчёт ----------
function last() {
  if (!fs.existsSync(LOGS)) { say('Отчётов ещё нет.'); return 0; }
  const days = fs.readdirSync(LOGS).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d)).sort();
  const f = days.length && path.join(LOGS, days.at(-1), 'REPORT.md');
  if (!f || !fs.existsSync(f)) { say('Отчётов ещё нет.'); return 0; }
  say(path.relative(ROOT, f).replace(/\\/g, '/') + '\n');
  say(fs.readFileSync(f, 'utf8').split('\n').slice(0, 40).join('\n'));
  return 0;
}

// ---------- основной ход ----------
async function main() {
  if (suppliedSession && ['--detach', '--resume', '--watchdog', '--check', '--cleanup', '--stop', '--last', '--reviewed'].some(has)) {
    say('❌ Вход через stdin доступен только для запуска в текущем процессе.'); return 2;
  }
  if (has('--stop')) { fs.mkdirSync(LOGS, { recursive: true }); fs.writeFileSync(STOP_FILE, new Date().toISOString()); say('Попросил тестировщика остановиться. Он закончит текущий шаг, уберёт тестовые записи и напишет отчёт (до 2 минут).'); return 0; }
  if (has('--last')) return last();
  const s = loadSettings();
  { const i = args.indexOf('--model'); if (i >= 0 && args[i + 1]) s.model = args[i + 1]; } // сравнение моделей без правки настроек
  if (has('--check')) return check(s);
  if (has('--cleanup')) return cleanup(s);
  if (has('--watchdog')) return watchdog();
  if (has('--reviewed')) { // координатор разобрал отчёт: dc start его больше не показывает
    const i = args.indexOf('--reviewed'); const day = /^\d{4}-\d{2}-\d{2}$/.test(args[i + 1] || '') ? args[i + 1] : DAY;
    const dir = path.join(LOGS, day);
    if (!fs.existsSync(path.join(dir, 'REPORT.md'))) { say(`Отчёта за ${day} нет.`); return 2; }
    fs.writeFileSync(path.join(dir, 'REVIEWED'), new Date().toISOString()); say(`Отчёт за ${day} отмечен как разобранный.`); return 0;
  }
  const resume = has('--resume');
  const prevRun = readRun();
  if (resume && prevRun?.noWatchdog) return 0;
  if (prevRun && prevRun.pid !== process.pid && alive(prevRun.pid) && Date.now() - (prevRun.beat || 0) < DEAD_MS) {
    say('Тестировщик уже работает. Остановить — кнопка «Остановить ИИ-тестировщика».'); return suppliedSession ? 2 : 0;
  }
  if (resume && (!prevRun || Date.now() >= prevRun.until)) { fs.rmSync(RUN_FILE, { force: true }); return 0; }

  if (!isLocalStand(s.stand)) { say('❌ Тестировщик работает только на стенде этого ПК. Рабочий сайт он не трогает.'); return 2; }
  const loginFromStdin = suppliedSession ? await standLogin(s.stand) : null;
  if (suppliedSession && !loginFromStdin) { say('❌ Стенд отклонил сессию из stdin.'); return 2; }
  if (!has('--no-check') && !suppliedSession) {
    let bad = await check(s, { hint: false });
    if (bad && !resume) { // первый раз на этом ПК или LM Studio без модели — настроить ИИ самому, без отдельной кнопки
      say('Настраиваю ИИ на этом ПК (один раз, до 30 минут)…');
      spawnSync(process.execPath, [path.join(HERE, 'setup.mjs')], { stdio: 'inherit', windowsHide: true });
      bad = await check(s, { hint: false });
    }
    if (bad) return 2; // при продолжении run.json остаётся — сторож попробует снова через 10 мин (Docker ещё не встал)
  }
  if (has('--detach')) {
    // кнопка пульта: тестировщик работает отдельно от пульта — пульт свободен (обновляется, закрывается), окно не держит запуск
    const until = Date.now() + num('--minutes', 480) * 60000;
    fs.mkdirSync(OUT, { recursive: true });
    const log = fs.openSync(path.join(OUT, 'run.log'), 'a');
    const ch = spawn(process.execPath, [path.join(HERE, 'run.mjs'), '--no-check', '--until', String(until), ...(noWatchdog ? ['--no-watchdog'] : [])], { cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', log, log] });
    ch.unref();
    fs.writeFileSync(RUN_FILE, JSON.stringify({ until, day: DAY, pid: ch.pid, beat: Date.now(), noWatchdog: !!noWatchdog })); // второе нажатие сразу видит «уже работает»
    say(`
✅ ИИ-тестировщик запущен в фоне до ${new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`);
    say('Окно пульта можно закрыть. Отчёт Claude разберёт сам в начале следующей сессии.');
    return 0;
  }
  const until = resume ? prevRun.until : num('--until', 0) || Date.now() + num('--minutes', 480) * 60000;
  const minutes = Math.max(1, Math.round((until - Date.now()) / 60000));
  if (!resume) try { fs.rmSync(STOP_FILE, { force: true }); } catch { /* нет */ }
  fs.mkdirSync(OUT, { recursive: true });
  cleanLeftovers();
  const beat = () => fs.writeFileSync(RUN_FILE, JSON.stringify({ until, day: DAY, pid: process.pid, beat: Date.now(), noWatchdog: !!noWatchdog }));
  beat(); const beatTimer = setInterval(beat, BEAT_MS); beatTimer.unref();
  const awake = keepAwake();
  process.on('exit', () => {
    try { awake?.kill(); } catch { /* уже нет */ }
    if (noWatchdog && readRun()?.pid === process.pid) fs.rmSync(RUN_FILE, { force: true });
  });
  if (!resume && !noWatchdog) ensureWatchdogTask();
  if (resume) say(`
Продолжаю после обрыва до ${new Date(until).toLocaleTimeString('ru-RU')}.`);
  if (!(await (suppliedSession ? standReady(s.stand) : ensureStand(s.stand)))) { say(suppliedSession ? '❌ Стенд не готов.' : '❌ Стенд не поднялся.'); return 2; }
  const login = loginFromStdin || await standLogin(s.stand);
  if (!login) { say('❌ Не удалось войти на стенд. Запустите один раз «Большая проверка сайта» — она создаст вход.'); return 2; }
  const nav = readNav();
  if (!nav.length) { say('❌ Не нашёл меню приложения.'); return 2; }

  const saved = (() => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return null; } })(); // тот же день — отчёт дописывается
  const state = { tasks: saved?.tasks || [], findings: saved?.findings || [], garbage: new Set(), llmErrors: 0, until, tokenRenewals: saved?.tokenRenewals || 0, sessionRole: '' };
  // определяем роль: в отчёте видно, что проверяется именно менеджерский UX
  try {
    const meRes = await fetch(`${s.stand}/api/auth/me`, { headers: { Authorization: `Bearer ${login.access}` }, signal: AbortSignal.timeout(8000) });
    if (meRes.ok) { const me = await meRes.json(); state.sessionRole = me?.role || me?.user?.role || ''; say(`Вход: ${login.user?.username || 'stand-test'}, роль «${state.sessionRole || '—'}».`); }
    else say(`⚠ /api/auth/me вернул ${meRes.status} — роль неизвестна.`);
  } catch (e) { say('⚠ Не проверил роль: ' + e.message.slice(0, 60)); }
  const startedAt = saved?.startedAt || Date.now();
  if (saved && !resume) state.tasks.push({ at: nowTime(), title: '— новый запуск в этот же день —', result: 'получилось', steps: 0, summary: 'отчёт дописывается' });
  if (saved && resume) state.tasks.push({ at: nowTime(), title: '— обрыв: продолжил сторож —', result: 'не получилось', steps: 0, summary: 'тестировщик был прерван (перезагрузка, свет или сбой) и продолжил сам' });
  const created = loadCreated();
  const writeReport = (removed = null) => fs.writeFileSync(path.join(OUT, 'REPORT.md'), buildReport({ day: DAY, model: s.model, base: STAND_BASE, startedAt, now: Date.now(), tasks: state.tasks, findings: state.findings, created, removed, renewals: state.tokenRenewals, role: state.sessionRole }));
  say(`\nИИ-тестировщик работает ${minutes} мин на ${s.stand}. Остановить — кнопка «Остановить ИИ-тестировщика». Отчёт: tools/logs/ai-tester/${DAY}/REPORT.md\n`);

  let b; let browserAccess; let failed = false;
  let lastKnownToken = null; // для трекинга автоматического обновления access-токена браузером
  const relogin = async () => {
    const lg = loginFromStdin || await standLogin(s.stand);
    await b.cmd('Page.navigate', { url: s.stand + '/app/' }); await sleep(2000);
    const originCheck = suppliedSession ? `if (location.origin !== ${JSON.stringify(s.stand)}) return 0;` : '';
    const stored = await b.ev(`(() => { ${originCheck} localStorage.setItem('dca_access',${JSON.stringify(lg.access)});localStorage.setItem('dca_refresh',${JSON.stringify(lg.refresh ?? '')});localStorage.setItem('dca_user',${JSON.stringify(JSON.stringify(lg.user ?? {}))});return 1; })()`);
    if (suppliedSession && stored !== 1) throw new Error('Браузер не открыл стенд для входа.');
    await b.cmd('Page.reload', { ignoreCache: true }); await sleep(2500);
    b.net.length = 0; b.jsErrors.length = 0;
    lastKnownToken = lg.access; // сброс: новый токен выдан явно, не авто-обновлением
  };
  try {
    b = await openBrowser(s.stand);
    await relogin();
    let i = 0;
    const order = [...TASKS].sort(() => Math.random() - 0.5);
    while (Date.now() < state.until && !fs.existsSync(STOP_FILE)) {
      const t = order[i++ % order.length];
      if (!suppliedSession && i % order.length === 0) await relogin(); // браузер сам обновляет сессию из stdin
      await runTask(s, b, nav, t, state);
      // трекинг авто-продления access-токена приложением (PWA обновляет его в localStorage по 401)
      try {
        const curToken = await b.ev(`localStorage.getItem('dca_access')`);
        if (curToken && lastKnownToken && curToken !== lastKnownToken) { state.tokenRenewals++; say(`  ✓ Токен доступа обновлён автоматически (${nowTime()}, всего: ${state.tokenRenewals})`); }
        if (curToken) lastKnownToken = curToken;
      } catch { /* браузер закрылся */ }
      for (const c of b.created.splice(0)) if (!created.some((x) => x.id === c.id)) created.push({ ...c, at: new Date().toISOString() });
      saveCreated(created);
      writeReport();
      fs.writeFileSync(STATE_FILE, JSON.stringify({ startedAt, tasks: state.tasks, findings: state.findings, tokenRenewals: state.tokenRenewals }));
      if (state.llmErrors >= 3) { say('❌ ИИ трижды не ответил — останавливаюсь. Проверьте LM Studio кнопкой «Проверить готовность».'); break; }
    }
  } catch (e) {
    say('❌ Сбой: ' + (suppliedSession ? 'проверка сессии стенда прервана.' : e.message));
    failed = Boolean(suppliedSession);
  } finally {
    if (suppliedSession && b) {
      browserAccess = await b.ev(`location.origin === ${JSON.stringify(s.stand)} ? localStorage.getItem('dca_access') : null`).catch(() => null);
    }
    await b?.close();
  }
  say('\nУбираю тестовые записи…');
  const before = loadCreated().length;
  const cleanupCode = await cleanup(s, browserAccess);
  writeReport(before - loadCreated().length);
  // срок вышел или нажали «Остановить» — запуск закончен; иначе (сбой браузера, ИИ не отвечает) run.json остаётся и сторож продолжит
  clearInterval(beatTimer);
  if (fs.existsSync(STOP_FILE) || Date.now() >= until - 60000) fs.rmSync(RUN_FILE, { force: true });
  try { fs.rmSync(STOP_FILE, { force: true }); } catch { /* нет */ }
  const errs = state.findings.filter((f) => f.kind === 'ошибка').length;
  say(`\nГотово. Заданий: ${state.tasks.length}, ошибок сайта: ${errs}, замечаний ИИ: ${state.findings.length - errs}.`);
  say(`Отчёт: tools/logs/ai-tester/${DAY}/REPORT.md — скажите Claude «посмотри отчёт тестировщика».`);
  return suppliedSession && (failed || cleanupCode || state.llmErrors >= 3) ? 2 : errs ? 1 : 0;
}

main().then((c) => process.exit(c ?? 0), (e) => { console.error('Сбой: ' + (suppliedSession ? 'запуск с сессией из stdin отклонён.' : (e?.stack || e))); process.exit(2); });
