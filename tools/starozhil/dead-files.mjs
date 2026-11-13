#!/usr/bin/env node
// Старожил: «мёртвые» файлы — программой. Файл в git, на имя которого нет ни одной ссылки в других файлах проекта.
//   node tools/starozhil/dead-files.mjs   → tools/logs/starozhil/dead-files.md
// Не удаляет: список читает наряд (раз в неделю) и Claude; удаление — только после проверки.
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'logs', 'starozhil', 'dead-files.md');
const TEXT = /(\.(m?[jt]s|json|md|txt|css|html|ya?ml|sh|cmd|ps1|vbs|py|iLogicVb|conf)|(^|\/)Dockerfile[^/]*)$/i;
// где ищем кандидатов; точки входа (их никто не обязан упоминать) — исключены ниже
const SCOPE = /^(tools|backend\/scripts|deploy|pult|remote-access|SRV-ERP|apps|mcp|docs)\//;
// apps/ — собираемые программы (C#): файлы проекта берутся сборкой целиком, по имени их не упоминают
const SKIP = /^apps\/|^docs\/(archive|crew)\/|\/(README|index|main|package(-lock)?)\.|\.(spec|test)\.|\/test\/|node_modules|\.gitignore$|^backend\/scripts\/archive\//;

const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8', windowsHide: true, maxBuffer: 64 << 20 }).split('\n').filter(Boolean);
const texts = files.filter((f) => TEXT.test(f));
const body = new Map(texts.map((f) => { try { return [f, fs.readFileSync(path.join(ROOT, f), 'utf8')]; } catch { return [f, '']; } }));
const dead = [];
for (const f of files) {
  if (!SCOPE.test(f) || SKIP.test(f)) continue;
  const base = path.basename(f); const stem = base.replace(/\.[^.]+$/, '');
  const used = texts.some((o) => o !== f && (body.get(o).includes(base) || (stem.length > 5 && body.get(o).includes(stem))));
  if (!used) dead.push(`- ${f} (${fs.existsSync(path.join(ROOT, f)) ? fs.statSync(path.join(ROOT, f)).size : 0} Б)`);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `# Мёртвые файлы (${new Date().toISOString().slice(0, 10)}): нет ни одной ссылки по имени\n\n${dead.join('\n') || 'нет'}\n`);
console.log(`Мёртвых файлов: ${dead.length} → tools/logs/starozhil/dead-files.md`);
