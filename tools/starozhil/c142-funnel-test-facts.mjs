#!/usr/bin/env node
/**
 * Факты: дыры тестов воронки состава C142 (для наряда 012).
 * Чтение репо → tools/logs/starozhil/_facts/c142-funnel-tests.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = path.join(ROOT, 'tools', 'logs', 'starozhil', '_facts');
fs.mkdirSync(OUT, { recursive: true });

const exists = (p) => fs.existsSync(path.join(ROOT, p));
const rg = (pat, dir) => {
  try {
    return execFileSync('rg', ['-n', '--max-count', '25', pat, path.join(ROOT, dir)], { encoding: 'utf8' }).trim();
  } catch (e) {
    return (e.stdout || '').toString().slice(0, 5000);
  }
};

const targets = [
  'backend/pwa/sections/passports/book-composition-funnel.js',
  'backend/pwa/sections/passports/book-side-edit.js',
  'backend/pwa/sections/passports/book-etalon-gate.test.mjs',
];

const exportsFunnel = rg('^export |async function |function mount|KIND_LABEL|loadCatalog', 'backend/pwa/sections/passports/book-composition-funnel.js');
const existingTests = rg('book-composition-funnel|book-side-edit|mountCompositionFunnel|openCompositionInBook', 'backend/pwa');
const apiCalls = rg("api\\(|method:\\s*'PUT'|materialKind|modules/", 'backend/pwa/sections/passports/book-composition-funnel.js');

let gateRun = 'skip';
try {
  execFileSync(process.execPath, ['--test', path.join(ROOT, 'backend/pwa/sections/passports/book-etalon-gate.test.mjs')], {
    encoding: 'utf8',
    timeout: 30000,
  });
  gateRun = 'PASS';
} catch (e) {
  gateRun = 'FAIL: ' + String(e.stdout || e.stderr || e.message).slice(0, 400);
}

const facts = {
  at: new Date().toISOString(),
  files: Object.fromEntries(targets.map((t) => [t, exists(t)])),
  gateTest: gateRun,
  exportsFunnel: exportsFunnel.slice(0, 3000),
  existingTestHits: existingTests.slice(0, 3000),
  apiCalls: apiCalls.slice(0, 3000),
  qaHint: 'QA-NIGHT: нет *.test.mjs на book-composition-funnel / book-side-edit',
};

const outFile = path.join(OUT, 'c142-funnel-tests.json');
fs.writeFileSync(outFile, JSON.stringify(facts, null, 2));
console.log('c142-funnel-test-facts →', path.relative(ROOT, outFile));
console.log('gate:', gateRun);
console.log('test hits lines:', (existingTests.match(/\n/g) || []).length + (existingTests ? 1 : 0));
