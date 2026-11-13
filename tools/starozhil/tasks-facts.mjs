#!/usr/bin/env node
// Старожил: факты по открытым пунктам docs/TASKS.md — программой, без ИИ (наряд потом только судит).
//   node tools/starozhil/tasks-facts.mjs [--from N --to M]   → tools/logs/starozhil/tasks-facts.md
// Для пункта: что в `обратных кавычках` и коды задач (C049-1, АБЗ-3) → файл есть? сколько мест в коде? упоминается ли в git log?
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { taskItems, itemTokens } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const out = path.join(ROOT, 'tools', 'logs', 'starozhil', 'tasks-facts.md');
const args = process.argv.slice(2);
const num = (f, d) => { const i = args.indexOf(f); return i >= 0 ? Number(args[i + 1]) || d : d; };

const text = fs.readFileSync(path.join(ROOT, 'docs', 'TASKS.md'), 'utf8');
const items = taskItems(text).filter((x) => x.line >= num('--from', 1) && x.line <= num('--to', 1e9));
const gitLog = execFileSync('git', ['log', '--since=2026-10-01', '--format=%h %s'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const grepCount = (t) => {
  try { return execFileSync('git', ['grep', '-c', '-F', '-e', t, '--', 'backend/src', 'backend/pwa', 'backend/admin', 'tools', 'deploy'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').reduce((s, l) => s + Number(l.split(':').pop() || 0), 0); } catch { return 0; }
};
const rows = items.map((it) => {
  const facts = itemTokens(it.text).map((t) => {
    if (t.kind === 'path') return `${t.v}: ${fs.existsSync(path.join(ROOT, t.v)) ? 'файл есть' : 'файла нет'}`;
    if (t.kind === 'code') { const hits = gitLog.split('\n').filter((l) => l.includes(t.v)); return `${t.v}: коммитов ${hits.length}${hits[0] ? ` (последний ${hits[0].slice(0, 70)})` : ''}`; }
    return `«${t.v}»: в коде ${grepCount(t.v)}`;
  });
  return `| ${it.line} | ${it.state} | ${it.text.replace(/\|/g, '/').slice(0, 110)} | ${facts.join('; ').replace(/\|/g, '/') || '—'} |`;
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `# Факты по TASKS.md (${new Date().toISOString().slice(0, 16)})\n\n| Строка | Отметка | Пункт | Факты |\n|--|--|--|--|\n${rows.join('\n')}\n`);
console.log(`Пунктов: ${rows.length}. Таблица: ${path.relative(ROOT, out).replace(/\\/g, '/')}`);
