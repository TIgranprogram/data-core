#!/usr/bin/env node
// Локальный ИИ: установить и настроить LM Studio под проект на этом ПК (дома и на работе одинаково).
//   node tools/ai-tester/setup.mjs
// Что делает: проверяет LM Studio → память модели 16 тыс. токенов → сервер на порту 1235 →
// подбирает модель по видеокарте и скачивает, если её нет → загружает → настройки тестировщика и «Excel заказа».
// Настройки LM Studio перед правкой копируются в settings.json.bak-data-core. Код выхода: 0 готово · 1 нужен шаг человека · 2 сбой.
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const LMDIR = path.join(os.homedir(), '.lmstudio');
const LMS = path.join(LMDIR, 'bin', process.platform === 'win32' ? 'lms.exe' : 'lms');
const PORT = '1235';
const BASE = `http://localhost:${PORT}/v1`;
const CONTEXT = 16384;
const say = (s) => console.log(s);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const lms = (args, timeout = 120000) => { const r = spawnSync(LMS, args, { encoding: 'utf8', timeout, windowsHide: true }); return { ok: r.status === 0, out: clean(r.stdout) + clean(r.stderr) }; };

/** Модель по памяти видеокарты: 12 ГБ и больше — Gemma 4 12B (видит картинки, умеет нажимать); меньше — Gemma 4 E4B. */
export function pickModel(vramMiB) {
  if (vramMiB >= 11000) return { id: 'google/gemma-4-12b-qat', why: `видеокарта ${Math.round(vramMiB / 1024)} ГБ — хватает на Gemma 4 12B` };
  return { id: 'google/gemma-4-e4b', why: vramMiB ? `видеокарта ${Math.round(vramMiB / 1024)} ГБ — берём лёгкую Gemma 4 E4B` : 'видеокарты NVIDIA нет — лёгкая Gemma 4 E4B (будет медленно)' };
}

function vram() {
  const r = spawnSync('nvidia-smi', ['--query-gpu=memory.total', '--format=csv,noheader,nounits'], { encoding: 'utf8', windowsHide: true });
  return r.status === 0 ? Math.max(...String(r.stdout).split(/\r?\n/).map(Number).filter(Boolean), 0) : 0;
}

/** LM Studio отвечает, но требует ключ доступа (Developer → Server Settings → Require Authentication). */
let needToken = false;
async function up() {
  try {
    const j = await (await fetch(`${BASE}/models`, { headers: { Authorization: 'Bearer lm-studio' }, signal: AbortSignal.timeout(5000) })).json();
    needToken = !j?.data && /token|authentication/i.test(JSON.stringify(j?.error || ''));
    return j?.data || null;
  } catch { return null; }
}

/** Записать JSON-настройку, не трогая остальные поля. */
function mergeJson(file, patch, backup) {
  let cur = {};
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8');
    if (backup && !fs.existsSync(backup)) fs.writeFileSync(backup, text);
    cur = JSON.parse(text);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ ...cur, ...patch }, null, 2) + '\n');
}

async function main() {
  say('Настраиваю локальный ИИ на этом компьютере:\n');
  // 1. LM Studio установлен?
  if (!fs.existsSync(LMS)) {
    say('❌ 1. LM Studio не установлен (или ни разу не запускался).');
    say('   → Откройте сайт lmstudio.ai и нажмите «Download for Windows».');
    say('   → Установите программу и один раз откройте её (можно пропустить все вопросы).');
    say('   → Нажмите эту кнопку ещё раз.');
    return 1;
  }
  say('✅ 1. LM Studio установлен');

  // 2. память модели и время жизни модели в памяти (по умолчанию памяти мало — длинный экран не влезает)
  const st = path.join(LMDIR, 'settings.json');
  try {
    const cur = fs.existsSync(st) ? JSON.parse(fs.readFileSync(st, 'utf8')) : {};
    mergeJson(st, {
      defaultContextLength: { type: 'custom', value: CONTEXT },
      developer: { ...(cur.developer || {}), jitModelTTL: { enabled: true, ttlSeconds: 3600 }, separateReasoningContentInAPI: true },
    }, st + '.bak-data-core');
    say(`✅ 2. Память модели по умолчанию — ${CONTEXT} токенов (старые настройки сохранены рядом: settings.json.bak-data-core)`);
  } catch (e) { say('⚠ 2. Настройки LM Studio не изменил: ' + e.message.slice(0, 100)); }

  // 3. сервер
  if (!(await up())) {
    say(`   Запускаю сервер LM Studio на порту ${PORT}…`);
    lms(['server', 'start', '--port', PORT], 90000);
    for (let i = 0; i < 20 && !(await up()); i++) await sleep(1500);
  }
  if (!(await up()) && needToken) {
    say(`❌ 3. Сервер LM Studio работает на порту ${PORT}, но требует ключ доступа — тестировщик без ключа не пройдёт.`);
    say('   → Откройте LM Studio → слева «Developer» → «Server Settings».');
    say('   → Выключите «Require Authentication» (сервер виден только этому компьютеру).');
    say('   → Нажмите эту кнопку ещё раз.');
    return 1;
  }
  if (!(await up())) {
    say(`❌ 3. Сервер LM Studio не запустился на порту ${PORT}.`);
    say('   → Откройте LM Studio → слева «Developer» → включите «Status: Running», порт 1235.');
    return 1;
  }
  say(`✅ 3. Сервер работает: ${BASE}`);

  // 4. модель по видеокарте
  const pick = pickModel(vram());
  say(`   Модель: ${pick.id} (${pick.why})`);
  const have = lms(['ls']).out;
  if (!have.includes(pick.id)) {
    say('   Скачиваю модель (5–8 ГБ, 5–30 минут — зависит от интернета)…');
    const g = lms(['get', pick.id, '--gguf', '-y'], 3 * 60 * 60 * 1000);
    if (!lms(['ls']).out.includes(pick.id)) {
      say('❌ 4. Модель не скачалась: ' + g.out.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 200));
      say('   → Откройте LM Studio → вкладка «Discover» (лупа) → найдите «gemma 4 12b» → Download.');
      return 1;
    }
  }
  say(`✅ 4. Модель ${pick.id} есть`);

  // 5. загрузить с нужной памятью
  const ps = lms(['ps']).out;
  if (!ps.includes(pick.id) || !ps.includes(String(CONTEXT))) {
    say('   Загружаю модель в видеокарту…');
    lms(['unload', '--all'], 60000);
    const l = lms(['load', pick.id, '--context-length', String(CONTEXT), '--gpu', 'max', '-y'], 300000);
    if (!l.ok) { say('❌ 5. Модель не загрузилась: ' + l.out.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 200)); say('   → Закройте игры и тяжёлые программы и нажмите кнопку ещё раз.'); return 1; }
  }
  say('✅ 5. Модель загружена');

  // 6. настройки наших инструментов
  mergeJson(path.join(ROOT, 'tools/ai-tester/settings.json'), { ...JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ai-tester/settings.example.json'), 'utf8')), ...(fs.existsSync(path.join(ROOT, 'tools/ai-tester/settings.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, 'tools/ai-tester/settings.json'), 'utf8')) : {}), baseUrl: BASE, model: pick.id });
  const ord = path.join(ROOT, 'tools/local-ai-order/settings.json');
  const ordEx = path.join(ROOT, 'tools/local-ai-order/settings.example.json');
  // свой адрес у «Excel заказа» (например, ИИ на другом ПК) — оставить, если он отвечает
  const ordCur = fs.existsSync(ord) ? JSON.parse(fs.readFileSync(ord, 'utf8')) : null;
  let ordAlive = false;
  if (ordCur?.baseUrl) { try { ordAlive = (await fetch(String(ordCur.baseUrl).replace(/\/+$/, '') + '/models', { signal: AbortSignal.timeout(5000) })).ok; } catch { /* не отвечает */ } }
  if (fs.existsSync(ordEx) && !ordAlive) mergeJson(ord, { ...JSON.parse(fs.readFileSync(ordEx, 'utf8')), ...(ordCur || {}), baseUrl: BASE, model: pick.id });
  say('✅ 6. ИИ-тестировщик и «Собрать Excel заказа» смотрят на эту модель');

  say('\nГотово. Дальше: «ИИ-тестировщик: 1. Проверить готовность».');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((c) => process.exit(c), (e) => { console.error('Сбой: ' + e.message); process.exit(2); });
}
