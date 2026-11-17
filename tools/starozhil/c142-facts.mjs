#!/usr/bin/env node
/**
 * Факты для наряда Старожила C142: состав / модули / детали / книжка.
 * Только чтение репо → JSON в tools/logs/starozhil/_facts/c142.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'logs', 'starozhil', '_facts');
fs.mkdirSync(OUT, { recursive: true });

const exists = (p) => fs.existsSync(path.join(ROOT, p));
const readHead = (p, n = 40) => {
  try {
    return fs.readFileSync(path.join(ROOT, p), 'utf8').split(/\r?\n/).slice(0, n)
      .map((l, i) => `${i + 1}|${l}`).join('\n');
  } catch { return `(нет ${p})`; }
};
const rg = (pat, dir) => {
  try {
    return execFileSync('rg', ['-n', '--max-count', '15', pat, path.join(ROOT, dir)], { encoding: 'utf8' }).trim();
  } catch (e) {
    return (e.stdout || e.message || '').toString().slice(0, 4000);
  }
};

const files = {
  checklist: exists('docs/crew/C142-composition-hierarchy/CHECKLIST.md'),
  tz: exists('docs/crew/C142-composition-hierarchy/TZ.md'),
  funnel: exists('backend/pwa/sections/passports/book-composition-funnel.js'),
  sideEdit: exists('backend/pwa/sections/passports/book-side-edit.js'),
  modules: exists('backend/pwa/sections/modules.js'),
  parts: exists('backend/pwa/sections/parts.js'),
  compEditor: exists('backend/pwa/sections/comp-editor.js'),
  gate: exists('backend/pwa/sections/passports/book-etalon-gate.test.mjs'),
};

const nav = rg("\\['modules'|\\['parts'|Модули|Детали", 'backend/pwa/main.js');
const atlas = rg("id: 'modules'|id: 'parts'|sostav", 'backend/pwa/sections/atlas-data.js');
const bookFocus = rg('openCompositionInBook|openMaterialsInBook|composition', 'backend/pwa/sections/passports');
const putComp = rg('composition.*PUT|set\\(|lineType.*module', 'backend/src/modules/showcase');

let syntax = {};
for (const f of Object.keys(files).filter((k) => files[k] && /\.js$/.test(k === 'funnel' ? 'x.js' : ''))) { /* noop */ }
const checkFiles = [
  'backend/pwa/sections/passports/book-composition-funnel.js',
  'backend/pwa/sections/modules.js',
  'backend/pwa/sections/parts.js',
  'backend/pwa/sections/comp-editor.js',
].filter(exists);
for (const f of checkFiles) {
  try {
    execFileSync(process.execPath, ['--input-type=module', '--check'], {
      input: fs.readFileSync(path.join(ROOT, f)),
      encoding: 'utf8',
    });
    syntax[f] = 'ok';
  } catch (e) {
    syntax[f] = 'FAIL: ' + String(e.stderr || e.message).slice(0, 200);
  }
}

const facts = {
  at: new Date().toISOString(),
  files,
  syntax,
  navHits: nav.slice(0, 2500),
  atlasHits: atlas.slice(0, 2500),
  bookHits: bookFocus.slice(0, 2500),
  putHits: putComp.slice(0, 2500),
  checklistHead: readHead('docs/crew/C142-composition-hierarchy/CHECKLIST.md', 50),
  funnelHead: readHead('backend/pwa/sections/passports/book-composition-funnel.js', 35),
};

const outFile = path.join(OUT, 'c142.json');
fs.writeFileSync(outFile, JSON.stringify(facts, null, 2));
console.log('c142-facts →', path.relative(ROOT, outFile));
console.log('files:', JSON.stringify(files));
console.log('syntax:', JSON.stringify(syntax));
