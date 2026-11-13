#!/usr/bin/env node
// Старожил: факты о модулях сервера — программой, без ИИ. Наряд «карточка модуля» описывает их словами.
//   node tools/starozhil/module-facts.mjs [модуль]  → tools/logs/starozhil/modules/<модуль>.md (без имени — все)
// Маршруты (@Controller + @Get/@Post/…), коллекции (@Schema collection / db.collection('…')), тексты отказов, размеры файлов.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleRoutes } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODS = path.join(ROOT, 'backend', 'src', 'modules');
const OUT = path.join(ROOT, 'tools', 'logs', 'starozhil', 'modules');
const only = process.argv[2];

function files(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.ts$/.test(e.name) && !/\.spec\.ts$|testkit/.test(e.name) ? [path.join(dir, e.name)] : []));
}

function facts(name) {
  const fl = files(path.join(MODS, name));
  const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
  const routes = []; const colls = new Set(); const refusals = []; const sizes = [];
  for (const f of fl) {
    const src = fs.readFileSync(f, 'utf8'); const lines = src.split(/\r?\n/);
    sizes.push([rel(f), lines.length]);
    if (f.endsWith('.controller.ts')) for (const r of moduleRoutes(src)) routes.push(`${r.method} /api/${r.path} — ${rel(f)}:${r.line}`);
    for (const [, c] of src.matchAll(/collection:\s*'([\w-]+)'/g)) colls.add(c);
    for (const [, c] of src.matchAll(/\.collection\(\s*'([\w-]+)'/g)) colls.add(c);
    lines.forEach((l, i) => { const m = /(BadRequest|Forbidden|Conflict|NotFound)Exception\(\s*[`'"]([^`'"]{6,160})/.exec(l); if (m) refusals.push(`${m[1]}: «${m[2]}» — ${rel(f)}:${i + 1}`); });
  }
  sizes.sort((a, b) => b[1] - a[1]);
  return [`# Модуль ${name} — факты (${new Date().toISOString().slice(0, 10)})`, '',
    `## Файлы (${fl.length}, строк) — самые большие сверху`, ...sizes.map(([f, n]) => `- ${f} — ${n}${n > 600 ? ' ⚠ больше 600' : ''}`), '',
    `## Маршруты (${routes.length})`, ...routes.map((r) => '- ' + r), '',
    `## Коллекции`, ...[...colls].sort().map((c) => '- ' + c), '',
    `## Тексты отказов (${refusals.length}) — это правила модуля`, ...[...new Set(refusals)].slice(0, 80).map((r) => '- ' + r), ''].join('\n');
}

fs.mkdirSync(OUT, { recursive: true });
const names = only ? [only] : fs.readdirSync(MODS, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
for (const n of names) {
  if (!fs.existsSync(path.join(MODS, n))) { console.log(`Модуля ${n} нет.`); process.exit(2); }
  fs.writeFileSync(path.join(OUT, `${n}.md`), facts(n));
}
console.log(`Факты модулей: ${names.length} → tools/logs/starozhil/modules/`);
