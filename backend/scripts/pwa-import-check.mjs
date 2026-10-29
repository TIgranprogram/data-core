#!/usr/bin/env node
// Ворота выкладки (RELEASE-GATE RG-1): «Рабочее место» и админка без сборки — одна ошибка в .js даёт пустой экран.
// Проверяет все backend/pwa/**/*.js и backend/admin/**/*.js:
//   1) синтаксис — точно как браузер (V8): модуль — vm.SourceTextModule, обычный скрипт (sw.js, theme.js, admin.js) — vm.Script;
//   2) импорты: файл по пути есть, а имена из `import { a }` / `export { a } from` этот файл действительно экспортирует.
// Запуск: node backend/scripts/pwa-import-check.mjs   → код 0 / 1, ошибки «файл:строка — что».
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// vm.SourceTextModule доступен только с флагом — перезапускаем себя с ним
if (!vm.SourceTextModule) {
  const r = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: 'inherit' });
  process.exit(r.status ?? 1);
}

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// папки можно передать аргументами (проверка самого скрипта на копии); по умолчанию — pwa и admin
const ROOTS = process.argv.length > 2 ? process.argv.slice(2).map((d) => path.resolve(d)) : ['pwa', 'admin'].map((d) => path.join(BACKEND, d));
const ts = createRequire(path.join(BACKEND, 'package.json'))('typescript');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') walk(p, out); }
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const rel = (f) => path.relative(path.dirname(BACKEND), f).replaceAll('\\', '/');
const errors = [];
const parsed = new Map(); // файл → { sf, isModule, exports:Set, stars:[файл] }

function parse(file) {
  if (parsed.has(file)) return parsed.get(file);
  const src = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const has = (n, k) => n.modifiers?.some((m) => m.kind === k);
  const isModule = sf.statements.some((s) => ts.isImportDeclaration(s) || ts.isExportDeclaration(s) || ts.isExportAssignment(s) || has(s, ts.SyntaxKind.ExportKeyword));
  const exports = new Set();
  const stars = [];
  const bindNames = (b) => (ts.isIdentifier(b) ? [b.text] : b.elements.flatMap((e) => (ts.isOmittedExpression(e) ? [] : bindNames(e.name))));
  for (const s of sf.statements) {
    if (ts.isExportDeclaration(s)) {
      if (!s.exportClause && s.moduleSpecifier) stars.push(path.resolve(path.dirname(file), s.moduleSpecifier.text));
      else if (s.exportClause && ts.isNamedExports(s.exportClause)) s.exportClause.elements.forEach((e) => exports.add(e.name.text));
      else if (s.exportClause) exports.add(s.exportClause.name.text); // export * as ns from
    } else if (ts.isExportAssignment(s)) exports.add('default');
    else if (has(s, ts.SyntaxKind.ExportKeyword)) {
      if (has(s, ts.SyntaxKind.DefaultKeyword)) exports.add('default');
      else if (ts.isVariableStatement(s)) s.declarationList.declarations.forEach((d) => bindNames(d.name).forEach((n) => exports.add(n)));
      else if (s.name) exports.add(s.name.text);
    }
  }
  const info = { sf, src, isModule, exports, stars };
  parsed.set(file, info);
  return info;
}

// все имена, которые отдаёт файл, с учётом `export * from` (рекурсивно, без зацикливания)
function allExports(file, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return new Set();
  seen.add(file);
  const { exports, stars } = parse(file);
  const out = new Set(exports);
  for (const s of stars) for (const n of allExports(s, seen)) if (n !== 'default') out.add(n);
  return out;
}

const files = ROOTS.flatMap((r) => walk(r));
for (const file of files) {
  const info = parse(file);
  const at = (node) => `${rel(file)}:${info.sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  // 1) синтаксис — движком V8
  try {
    if (info.isModule) new vm.SourceTextModule(info.src, { identifier: file });
    else new vm.Script(info.src, { filename: file });
  } catch (e) {
    // у модуля V8 не даёт строку — берём её из разбора TypeScript; у скрипта она в первой строке stack «файл:строка»
    const d = info.sf.parseDiagnostics?.[0];
    const line = d ? info.sf.getLineAndCharacterOfPosition(d.start).line + 1 : /:(\d+)$/.exec(String(e.stack).split('\n')[0])?.[1] ?? '?';
    errors.push(`${rel(file)}:${line} — синтаксис: ${e.message}`);
    continue;
  }

  // 2) импорты
  const check = (node, spec, names) => {
    if (!/^\.\.?\//.test(spec)) return; // внешние адреса и голые имена не проверяем
    const target = path.resolve(path.dirname(file), spec);
    if (!existsSync(target)) { errors.push(`${at(node)} — нет файла «${spec}»`); return; }
    if (!names.length || !target.endsWith('.js')) return;
    const have = allExports(target);
    for (const n of names) if (!have.has(n)) errors.push(`${at(node)} — «${spec}» не экспортирует «${n}»`);
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const c = node.importClause;
      const names = [];
      if (c?.name) names.push('default');
      if (c?.namedBindings && ts.isNamedImports(c.namedBindings)) c.namedBindings.elements.forEach((e) => names.push((e.propertyName ?? e.name).text));
      check(node, node.moduleSpecifier.text, names);
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const names = node.exportClause && ts.isNamedExports(node.exportClause) ? node.exportClause.elements.map((e) => (e.propertyName ?? e.name).text) : [];
      check(node, node.moduleSpecifier.text, names);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) {
      check(node, node.arguments[0].text, []);
    }
    ts.forEachChild(node, visit);
  };
  visit(info.sf);
}

for (const e of errors) console.log(e);
console.log(`импорты и синтаксис: ${files.length} файлов, ошибок ${errors.length}`);
process.exit(errors.length ? 1 : 0);
