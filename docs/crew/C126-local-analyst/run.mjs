#!/usr/bin/env node
// C126 на домашнем ПК (Windows): то же задание, что на ноутбуке в Open WebUI, но без чата — раннер сам ведёт модель.
//   node docs/crew/C126-local-analyst/run.mjs --model <id LM Studio> [--steps 60]
// Модели даются ровно два инструмента, как на ноутбуке: run_command (только `bash …/scan.sh …`, только чтение)
// и append_report (дописать в отчёт). Отчёт модели — REPORT-<модель>.md рядом; время и шаги — в его хвосте.
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadSettings, llm, ensureLLM } from '../../../tools/ai-tester/llm.mjs';
import { findBash } from '../../../tools/dc.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const args = process.argv.slice(2);
const arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const s = loadSettings();
s.model = arg('--model', s.model);
s.temperature = 0.7; // как на ноутбуке (0.2 там зацикливало)
const STEPS = Number(arg('--steps', 60));
const slug = s.model.replace(/[^a-z0-9.-]+/gi, '_');
const REPORT = path.join(HERE, `REPORT-${slug}.md`);
const relReport = path.relative(ROOT, REPORT).replace(/\\/g, '/');
fs.writeFileSync(REPORT, `# C126 — отчёт модели ${s.model} (домашний ПК, ${new Date().toISOString().slice(0, 16).replace('T', ' ')})\n\n`);

const BASH = findBash();
const SCAN = /^bash docs\/crew\/C126-local-analyst\/scan\.sh( (next|status|[1-5])( [\w./-]+)?)?$/;
function runCommand(cmd) {
  const c = String(cmd || '').trim();
  if (!SCAN.test(c)) return 'Отказ: можно только `bash docs/crew/C126-local-analyst/scan.sh <next|1..5> [файл]`.';
  const r = spawnSync(BASH, ['-c', c], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, C126_REPORT: relReport }, maxBuffer: 8 * 1024 * 1024, timeout: 120000 });
  return ((r.stdout || '') + (r.stderr ? '\n' + r.stderr : '')).slice(0, 12000) || '(пусто)';
}

const tasksText = fs.readFileSync(path.join(HERE, 'TASKS.md'), 'utf8').replace('Папка — `~/data-core`.', 'Папка проекта уже открыта.').replace(/1\. `set_folder\("~\/data-core"\)`\.\n/, '');
const TOOLS = [
  { name: 'run_command', description: 'Выполнить команду. Разрешено только: bash docs/crew/C126-local-analyst/scan.sh <next|1..5> [файл]', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'append_report', description: 'Дописать текст в отчёт REPORT.md (одна задача — один вызов)', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
].map((f) => ({ type: 'function', function: f }));

const msgs = [{ role: 'system', content: tasksText }, { role: 'user', content: 'Начинай: выполни все оставшиеся задачи подряд.' }];
const t0 = Date.now(); let steps = 0; let calls = 0; let refused = 0; let idle = 0; let tokens = 0;
await ensureLLM(s, () => {});
for (; steps < STEPS; steps++) {
  if (/ВСЕ 5 ЗАДАЧ ЗАВЕРШЕНЫ/.test(runCommand('bash docs/crew/C126-local-analyst/scan.sh next'))) break;
  const res = await llm(s, { messages: msgs, tools: TOOLS, max_tokens: 2500 }, 600000);
  tokens += res.usage?.completion_tokens || 0;
  const m = res.choices?.[0]?.message || {};
  const tcs = m.tool_calls || [];
  msgs.push({ role: 'assistant', content: m.content || '', ...(tcs.length ? { tool_calls: tcs } : {}) });
  if (!tcs.length) { if (++idle > 3) break; msgs.push({ role: 'user', content: 'Продолжай: вызови инструмент (scan.sh next).' }); continue; }
  idle = 0;
  for (const tc of tcs) {
    calls++;
    let a = {}; try { a = JSON.parse(tc.function.arguments || '{}'); } catch { /* пусто */ }
    let out;
    if (tc.function.name === 'run_command') { out = runCommand(a.command); if (out.startsWith('Отказ')) refused++; }
    else if (tc.function.name === 'append_report') { fs.appendFileSync(REPORT, String(a.text || '').trim() + '\n\n'); out = 'Записано в отчёт.'; }
    else out = 'Нет такого инструмента.';
    msgs.push({ role: 'tool', tool_call_id: tc.id, content: out });
  }
}
const sec = Math.round((Date.now() - t0) / 1000);
const done = (fs.readFileSync(REPORT, 'utf8').match(/^## Задача [1-5] /gm) || []).length;
const tail = `\n---\nИтог раннера: задач ${done}/5 · ${Math.floor(sec / 60)} мин ${sec % 60} с · шагов ${steps} · вызовов ${calls} · отказов ${refused} · токенов ответа ${tokens} (${sec ? Math.round(tokens / sec) : 0} ток/с в среднем по прогону)\n`;
fs.appendFileSync(REPORT, tail);
console.log(`${s.model}: ${tail.trim()} → ${relReport}`);
