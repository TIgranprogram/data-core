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
//   Волна 0 (ORDER-MASTER-PLAN §3): L2 сырые теги h('button'…) · L3 класс вне kit/u-* · L4 числа в CSS мимо токенов ·
//   L5 реэкспорт старых ui в kit/index.js · L6 имя kit без витрины/DESIGN, класс из DESIGN без CSS · L7 заменители текстов
//   и confirm/alert/prompt · L8 файл > 400 строк · L9 то же для backend/admin (L10 в плане не определён). Админка — в тех же правилах.
//   --recount --accept "причина" --user-approved — единственный способ поднять итог: пересчёт после исправления самого линтера (ЛИНТ-CRLF).
//   Храповик: общий итог (baseline.total) только уменьшается. --update-baseline — только убирает устаревшее.
//   --accept "причина" --user-approved — перенос ключей (запись в design-allow.json), итог НЕ растёт; без --user-approved отказ.
//   --json — итог и счёт по файлам (для dc order).
// Запуск из корня: node backend/scripts/design-lint.mjs [--max N] — код выхода 1, если находок больше N (по умолч. 0).
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'fs';
import { join, relative, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

// прямой запуск — весь линтер; импорт (тест L3) — только разбор классов ниже
const isMain = process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : true;

const BS = String.fromCharCode(92);
const norm = (p) => p.split(BS).join('/');
const ROOT = join(process.cwd(), 'backend', 'pwa');
const AROOT = join(process.cwd(), 'backend', 'admin');
const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
const isSrc = (p) => /\.(css|js)$/.test(p) && !/\.test\.mjs$/.test(p);
const pwaFiles = walk(ROOT).filter(isSrc);
const adminFiles = existsSync(AROOT) ? walk(AROOT).filter(isSrc) : [];
const files = [...pwaFiles, ...adminFiles]; // старые правила и L4/L7/L8 — по обоим деревьям
const out = [];
const rel = (p) => norm(relative(process.cwd(), p));
const add = (file, line, rule, text) => out.push({ file: rel(file), line, rule, text: text.trim().slice(0, 110) });

for (const f of files) {
  const lines = readFileSync(f, 'utf8').split(/\r?\n/);
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
const cssFiles = pwaFiles.filter((f) => f.endsWith('.css'));
const jsFiles = pwaFiles.filter((f) => f.endsWith('.js'));
const adminJs = adminFiles.filter((f) => f.endsWith('.js'));
const adminCss = adminFiles.filter((f) => f.endsWith('.css'));
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
    if (m) decls.push({ sel: top.replace(/\s+/g, ' '), prop: m[1], val: t.slice(m[0].length).trim(), line: startLine });
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

const KEYS = ['old', 'uiJs', 'legacyImports', 'classes', 'r4', 'r5', 'r7', 'r8', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8'];
const cur = { screensLines: 0 };
for (const k of KEYS) cur[k] = {};
const at = {};
const put = (bucket, key, file, line) => { cur[bucket][key] = (cur[bucket][key] || 0) + 1; if (!at[bucket + '|' + key]) at[bucket + '|' + key] = { file, line }; };

for (const x of out.splice(0)) put('old', `${x.file} | ${x.rule} | ${x.text}`, x.file, x.line);
for (const f of jsFiles) { const r = rel(f); if (/\/ui\/[^/]+\.js$/.test('/' + r) && !inKit(r)) put('uiJs', r, r, 1); }
const IMPORT = /^\s*(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/;
for (const f of sectionJs) {
  const r = rel(f);
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => {
    const m = l.match(IMPORT);
    if (m) { const t = rel(resolve(dirname(f), m[1])); if (/^backend\/pwa\/ui\//.test(t) && !inKit(t)) put('legacyImports', `${r} -> ${t}`, r, i + 1); }
    if (/^\s*(\/\/|\*)/.test(l)) return;
    if (/\bstyle\s*=|\.style\.|\bstyle\s*:/.test(l) && !/setProperty\(\s*['"`]--/.test(l) && !/style\s*:\s*\{?\s*['"`]?--/.test(l)) put('r5', `${r} | ${l.trim().slice(0, 100)}`, r, i + 1);
    // R8: эталон собран вручную — классы chips/chip/tcard/tile/board/col/k-* в class: внутри sections
    for (const cm of l.matchAll(/\b(?:class|className)\s*[:=]\s*(['"])([^'"$`]*)\1/g)) for (const c of cm[2].split(/\s+/)) if (/^(chips|chip|tcard|tile|board|col|k-[\w-]+)$/.test(c)) put('r8', `${r} | ${c}`, r, i + 1);
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

// ---------- Волна 0: L2–L9 ----------
const RAW = /\bh\(\s*['"`](button|table|select|textarea|details|dialog|input)['"`]/;
// L3: свои классы — kit/*.css и базовые tokens.css/base.css (muted, small, nowrap… — ими пользуется сам kit; C029-B1, 2026-11-07); screens.css — нет
const kitSet = new Set(parsed.filter((p) => inKit(p.r) || /(^|\/)ui\/(tokens|base)\.css$/.test(p.r)).flatMap((p) => p.sels.flatMap((s) => classesOf(s.sel))));
/** Строковые литералы выражения → слова-классы (в шаблоне — вне ${…}; приклеенные к подстановке не считаются). */
export const litParts = (expr) => {
  const res = [];
  const src = String(expr).replace(/\$\{[^}]*\}/g, ' '); // литералы внутри ${…} — не классы
  for (const m of src.matchAll(/'([^'\n]*)'|"([^"\n]*)"|`([^`\n]*)`/g)) {
    const body = m[1] ?? m[2] ?? m[3] ?? '';
    const parts = body.split(/\$\{[^}]*\}/);
    parts.forEach((part, i) => part.split(/\s+/).filter(Boolean).forEach((c) => {
      const glued = (i > 0 && part.startsWith(c)) || (i < parts.length - 1 && part.endsWith(c));
      if (!glued && /^-?[A-Za-z_][\w-]*$/.test(c)) res.push(c);
    }));
  }
  return res;
};
/** Выражение-значение, начиная с s[i]: до запятой или закрывающей скобки верхнего уровня (баланс скобок). */
const readExpr = (s, i, stopComma = true) => {
  let depth = 0; let out = '';
  for (; i < s.length; i++) {
    const c = s[i];
    if ('([{'.includes(c)) depth++;
    else if (')]}'.includes(c)) { if (depth === 0) break; depth--; } else if (c === ',' && stopComma && depth === 0) break;
    out += c;
  }
  return out;
};
/** Значения классов из строки кода: только то, что стоит после class:/className= и литералы аргументов classList.add|toggle|remove. */
export const classExprs = (line) => {
  const exprs = [];
  for (const m of line.matchAll(/(?:^|[^\w$])(?:class|className)\s*[:=]\s*/g)) exprs.push(readExpr(line, m.index + m[0].length));
  for (const m of line.matchAll(/classList\.(?:add|toggle|remove)\s*\(/g)) exprs.push(readExpr(line, m.index + m[0].length, false));
  return exprs.filter(Boolean);
};
for (const f of [...sectionJs, ...adminJs]) {
  const r = rel(f); const isSec = /\/sections\//.test('/' + r);
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l) || !isSec) return;
    const rm = l.match(RAW); if (rm) put('l2', `${r} | ${rm[1]}`, r, i + 1);
    const seen = new Set(); // один класс на строке — одно нарушение (даже если class: и classList на одной строке)
    for (const expr of classExprs(l)) for (const c of litParts(expr)) if (!kitSet.has(c) && !/^u-/.test(c) && !seen.has(c)) { seen.add(c); put('l3', `${r} | ${c}`, r, i + 1); }
  });
}
for (const f of [...jsFiles.filter((f) => !inKit(rel(f))), ...adminJs]) {
  const r = rel(f);
  readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l)) return;
    if (/\btoast\(\s*\w+\.message/.test(l)) put('l7', `${r} | toast(e.message)`, r, i + 1);
    const b = l.match(/(?:^|[^.\w$])(confirm|alert|prompt)\(/); if (b) put('l7', `${r} | ${b[1]}()`, r, i + 1);
    const t = l.match(/(['"`])(Пусто|Ничего не найдено|Нет данных)\1/); if (t && !/\bempty\w*\(/.test(l)) put('l7', `${r} | ${t[2]}`, r, i + 1);
  });
}
const NUM = /(?:\d*\.)?\d*[1-9]\d*(?:px|rem|em|%)/;
const adminParsed = adminCss.map((f) => ({ f, r: rel(f), ...parseCss(f) }));
for (const p of [...parsed, ...adminParsed]) {
  if (/tokens\.css$/.test(p.r) || /\/kit\/special\//.test(p.r)) continue; // kit/special — закрытый список исключений
  for (const d of p.decls) if (/^(font-size|border-radius|padding(-[\w]+)?|margin(-[\w]+)?|gap|row-gap|column-gap|box-shadow)$/.test(d.prop)) {
    const v = d.val.replace(/50%/g, '');
    if (!/var\(\s*--/.test(v) && NUM.test(v)) put('l4', `${p.r} | ${d.sel} | ${d.prop}`, p.r, d.line);
  }
}
const kidx = join(ROOT, 'ui', 'kit', 'index.js');
if (existsSync(kidx)) {
  const ksrc = readFileSync(kidx, 'utf8');
  for (const m of ksrc.matchAll(/^export\s+[^;]*?from\s+['"](\.\.\/[^'"]+)['"]/gm)) put('l5', m[1], 'backend/pwa/ui/kit/index.js', 1);
  const kitExports = [];
  for (const f of jsFiles.filter((f) => inKit(rel(f)))) {
    const src = readFileSync(f, 'utf8');
    for (const m of src.matchAll(/^export (?:async )?(?:function|const|let|class) ([A-Za-z_$][\w$]*)/gm)) kitExports.push(m[1]);
    for (const m of src.matchAll(/^export \{([^}]+)\}/gm)) for (const q of m[1].split(',')) { const n = q.trim().split(/\s+as\s+/).pop(); if (n) kitExports.push(n); }
  }
  const showcase = existsSync(join(ROOT, 'sections', 'kit.js')) ? readFileSync(join(ROOT, 'sections', 'kit.js'), 'utf8') : '';
  const dpath = join(process.cwd(), 'docs', 'DESIGN.md'); const design = existsSync(dpath) ? readFileSync(dpath, 'utf8') : '';
  for (const n of new Set(kitExports)) {
    const re = new RegExp('\\b' + n.replace(/\$/g, '\\$') + '\\b');
    if (!re.test(showcase)) put('l6', `${n} | нет в витрине kit.js`, 'backend/pwa/sections/kit.js', 1);
    if (!re.test(design)) put('l6', `${n} | нет в DESIGN.md`, 'docs/DESIGN.md', 1);
  }
  const allCss = new Set([...allClasses, ...adminParsed.flatMap((p) => p.sels.flatMap((s) => classesOf(s.sel)))]);
  const EXT = new Set(['js', 'mjs', 'css', 'json', 'md', 'html', 'env', 'ts', 'svg', 'png']);
  for (const m of design.matchAll(/`\.([a-z][\w-]*)`/g)) if (!EXT.has(m[1]) && !allCss.has(m[1])) put('l6', `.${m[1]} | класс из DESIGN без CSS`, 'docs/DESIGN.md', 1);
}
// L8: значение = строк сверх 400 (рост — нарушение), в итог идёт как 1 на файл
for (const f of [...sectionJs, ...jsFiles.filter((f) => inKit(rel(f)) && !/\/kit\/special\//.test(rel(f))), ...adminJs]) { const n = readFileSync(f, 'utf8').split(/\r?\n/).length; if (n > 400) { const r = rel(f); cur.l8[r] = n - 400; at['l8|' + r] = { file: r, line: n }; } }

const weigh = (k, n) => (k === 'l8' ? 1 : n);
const totalOf = (o) => KEYS.reduce((a, k) => a + Object.values(o[k] || {}).reduce((b, n) => b + weigh(k, n), 0), 0);
const byFileOf = (o) => { const m = {}; for (const k of KEYS) for (const [key, n] of Object.entries(o[k] || {})) { const f = (at[k + '|' + key] || {}).file || (key.match(/^(backend\/[^ |]+)/) || [])[1]; if (f) m[f] = (m[f] || 0) + weigh(k, n); } return m; };
const sc = parsed.find((p) => /ui\/screens\.css$/.test(p.r));
cur.screensLines = sc ? readFileSync(sc.f, 'utf8').split(/\r?\n/).length : 0;

const upd = process.argv.includes('--update-baseline');
const approved = process.argv.includes('--user-approved');
// --recount: пересчёт после исправления самого линтера (не новые нарушения, а прежде невидимые); только с --user-approved (ЛИНТ-CRLF, 2026-11-07)
const recount = process.argv.includes('--recount');
const acc = process.argv.includes('--accept') ? process.argv[process.argv.indexOf('--accept') + 1] : null;
const curTotal = totalOf(cur);
// закрытый список исключений (специнтерфейсы): новая запись — только с --user-approved
if (process.argv.includes('--allow-special')) {
  const i = process.argv.indexOf('--allow-special'); const name = process.argv[i + 1]; const why = process.argv[i + 2];
  if (!approved) { console.log('ОТКАЗ: новое исключение — только с --user-approved'); process.exit(2); }
  const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : [];
  allow.push({ date: new Date().toISOString().slice(0, 10), kind: 'special', name, reason: why, userApproved: true });
  writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n'); console.log('исключение записано: ' + name); process.exit(0);
}
if (process.argv.includes('--json')) { console.log(JSON.stringify({ total: curTotal, byFile: byFileOf(cur) })); process.exit(0); }
if (acc && !approved) { console.log('ОТКАЗ: --accept работает только с --user-approved (явное решение пользователя). Агентам нельзя.'); process.exit(2); }
if (!existsSync(BASE) && !(upd && acc)) { console.log('Нет design-baseline.json — создать: --update-baseline --accept "начальный снимок" --user-approved'); process.exit(2); }
const empty = { screensLines: Infinity };
for (const k of KEYS) empty[k] = {};
const base = existsSync(BASE) ? JSON.parse(readFileSync(BASE, 'utf8')) : empty;
for (const k of KEYS) base[k] = base[k] || {};
const HINT = {
  old: ['база', 'старое правило — исправить по docs/DESIGN.md'],
  uiJs: ['R1', 'новый файл в ui/ — положить в ui/kit/ или расширить существующий эталон'],
  legacyImports: ['R2', 'раздел импортирует ui/* — брать из ui/kit/'],
  classes: ['R3', 'новый класс CSS вне ui/kit — взять эталон из kit или добавить в kit'],
  r4: ['R4', 'цвет/фон/рамка/тень/радиус/шрифт в CSS раздела — взять класс kit'],
  r5: ['R5', 'inline style в разделе — класс из kit (разрешены только CSS-переменные --x)'],
  r7: ['R7', 'класс не найден ни в одном CSS — опечатка или нет в kit'],
  r8: ['R8', 'эталон собран вручную — взять kit.filter/tabs/segmented/board/tile'],
  l2: ['L2', "сырой h('button|table|select|…') в разделе — фабрика из kit"],
  l3: ['L3', 'класс вне kit/*.css и u-* — взять эталон из kit'],
  l4: ['L4', 'число в CSS мимо токенов (font-size/radius/padding/margin/gap/shadow) — var(--…)'],
  l5: ['L5', 'новый реэкспорт старого ui в kit/index.js — перенести модуль в kit'],
  l6: ['L6', 'kit без витрины/DESIGN или класс из DESIGN без CSS'],
  l7: ['L7', 'toast(e.message) / confirm / alert / prompt / текст-заменитель вместо empty()'],
  l8: ['L8', 'файл длиннее 400 строк — разбить'],
};
const v2 = [];
for (const k of KEYS) for (const [key, n] of Object.entries(cur[k])) if (n > ((base[k] || {})[key] || 0)) { const w = at[k + '|' + key]; v2.push({ file: w.file, line: w.line, rule: HINT[k][0], text: `${key} — ${HINT[k][1]}` }); }
if (cur.screensLines > base.screensLines) v2.push({ file: 'backend/pwa/ui/screens.css', line: cur.screensLines, rule: 'R6', text: `строк ${cur.screensLines} > baseline ${base.screensLines} — screens.css только уменьшается` });
if (typeof base.total === 'number' && curTotal > base.total) v2.push({ file: 'backend/scripts/design-baseline.json', line: 1, rule: 'L1', text: `итог ${curTotal} > baseline ${base.total} — итог только уменьшается` });

if (upd) {
  const next = {};
  const migrating = typeof base.total !== 'number'; // первый снимок формата с total: единственный раз итог может вырасти
  for (const k of KEYS) {
    next[k] = {};
    for (const [key, n] of Object.entries(cur[k])) { const keep = acc ? n : Math.min(n, (base[k] || {})[key] || 0); if (keep > 0) next[k][key] = keep; }
  }
  next.screensLines = acc ? cur.screensLines : Math.min(cur.screensLines, base.screensLines);
  next.total = totalOf(next);
  if (acc && !migrating && !(recount && approved) && next.total > base.total) { console.log(`ОТКАЗ: --accept не может поднять итог (${base.total} -> ${next.total}). Сначала уменьшить нарушения.`); process.exit(2); }
  if (acc) {
    const allow = existsSync(ALLOW) ? JSON.parse(readFileSync(ALLOW, 'utf8')) : [];
    allow.push({ date: new Date().toISOString().slice(0, 10), reason: acc, accepted: v2.length, userApproved: true });
    writeFileSync(ALLOW, JSON.stringify(allow, null, 2) + '\n');
  }
  writeFileSync(BASE, JSON.stringify(next, null, 1) + '\n');
  console.log(`baseline обновлён: итог ${next.total}${acc ? ` (принято: ${v2.length}; запись в design-allow.json)` : ' (только уменьшение)'}`);
  process.exit(0);
}
out.push(...v2);
// R9: вызов эталона kit без import — экран падает «X is not defined» (2026-11-01: так упал «Сегодня»). Без baseline.
const kitNames = new Set();
for (const f of jsFiles.filter((f) => inKit(rel(f)))) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/^export (?:async )?(?:function|const|let) ([A-Za-z_$][\w$]*)/gm)) kitNames.add(m[1]);
  for (const m of src.matchAll(/^export \{([^}]+)\}/gm)) for (const p of m[1].split(',')) { const n = p.trim().split(/\s+as\s+/).pop(); if (n) kitNames.add(n); }
}
for (const f of jsFiles.filter((f) => !inKit(rel(f)))) {
  const src = readFileSync(f, 'utf8');
  const known = new Set();
  for (const m of src.matchAll(/import\s*\{([^}]+)\}/g)) for (const p of m[1].split(',')) { const n = p.trim().split(/\s+as\s+/).pop(); if (n) known.add(n); }
  for (const m of src.matchAll(/\b(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) known.add(m[1]);
  for (const m of src.matchAll(/(?:\(|,)\s*([A-Za-z_$][\w$]*)\s*(?=[,)=])/g)) known.add(m[1]);
  for (const m of src.matchAll(/\{([^{}]*)\}\s*=/g)) for (const p of m[1].split(',')) { const n = p.trim().split(/[:=\s]/).pop(); if (n) known.add(n); }
  src.split(/\r?\n/).forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l)) return;
    for (const m of l.matchAll(/(^|[^.\w$'"`])(?<!\b(?:get|set|async) )([A-Za-z_$][\w$]*)\(/g)) if (kitNames.has(m[2]) && !known.has(m[2])) out.push({ file: rel(f), line: i + 1, rule: 'R9', text: `${m[2]}() вызван без import из ui/kit — экран упадёт` });
  });
}

const by = out.reduce((m, x) => ((m[x.rule] = (m[x.rule] || 0) + 1), m), {});
for (const x of out) console.log(`${x.file}:${x.line}\t${x.rule}\t${x.text}`);
console.log(`\nИтого новых: ${out.length}; всего сейчас ${curTotal}` + (out.length ? ' — ' + Object.entries(by).map(([k, v]) => `${k} ${v}`).join(', ') : ''));
const max = process.argv.includes('--max') ? Number(process.argv[process.argv.indexOf("--max") + 1]) : 0;
if (isMain) process.exit(out.length > max ? 1 : 0);
