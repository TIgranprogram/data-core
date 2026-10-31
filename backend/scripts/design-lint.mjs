#!/usr/bin/env node
// Линтер дизайна (ARCH-PLAN «линтер дизайна», 2026-10-26) — ТОЛЬКО ПРОВЕРКА, ничего не правит.
// Ловит по коду «Рабочего места» (backend/pwa) нарушения docs/DESIGN.md, которые видно без браузера:
//   1) «голые» цвета (#hex, rgb) в стилях вне ui/tokens.css — цвет должен быть токеном var(--…);
//   2) список раздела без emptyText — пустой экран без подсказки (CANON: пустые состояния с подсказкой);
//   3) служебные слова на экране: undefined / null / NaN / [object в строках интерфейса.
//   v2 (DESIGN-KIT K-0.2), против снимка scripts/design-baseline.json (он только уменьшается):
//   R1 новый ui/*.js вне ui/kit · R2 раздел импортирует ui/* мимо ui/kit · R3 новый класс CSS вне kit
//   R4 цвет/фон/рамка/тень/радиус/шрифт в CSS раздела (не tokens/base/kit) — новые правила
//   R5 style=/.style./style: в sections (CSS-переменные --x можно) · R6 screens.css не длиннее baseline
//   R7 класс в class:/className, которого нет ни в одном CSS.
//   --update-baseline — только убирает устаревшее; --accept "причина" — принять новое (запись в design-allow.json).
// Запуск из корня: node backend/scripts/design-lint.mjs [--max N] — код выхода 1, если находок больше N (по умолч. 0).
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';

const BS = String.fromCharCode(92);
const norm = (p) => p.split(BS).join('/');
const ROOT = join(process.cwd(), 'backend', 'pwa');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(ROOT).filter((p) => /\.(css|js)$/.test(p) && !/\.test\.mjs$/.test(p));
const out = [];
const rel = (p) => norm(relative(process.cwd(), p));
const add = (file, line, rule, text) => out.push({ file: rel(file), line, rule, text: text.trim().slice(0, 110) });

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
    if (/\/sections\//.test(norm(f)) && /\n\s{2}list:\s*\{/.test(src) && !/emptyText\s*:/.test(src)) add(f, 1, 'нет-пустого-состояния', 'list без emptyText');
  }
}

// ---------- v2: правила R1–R7 против baseline ----------
const BASE = join(process.cwd(), 'backend', 'scripts', 'design-baseline.json');
const ALLOW = join(process.cwd(), 'backend', 'scripts', 'design-allow.json');
const inKit = (r) => /\/ui\/kit\//.test('/' + r);
const cssFiles = files.filter((f) => f.endsWith('.css'));
const jsFiles = files.filter((f) => f.endsWith('.js'));
const sectionJs = jsFiles.filter((f) => /\/sections\//.test(norm(f)));

// минимальный разбор CSS: селекторы и объявления (at-правила разворачиваются плоско)
function parseCss(file) {
  const src = readFileSync(file, 'utf8');
  const stack = []; const decls = []; const sels = [];
  let buf = ''; let line = 1; let startLine = 1; let inC = false;
  const flush = () => {
    const t = buf.trim(); if (!t || !stack.length) return;
    const top = stack[stack.length - 1];
    if (/^@/.test(top) || /^(from|to|\d+%)/.test(top)) return;
    const m = t.match(/^([\w-]+)\s*:/);
    if (m) decls.push({ sel: top.replace(/\s+/g, ' '), prop: m[1], line: startLine });
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\n') line++;
    if (inC) { if (c === '*' && src[i + 1] === '/') { inC = false; i++; } continue; }
    if (c === '/' && src[i + 1] === '*') { inC = true; i++; continue; }
    if (c === '{') {
      const t = buf.trim(); stack.push(t);
      if (!/^@/.test(t) && !/^(from|to|\d+%)/.test(t) && stack.length) sels.push({ sel: t, line: startLine });
      buf = ''; startLine = line;
    } else if (c === '}') { flush(); stack.pop(); buf = ''; startLine = line; }
    else if (c === ';') { flush(); buf = ''; startLine = line; }
    else { if (!buf.trim()) startLine = line; buf += c; }
  }
  return { decls, sels };
}
const classesOf = (sel) => [...sel.replace(/\[[^\]]*\]|"[^"]*"|'[^']*'/g, '').matchAll(/\.(-?[A-Za-z_][\w-]*)/g)].map((m) => m[1]);
const parsed = cssFiles.map((f) => ({ f, r: rel(f), ...parseCss(f) }));
const allClasses = new Set(parsed.flatMap((p) => p.sels.flatMap((s) => classesOf(s.sel))));

const KEYS = ['old', 'uiJs', 'legacyImports', 'classes', 'r4', 'r5', 'r7'];
const cur = { old: {}, uiJs: {}, legacyImports: {}, classes: {}, r4: {}, r5: {}, r7: {}, screensLines: 0 };
const at = {};
const put = (bucket, key, file, line) => { cur[bucket][key] = (cur[bucket][key] || 0) + 1; if (!at[bucket + '|' + key]) at[bucket + '|' + key] = { file, line }; };

for (const x of out.splice(0)) put('old', `${x.file} | ${x.rule} | ${x.text}`, x.file, x.line);
for (const f of jsFiles) { const r = rel(f); if (/\/ui\/[^/]+\.js$/.test('/' + r) && !inKit(r)) put('uiJs', r, r, 1); }
const IMPORT = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/;
for (const f of sectionJs) {
  const r = rel(f);
  readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
    const m = l.match(IMPORT);
    if (m) { const t = rel(resolve(dirname(f), m[1])); if (/^backend\/pwa\/ui\//.test(t) && !inKit(t)) put('legacyImports', `${r} -> ${t}`, r, i + 1); }
    if (/^\s*(\/\/|\*)/.test(l)) return;
    if (/\bstyle\s*=|\.style\.|\bstyle\s*:/.test(l) && !/setProperty\(\s*['"`]--/.test(l) && !/style\s*:\s*\{?\s*['"`]?--/.test(l)) put('r5', `${r} | ${l.trim().slice(0, 100)}`, r, i + 1);
    for (const cm of l.matchAll(/\b(?:class|className)\s*[:=]\s*(['"])([^'"$`]*)\1/g)) for (const c of cm[2].split(/\s+/).filter(Boolean)) if (!allClasses.has(c)) put('r7', `${r} | ${c}`, r, i + 1);
  });
}
const R4 = new Set(['color', 'background', 'background-color', 'border', 'border-color', 'border-top', 'border-bottom', 'border-left', 'border-right', 'box-shadow', 'border-radius', 'font', 'font-size', 'font-family', 'font-weight', 'font-style']);
for (const p of parsed) {
  if (/(tokens|base)\.css$/.test(p.r) || inKit(p.r)) continue;
  for (const s of p.sels) for (const c of new Set(classesOf(s.sel))) put('classes', c, p.r, s.line);
  for (const d of p.decls) if (R4.has(d.prop)) put('r4', `${p.r} | ${d.sel} | ${d.prop}`, p.r, d.line);
}
// классы, объявленные в kit/tokens/base, — «свои»: в baseline-снимок R3 не попадают
const ownClasses = new Set(parsed.filter((p) => /(tokens|base)\.css$/.test(p.r) || inKit(p.r)).flatMap((p) => p.sels.flatMap((s) => classesOf(s.sel))));
for (const c of ownClasses) delete cur.classes[c];
const sc = parsed.find((p) => /ui\/screens\.css$/.test(p.r));
cur.screensLines = sc ? readFileSync(sc.f, 'utf8').split('\n').length : 0;

const upd = process.argv.includes('--update-baseline');
const acc = process.argv.includes('--accept') ? process.argv[process.argv.indexOf('--accept') + 1] : null;
if (!existsSync(BASE) && !(upd && acc)) { console.log('Нет design-baseline.json — создать: --update-baseline --accept "начальный снимок"'); process.exit(2); }
const empty = { old: {}, uiJs: {}, legacyImports: {}, classes: {}, r4: {}, r5: {}, r7: {}, screensLines: Infinity };
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : empty;
const HINT = {
  old: ['база', 'старое правило — исправить по docs/DESIGN.md'],
  uiJs: ['R1', 'новый файл в ui/ — положить в ui/kit/ или расширить существующий эталон'],
  legacyImports: ['R2', 'раздел импортирует ui/* — брать из ui/kit/'],
  classes: ['R3', 'новый класс CSS вне ui/kit — взять эталон из kit или добавить в kit'],
  r4: ['R4', 'цвет/фон/рамка/тень/радиус/шрифт в CSS раздела — взять класс kit'],
  r5: ['R5', 'inline style в разделе — класс из kit (разрешены только CSS-переменные --x)'],
  r7: ['R7', 'класс не найден ни в одном CSS — опечатка или нет в kit'],
};
const v2 = [];
for (const k of KEYS) for (const [key, n] of Object.entries(cur[k])) if (n > ((base[k] || {})[key] || 0)) { const w = at[k + '|' + key]; v2.push({ file: w.file, line: w.line, rule: HINT[k][0], text: `${key} — ${HINT[k][1]}` }); }
if (cur.screensLines > base.screensLines) v2.push({ file: 'backend/pwa/ui/screens.css', line: cur.screensLines, rule: 'R6', text: `строк ${cur.screensLines} > baseline ${base.screensLines} — screens.css только уменьшается` });

if (upd) {
  const next = {};
  for (const k of KEYS) {
    next[k] = {};
    for (const [key, n] of Object.entries(cur[k])) { const keep = acc ? n : Math.min(n, (base[k] || {})[key] || 0); if (keep > 0) next[k][key] = keep; }
  }
  next.screensLines = acc ? cur.screensLines : Math.min(cur.screensLines, base.screensLines);
  if (acc) {
    const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : [];
    allow.push({ date: new Date().toISOString().slice(0, 10), reason: acc, accepted: v2.length });
    writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
  }
  writeFileSync(BASE, JSON.stringify(next, null, 1) + '\n');
  console.log(`baseline обновлён${acc ? ` (принято нарушений: ${v2.length}; причина — в design-allow.json)` : ' (только уменьшение)'}`);
  process.exit(0);
}
out.push(...v2);

const by = out.reduce((m, x) => ((m[x.rule] = (m[x.rule] || 0) + 1), m), {});
for (const x of out) console.log(`${x.file}:${x.line}\t${x.rule}\t${x.text}`);
console.log(`\nИтого: ${out.length}` + (out.length ? ' — ' + Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') : ''));
const max = process.argv.includes('--max') ? Number(process.argv[process.argv.indexOf("--max") + 1]) : 0;
process.exit(out.length > max ? 1 : 0);
