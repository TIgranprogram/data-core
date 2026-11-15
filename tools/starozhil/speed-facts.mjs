#!/usr/bin/env node
// Старожил (C125): факты для наряда 008 «почему медленно» — программой, без ИИ. Модель сама ошибалась в файл:строка (14.11: 0 из 41),
// поэтому здесь медленные запросы уже сопоставлены с обработчиком в коде: контроллер:строка и строки метода (что он вызывает).
//   node tools/starozhil/speed-facts.mjs  → tools/logs/starozhil/speed/FACTS.md
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { moduleRoutes } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'logs', 'starozhil', 'speed');
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');
fs.mkdirSync(OUT, { recursive: true });

// 1. Таблица «## Скорость» из самого свежего отчёта тестировщика
const AT = path.join(ROOT, 'tools', 'logs', 'ai-tester');
const days = fs.existsSync(AT) ? fs.readdirSync(AT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort() : [];
const rows = [];
let src = '—';
for (const d of days.reverse()) {
  const f = path.join(AT, d, 'REPORT.md');
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  const sec = t.split('## Скорость')[1]?.split('\n## ')[0];
  if (!sec) continue;
  for (const l of sec.split('\n')) {
    const m = /^\| (GET|POST|PATCH|PUT|DELETE) (\S+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$/.exec(l.trim());
    if (m) rows.push({ method: m[1], url: m[2], n: +m[3], p50: +m[4], p95: +m[5], max: +m[6] });
  }
  src = rel(f); break;
}

// 2. Все маршруты сервера: метод + шаблон пути → контроллер:строка и тело метода (до 25 строк)
const MODS = path.join(ROOT, 'backend', 'src');
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.controller.ts') ? [path.join(d, e.name)] : []));
const routes = [];
for (const f of walk(MODS)) {
  const text = fs.readFileSync(f, 'utf8'); const lines = text.split(/\r?\n/);
  for (const r of moduleRoutes(text)) {
    const body = lines.slice(r.line, r.line + 25); const end = body.findIndex((l, i) => i > 1 && /^\s{2}\}\s*$/.test(l));
    const calls = body.slice(0, end > 0 ? end : 12).map((l) => l.trim()).filter((l) => /this\.\w+\.\w+\(/.test(l)).slice(0, 4);
    const re = new RegExp('^' + ('api/' + r.path).replace(/\/+$/, '').split('/').map((p) => (p.startsWith(':') ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))).join('/') + '$');
    routes.push({ method: r.method, re, where: `${rel(f)}:${r.line}`, path: r.path, calls });
  }
}

// 3. Сопоставление: «:id» и «:n» из таблицы → любой сегмент
const L = [`# Почему медленно — факты (${new Date().toISOString().slice(0, 16).replace('T', ' ')})`, '', `Источник таблицы: ${src}. Запросов в таблице: ${rows.length}.`, ''];
if (!rows.length) L.push('Таблицы скорости нет — сначала прогон ИИ-тестировщика.');
for (const r of rows.slice(0, 8)) {
  const probe = r.url.replace(/^\//, '').replace(/:id|:n/g, 'X');
  const hit = routes.find((x) => x.method === r.method && x.re.test(probe));
  L.push(`## ${r.method} ${r.url} — медиана ${r.p50} мс, худший ${r.max} мс, раз ${r.n}`);
  if (!hit) { L.push('- обработчик не найден программой (смотреть по пути в backend/src/modules)', ''); continue; }
  L.push(`- контроллер: ${hit.where} (маршрут \`${hit.path}\`)`);
  for (const c of hit.calls) L.push(`- вызывает: \`${c.slice(0, 140)}\``);
  L.push('');
}
fs.writeFileSync(path.join(OUT, 'FACTS.md'), L.join('\n') + '\n');
console.log(`Медленных запросов в таблице: ${rows.length}; факты → tools/logs/starozhil/speed/FACTS.md`);
