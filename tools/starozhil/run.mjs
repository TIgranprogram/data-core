#!/usr/bin/env node
// Старожил: исполнитель нарядов. Локальный ИИ (LM Studio) читает проект только на чтение и пишет итог наряда.
//   node tools/starozhil/run.mjs --list              очередь нарядов и что сделано
//   node tools/starozhil/run.mjs --next [--detach]   следующий наряд по приоритету (кнопка пульта — с --detach)
//   node tools/starozhil/run.mjs --job <id> [--detach]  конкретный наряд
//   node tools/starozhil/run.mjs --stop              остановить (допишет итог)
//   node tools/starozhil/run.mjs --last              коротко: итог последнего наряда (≤ 30 строк — это читает Claude)
// Наряды — starozhil/jobs/*.md. Итог — tools/logs/starozhil/<наряд>/<время>/RESULT.md. Код выхода: 0 норма · 2 сбой.
// Модель не пишет в проект и в сайт: инструменты только смотрят; секреты, .data, node_modules закрыты (lib.mjs isDenied).
import { execFileSync, spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadSettings, llm, ensureLLM } from '../ai-tester/llm.mjs';
import { parseFront, pickNext, safePath, isDenied, trimMessages, checkRefs } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const JOBS = path.join(ROOT, 'starozhil', 'jobs');
const LOGS = path.join(ROOT, 'tools', 'logs', 'starozhil');
const RUN_FILE = path.join(LOGS, 'run.json');
const STOP_FILE = path.join(LOGS, 'STOP');
const HISTORY = path.join(LOGS, 'history.json');
const TESTER_RUN = path.join(ROOT, 'tools', 'logs', 'ai-tester', 'run.json');
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const arg = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const say = (s) => console.log(s);
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const busy = (f) => { const r = readJson(f, null); return r && r.pid && alive(r.pid) && Date.now() - (r.beat || 0) < 25 * 60000 ? r : null; };

function loadJobs() {
  if (!fs.existsSync(JOBS)) return [];
  return fs.readdirSync(JOBS).filter((f) => /^\d{3}-.+\.md$/.test(f)).map((f) => {
    const { meta, body } = parseFront(fs.readFileSync(path.join(JOBS, f), 'utf8'));
    return { id: f.replace(/\.md$/, ''), file: f, meta, body };
  });
}

// ---------- инструменты модели (только чтение) ----------
const TOOLS = [
  { name: 'list_dir', description: 'Список файлов и папок (папка от корня проекта)', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'read_file', description: 'Прочитать файл: с какой строки и сколько (не больше 120)', parameters: { type: 'object', properties: { path: { type: 'string' }, from: { type: 'integer' }, lines: { type: 'integer' } }, required: ['path'] } },
  { name: 'search', description: 'Найти текст в файлах папки (без учёта регистра). Вернёт до 40 мест «файл:строка: текст»', parameters: { type: 'object', properties: { text: { type: 'string' }, path: { type: 'string' } }, required: ['text'] } },
  { name: 'note', description: 'Записать вывод в свои записи. Старые ответы инструментов забываются — важное сразу записывай сюда', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'finish', description: 'Закончить наряд: итог в формате из наряда', parameters: { type: 'object', properties: { result: { type: 'string', enum: ['готово', 'не вышло'] }, report: { type: 'string' } }, required: ['result', 'report'] } },
].map((f) => ({ type: 'function', function: f }));

const TEXT_EXT = /\.(m?[jt]s|json|md|txt|css|html|ya?ml|sh|cmd|ps1|vbs|iLogicVb)$/i;
function walk(dir, out = [], cap = 4000) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (out.length >= cap) break;
    const p = path.join(dir, e.name); const rel = path.relative(ROOT, p);
    if (isDenied(rel) || rel.startsWith(path.join('tools', 'logs'))) continue;
    if (e.isDirectory()) walk(p, out, cap); else if (TEXT_EXT.test(e.name)) out.push(p);
  }
  return out;
}

function runTool(name, a) {
  if (name === 'list_dir') {
    const d = safePath(ROOT, a.path); if (!d || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) return `Папки «${a.path}» нет или она закрыта.`;
    const items = fs.readdirSync(d, { withFileTypes: true }).filter((e) => !isDenied(path.relative(ROOT, path.join(d, e.name)))).slice(0, 120);
    return items.map((e) => (e.isDirectory() ? e.name + '/' : `${e.name} (${fs.statSync(path.join(d, e.name)).size} Б)`)).join('\n') || '(пусто)';
  }
  if (name === 'read_file') {
    const f = safePath(ROOT, a.path); if (!f || !fs.existsSync(f) || !fs.statSync(f).isFile()) return `Файла «${a.path}» нет или он закрыт.`;
    const all = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    const from = Math.max(1, Number(a.from) || 1); const n = Math.min(120, Math.max(1, Number(a.lines) || 120));
    const part = all.slice(from - 1, from - 1 + n).map((l, i) => `${from + i}: ${l.slice(0, 220)}`).join('\n').slice(0, 7000);
    return `${a.path} — строки ${from}–${Math.min(all.length, from + n - 1)} из ${all.length}\n${part}`;
  }
  if (name === 'search') {
    const d = safePath(ROOT, a.path || '.'); if (!d || !fs.existsSync(d)) return `Папки «${a.path}» нет или она закрыта.`;
    const want = String(a.text || '').toLowerCase(); if (want.length < 2) return 'Слишком короткий текст.';
    const hits = [];
    for (const f of fs.statSync(d).isFile() ? [d] : walk(d)) {
      const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length && hits.length < 40; i++) if (lines[i].toLowerCase().includes(want)) hits.push(`${path.relative(ROOT, f).replace(/\\/g, '/')}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
      if (hits.length >= 40) break;
    }
    return hits.length ? hits.join('\n') : 'Не найдено.';
  }
  return `Неизвестный инструмент ${name}.`;
}

const SYSTEM = `Ты — локальный помощник проекта «Рабочее место» (data-core: сервер NestJS + MongoDB, приложение backend/pwa на чистом JS).
Выполняешь один наряд: читаешь проект и пишешь итог. Проект менять нельзя — инструменты только смотрят.
Правила:
1. Вызывай ровно ОДИН инструмент за ход.
2. Каждый вывод подтверждай местом: файл:строка. Не знаешь — пиши «не нашёл», не выдумывай.
3. Старые ответы инструментов забываются. Нашёл важное — сразу note.
4. Читай частями: сначала search или list_dir, потом read_file нужных строк.
5. Когда наряд выполнен или шаги кончаются — finish с итогом в формате наряда. Пиши по-русски, коротко.`;

async function runJob(s, job, until) {
  const dir = path.join(LOGS, job.id, stamp()); fs.mkdirSync(dir, { recursive: true });
  const log = (l) => fs.appendFileSync(path.join(dir, 'steps.log'), `${new Date().toLocaleTimeString('ru-RU')} ${l}\n`);
  const notes = [];
  const brief = () => `Наряд ${job.id}:\n${job.body.trim()}\n\nТвои записи:\n${notes.length ? notes.map((n, i) => `${i + 1}. ${n}`).join('\n') : '(пока нет)'}`;
  const msgs = [{ role: 'system', content: SYSTEM }, { role: 'user', content: brief() }];
  const steps = Number(job.meta.steps) || 60;
  let result = 'не вышло'; let report = ''; let fails = 0; let repeats = 0; const seen = [];
  say(`Наряд ${job.id}: до ${steps} шагов, до ${new Date(until).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}.`);
  for (let step = 1; step <= steps; step++) {
    if (fs.existsSync(STOP_FILE) || Date.now() > until) { report = 'Остановлено по времени или кнопке.'; break; }
    if (step === steps - 2) msgs.push({ role: 'user', content: 'Осталось 2 шага. Вызови finish с итогом по тому, что успел.' });
    msgs[1].content = brief();
    let res;
    try { res = await llm(s, { messages: trimMessages(msgs, 4), tools: TOOLS, tool_choice: 'required', max_tokens: 1800 }, 300000); fails = 0; }
    catch (e) {
      log('ИИ не ответил: ' + e.message.slice(0, 120));
      if (++fails >= 3) { report = 'ИИ трижды не ответил: ' + e.message.slice(0, 150); break; }
      await ensureLLM(s, say); step--; continue;
    }
    const m = res.choices?.[0]?.message || {}; const tc = (m.tool_calls || [])[0];
    if (!tc) { msgs.push({ role: 'assistant', content: m.content || '' }, { role: 'user', content: 'Вызови один инструмент.' }); continue; }
    let a = {}; try { a = JSON.parse(tc.function.arguments || '{}'); } catch { /* пусто */ }
    log(`#${step} ${tc.function.name} ${JSON.stringify(a).slice(0, 200)}`);
    msgs.push({ role: 'assistant', content: '', tool_calls: [{ id: tc.id, type: 'function', function: { name: tc.function.name, arguments: tc.function.arguments || '{}' } }] });
    if (tc.function.name === 'finish') { result = a.result === 'готово' ? 'готово' : 'не вышло'; report = String(a.report || ''); break; }
    let out;
    // тот же вызов в третий раз за 10 шагов — не выполнять: модель ходит по кругу (второй раз можно — старый ответ мог забыться)
    const sig = tc.function.name + JSON.stringify(a); const prior = seen.slice(-10).filter((x) => x === sig).length; seen.push(sig);
    if (prior >= 2 && tc.function.name !== 'note') { out = 'Ты это читал уже дважды. Запиши вывод через note и переходи к следующей части наряда, либо finish.'; if (++repeats >= 6) msgs.push({ role: 'user', content: 'Ты повторяешься. Вызови finish с итогом по тому, что успел.' }); }
    else if (tc.function.name === 'note') { notes.push(String(a.text || '').slice(0, 1500)); out = `Записал (${notes.length}).`; }
    else { try { out = runTool(tc.function.name, a); } catch (e) { out = 'Не вышло: ' + e.message.slice(0, 120); } if (prior === 1) out = 'Ты это уже читал — после ответа сразу запиши вывод через note.\n' + out; }
    msgs.push({ role: 'tool', tool_call_id: tc.id, content: out });
  }
  if (!report && notes.length) report = 'Итог не написан — записи модели:\n' + notes.map((n) => '- ' + n).join('\n');
  // ссылки «файл:строка» из итога — проверить программой: выдуманные видны сразу
  const refs = checkRefs(report, (f) => { const a = safePath(ROOT, f); try { return a ? fs.readFileSync(a, 'utf8').split(/\r?\n/).length : null; } catch { return null; } });
  const refLine = refs.total ? `- Ссылки «файл:строка»: верных ${refs.total - refs.bad.length} из ${refs.total}${refs.bad.length ? ` (нет: ${refs.bad.slice(0, 5).map((b) => `${b.file}:${b.line}`).join(', ')})` : ''}` : '- Ссылок «файл:строка» нет';
  fs.writeFileSync(path.join(dir, 'notes.md'), notes.map((n) => '- ' + n).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'RESULT.md'), `# ${job.id} — ${result}\n\n- Модель: ${s.model}\n- Записей: ${notes.length}\n${refLine}\n\n${report}\n`);
  const rel = path.relative(ROOT, dir).replace(/\\/g, '/');
  const hist = readJson(HISTORY, []); hist.push({ id: job.id, at: Date.now(), result, dir: rel }); fs.writeFileSync(HISTORY, JSON.stringify(hist.slice(-500), null, 1));
  fs.writeFileSync(path.join(LOGS, 'last.json'), JSON.stringify({ id: job.id, result, dir: rel, at: Date.now() }));
  say(`Наряд ${job.id}: ${result}. Итог: ${rel}/RESULT.md`);
  return result;
}

function last() {
  const l = readJson(path.join(LOGS, 'last.json'), null);
  if (!l) { say('Нарядов ещё не было.'); return 0; }
  const text = fs.readFileSync(path.join(ROOT, l.dir, 'RESULT.md'), 'utf8').split('\n');
  say(text.slice(0, 30).join('\n') + (text.length > 30 ? `\n… полностью: ${l.dir}/RESULT.md` : ''));
  return 0;
}

function list() {
  const hist = readJson(HISTORY, []);
  const jobs = loadJobs().sort((a, b) => (Number(a.meta.priority) || 99) - (Number(b.meta.priority) || 99));
  if (!jobs.length) { say('Нарядов нет.'); return 0; }
  const next = pickNext(jobs, hist);
  for (const j of jobs) {
    const h = hist.filter((x) => x.id === j.id).pop();
    say(`${j === next ? '▶' : ' '} ${j.id} · приоритет ${j.meta.priority ?? '—'} · ${j.meta.status}${j.meta.repeat ? ' · повторяется' : ''}${h ? ` · последний: ${h.result} ${new Date(h.at).toLocaleString('ru-RU')}` : ''}`);
  }
  const run = busy(RUN_FILE); if (run) say(`\nСейчас работает: ${run.job}.`);
  return 0;
}

async function main() {
  fs.mkdirSync(LOGS, { recursive: true });
  if (has('--stop')) { fs.writeFileSync(STOP_FILE, new Date().toISOString()); say('Попросил остановиться: закончит шаг и запишет итог.'); return 0; }
  if (has('--last')) return last();
  if (has('--list')) return list();
  const jobs = loadJobs();
  const job = arg('--job') ? jobs.find((j) => j.id === arg('--job') || j.id.startsWith(arg('--job') + '-')) : pickNext(jobs, readJson(HISTORY, []));
  if (!job) { say(arg('--job') ? `Наряда «${arg('--job')}» нет.` : 'Очередь пуста: все наряды выполнены. Claude добавит новые.'); return 0; }
  const running = busy(RUN_FILE);
  if (running && running.pid !== process.pid) { say(`Уже работает наряд ${running.job}. Дождитесь конца или нажмите «Остановить наряд».`); return 0; }
  if (busy(TESTER_RUN)) { say('Сейчас работает ИИ-тестировщик — видеокарта занята. Запустите наряд после него.'); return 0; }
  if (has('--detach')) {
    const out = fs.openSync(path.join(LOGS, 'run.log'), 'a');
    const ch = spawn(process.execPath, [path.join(HERE, 'run.mjs'), '--job', job.id], { cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', out, out] });
    ch.unref();
    fs.writeFileSync(RUN_FILE, JSON.stringify({ pid: ch.pid, job: job.id, beat: Date.now() }));
    say(`✅ Наряд ${job.id} запущен в фоне. Окно пульта можно закрыть. Итог Claude прочитает сам.`);
    return 0;
  }
  const s = loadSettings();
  if (!(await ensureLLM(s, say))) { say('❌ Локальный ИИ не отвечает. Пульт → ИИ-тестировщик → «Установить ИИ на этом ПК».'); return 2; }
  try { fs.rmSync(STOP_FILE, { force: true }); } catch { /* нет */ }
  const beat = () => fs.writeFileSync(RUN_FILE, JSON.stringify({ pid: process.pid, job: job.id, beat: Date.now() }));
  beat(); const t = setInterval(beat, 60000); t.unref();
  // подготовка фактов программой (только скрипты Старожила): наряд потом судит по готовой таблице
  for (const p of [].concat(job.meta.prepare || [])) {
    if (!/^tools\/starozhil\/[\w-]+\.mjs$/.test(p)) { say(`⚠ Подготовка «${p}» пропущена: только скрипты tools/starozhil.`); continue; }
    say('Готовлю факты: ' + execFileSync(process.execPath, [path.join(ROOT, p)], { cwd: ROOT, encoding: 'utf8', timeout: 600000 }).trim());
  }
  const until = Date.now() + (Number(job.meta.minutes) || 120) * 60000;
  try { await runJob(s, job, until); }
  finally { clearInterval(t); if (readJson(RUN_FILE, {}).pid === process.pid) fs.rmSync(RUN_FILE, { force: true }); try { fs.rmSync(STOP_FILE, { force: true }); } catch { /* нет */ } }
  return 0;
}

main().then((c) => process.exit(c ?? 0), (e) => { console.error('Сбой: ' + (e?.stack || e)); process.exit(2); });
