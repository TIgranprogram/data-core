#!/usr/bin/env node
/**
 * C128 волна 1 — участки кода: файл backend/|tools/ → участок (блок «Карты сайта» или правило папки).
 *   node tools/areas.mjs --check   → код 0/1, список без участка
 *   node tools/areas.mjs --json    → { total, mapped, unmapped[] }
 * Чистые функции экспортируются для тестов и dc check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIR = new Set([
  'node_modules', 'dist', 'coverage', 'uploads', '.data', 'logs', '.git',
  '__pycache__', '.venv', 'vendor', 'build', '.turbo', '.cache',
]);
const SKIP_FILE = /\.(map|log|tgz|zip|png|jpg|jpeg|gif|webp|pdf|ico|woff2?|ttf|eot|mp4|webm)$/i;
const SKIP_NAME = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', '.DS_Store', 'Thumbs.db']);

/** Правила папок (после atlas): длинный префикс побеждает. area — id участка. */
export const FOLDER_RULES = [
  ['backend/src/modules/product-passport', 'docs'],
  ['backend/src/modules', 'server-modules'], // запас, если модуль не в atlas
  ['backend/src/common', 'server-common'],
  ['backend/src/database', 'server-db'],
  ['backend/src', 'server-core'],
  ['backend/admin', 'admin'],
  ['backend/pwa/sections', 'pwa-sections'],
  ['backend/pwa', 'pwa-core'],
  ['backend/test', 'server-test'],
  ['backend/scripts', 'server-scripts'],
  ['backend', 'backend-misc'],
  ['tools/ai-tester', 'aitester'],
  ['tools/starozhil', 'starozhil'],
  ['tools/design-checks', 'design-checks'],
  ['tools/local-ai-order', 'local-ai'],
  ['tools/local-checks', 'tools-dc'],
  ['tools', 'tools-dc'],
];

const norm = (p) => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');

/** Префиксы atlas (code[]) + правила папок; сортировка: длиннее → раньше; atlas раньше rule при равной длине. */
export function buildIndex(nodes, folderRules = FOLDER_RULES) {
  const out = [];
  for (const n of nodes || []) {
    for (const c of n.code || []) {
      const prefix = norm(c);
      if (!prefix) continue;
      out.push({ prefix, area: n.id, source: 'atlas' });
    }
  }
  for (const [prefix, area] of folderRules) {
    out.push({ prefix: norm(prefix), area, source: 'rule' });
  }
  out.sort((a, b) => b.prefix.length - a.prefix.length
    || (a.source === 'atlas' && b.source !== 'atlas' ? -1 : b.source === 'atlas' && a.source !== 'atlas' ? 1 : 0)
    || a.area.localeCompare(b.area));
  return out;
}

/** Первый подходящий участок или null. */
export function areaOf(file, index) {
  const f = norm(file);
  for (const p of index) {
    if (f === p.prefix || f.startsWith(p.prefix + '/')) return p.area;
  }
  return null;
}

/** Все участки, чьи префиксы покрывают файл (для отладки). */
export function areasOf(file, index) {
  const f = norm(file);
  const seen = new Set();
  const list = [];
  for (const p of index) {
    if ((f === p.prefix || f.startsWith(p.prefix + '/')) && !seen.has(p.area)) {
      seen.add(p.area);
      list.push(p.area);
    }
  }
  return list;
}

export function listTrackedFiles(root = ROOT, { scopes = ['backend', 'tools'] } = {}) {
  const files = [];
  const walk = (abs, rel) => {
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIR.has(e.name) || e.name.startsWith('.')) continue;
      const a = path.join(abs, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(a, r);
      else if (e.isFile()) {
        if (SKIP_NAME.has(e.name) || SKIP_FILE.test(e.name)) continue;
        files.push(norm(r));
      }
    }
  };
  for (const s of scopes) {
    const abs = path.join(root, s);
    if (fs.existsSync(abs)) walk(abs, s);
  }
  return files.sort();
}

export function scan(nodes, { root = ROOT, folderRules = FOLDER_RULES } = {}) {
  const index = buildIndex(nodes, folderRules);
  const files = listTrackedFiles(root);
  const unmapped = [];
  const byArea = new Map();
  for (const f of files) {
    const a = areaOf(f, index);
    if (!a) unmapped.push(f);
    else {
      if (!byArea.has(a)) byArea.set(a, 0);
      byArea.set(a, byArea.get(a) + 1);
    }
  }
  return {
    total: files.length,
    mapped: files.length - unmapped.length,
    unmapped,
    areas: [...byArea.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([id, n]) => ({ id, n })),
  };
}

async function loadNodes() {
  const { NODES } = await import(pathToFileURL(path.join(ROOT, 'backend/pwa/sections/atlas-data.js')).href);
  return NODES;
}

async function main() {
  const argv = process.argv.slice(2);
  const nodes = await loadNodes();
  const r = scan(nodes);
  if (argv.includes('--json')) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(r.unmapped.length ? 1 : 0);
  }
  if (argv.includes('--check') || argv.length === 0) {
    if (!r.unmapped.length) {
      console.log(`участки: ок — ${r.mapped}/${r.total} файлов, ${r.areas.length} участков`);
      process.exit(0);
    }
    console.log(`участки: без участка ${r.unmapped.length} из ${r.total}`);
    for (const f of r.unmapped.slice(0, 40)) console.log('  ' + f);
    if (r.unmapped.length > 40) console.log(`  … и ещё ${r.unmapped.length - 40}`);
    process.exit(1);
  }
  console.log('usage: node tools/areas.mjs --check | --json');
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
