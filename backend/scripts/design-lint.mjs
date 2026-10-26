#!/usr/bin/env node
// Линтер дизайна (ARCH-PLAN «линтер дизайна», 2026-10-26) — ТОЛЬКО ПРОВЕРКА, ничего не правит.
// Ловит по коду «Рабочего места» (backend/pwa) нарушения docs/DESIGN.md, которые видно без браузера:
//   1) «голые» цвета (#hex, rgb) в стилях вне ui/tokens.css — цвет должен быть токеном var(--…);
//   2) список раздела без emptyText — пустой экран без подсказки (CANON: пустые состояния с подсказкой);
//   3) служебные слова на экране: undefined / null / NaN / [object в строках интерфейса.
// Запуск из корня: node backend/scripts/design-lint.mjs [--max N] — код выхода 1, если находок больше N (по умолч. — без порога).
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT = join(process.cwd(), 'backend', 'pwa');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(ROOT).filter((p) => /\.(css|js)$/.test(p) && !/\.test\.mjs$/.test(p));
const out = [];
const add = (file, line, rule, text) => out.push({ file: relative(process.cwd(), file).split(String.fromCharCode(92)).join('/'), line, rule, text: text.trim().slice(0, 110) });

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  const isCss = f.endsWith('.css');
  if (isCss && !f.endsWith('tokens.css')) {
    lines.forEach((l, i) => {
      if (/^\s*(\/\*|\*)/.test(l) || /--[\w-]+\s*:/.test(l)) return; // комментарии и объявления токенов
      if (/#[0-9a-fA-F]{3,8}\b(?![\w-])|rgba?\(\s*\d/.test(l) && !/var\(--/.test(l.split(/#[0-9a-fA-F]{3,8}|rgba?\(/)[0] + '')) add(f, i + 1, 'цвет-не-токен', l);
    });
  }
  if (!isCss) {
    lines.forEach((l, i) => {
      if (/^\s*(\/\/|\*)/.test(l)) return;
      // слово внутри строки-подписи ('…undefined…'), а не значение в коде
      const strs = l.replace(/\$\{[^}]*\}/g, '').match(/'[^']*'|"[^"]*"|`[^`]*`/g) || [];
      if (strs.some((x) => /[а-яё]/i.test(x) && /\b(undefined|NaN)\b|\[object/.test(x))) add(f, i + 1, 'служебное-на-экране', l);
    });
    const src = lines.join('\n');
    if (/\/sections\//.test(f.split(String.fromCharCode(92)).join('/')) && /\n\s{2}list:\s*\{/.test(src) && !/emptyText\s*:/.test(src)) add(f, 1, 'нет-пустого-состояния', 'list без emptyText');
  }
}

const by = out.reduce((m, x) => ((m[x.rule] = (m[x.rule] || 0) + 1), m), {});
for (const x of out) console.log(`${x.file}:${x.line}\t${x.rule}\t${x.text}`);
console.log(`\nИтого: ${out.length}` + (out.length ? ' — ' + Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') : ''));
const max = process.argv.includes('--max') ? Number(process.argv[process.argv.indexOf('--max') + 1]) : Infinity;
process.exit(out.length > max ? 1 : 0);
