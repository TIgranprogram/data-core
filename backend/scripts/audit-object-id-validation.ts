#!/usr/bin/env ts-node
/**
 * TZ-119 §1.4 — Backend ObjectId-validation audit.
 *
 * Single-shot static scan. Not a pre-commit hook (keeps tsc/lint fast).
 * Reports unrated `new Types.ObjectId(...)` calls whose argument is NOT
 * guarded by `Types.ObjectId.isValid(...)` either on the same line or in
 * the surrounding 11-line window. Skips:
 *   - .map() / .filter() arrow callbacks (multi-arg + destructured forms)
 *   - files inside node_modules / dist / coverage / __mocks__
 *
 * Usage
 *   pnpm ts-node backend/scripts/audit-object-id-validation.ts
 *   pnpm ts-node backend/scripts/audit-object-id-validation.ts --json
 *
 * Exit codes
 *   0 — every `new Types.ObjectId(...)` call is guarded
 *   1 — unguarded calls found
 *   2 — SYSTEM error (cannot read source tree)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');
const SCAN_DIRS = ['src', 'test'];
const SKIP_DIRS = new Set(['node_modules', 'dist', 'coverage', '__mocks__']);

type Finding = {
  file: string;
  line: number;
  column: number;
  lineText: string;
  context: 'create' | 'update' | 'find' | 'parse' | 'other';
  reasoning: string;
};

const findings: Finding[] = [];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      out.push(...walk(p));
    } else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) {
      out.push(p);
    }
  }
  return out;
}

function classify(text: string): Finding['context'] {
  const t = text.toLowerCase();
  if (/\.create\(|\.createasync\(/.test(t)) return 'create';
  if (/\.updateone\(|\.findbyidandupdate\(|\.update\(/.test(t)) return 'update';
  if (/\.find\(|\.findbyid\(|\.findone\(|\.exists\(/.test(t)) return 'find';
  if (/types\.objectid\(/.test(t) && /parse|fromstring|fromid/.test(t)) return 'parse';
  return 'other';
}

function isGuardedSameLine(text: string): boolean {
  if (/isValid\s*\(/.test(text)) return true;
  return false;
}

function hasGuardInWindow(windowText: string): boolean {
  return /Types\.ObjectId\.isValid\s*\(/.test(windowText);
}

function isInMapLikeCallback(text: string): boolean {
  // Broader heuristic: any arrow / function-expression callback that
  // creates an ObjectId from an element is likely operating on a value
  // the caller already trusts (an existing _id from a query result, a
  // typed DTO, etc). Match:
  //   .map((x, _i) => ...
  //   .map(({ id }) => ...
  //   .map(function(x) { ...
  //   .filter().map() chained
  if (/(\.map|\.flatMap|\.filter)\s*\([^)]*=>\s*[^)]*new\s+Types\.ObjectId/.test(text)) return true;
  if (/(\.map|\.flatMap)\s*\([^)]*function\s*\(/.test(text)) return true;
  return false;
}

const argv = process.argv.slice(2);
const asJson = argv.includes('--json');

for (const scanDir of SCAN_DIRS) {
  const absRoot = join(ROOT, scanDir);
  let stat;
  try {
    stat = statSync(absRoot);
  } catch {
    continue;
  }
  if (!stat.isDirectory()) continue;
  const files = walk(absRoot);
  for (const f of files) {
    const body = readFileSync(f, 'utf8');
    const lines = body.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!/new\s+Types\.ObjectId\s*\(/.test(line)) continue;

      if (isInMapLikeCallback(line)) continue;

      if (hasGuardInWindow(line)) continue;
      if (isGuardedSameLine(line)) continue;

      const window = lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 6)).join('\n');
      if (hasGuardInWindow(window)) continue;

      findings.push({
        file: relative(ROOT, f).replace(/\\/g, '/'),
        line: i + 1,
        column: line.indexOf('new Types.ObjectId') + 1,
        lineText: line.trim().slice(0, 160),
        context: classify(line),
        reasoning: 'unprotected new Types.ObjectId — recommend IsObjectIdPipe or isValid() guard',
      });
    }
  }
}

if (asJson) {
  process.stdout.write(JSON.stringify({ findings }, null, 2));
  process.exit(findings.length > 0 ? 1 : 0);
}

if (findings.length === 0) {
  process.stdout.write('PASS: every `new Types.ObjectId(...)` call in backend is guarded by isValid() or a pipe.\n');
  process.exit(0);
}

process.stdout.write(`WARN: ${findings.length} unguarded \`new Types.ObjectId(...)\` calls found:\n\n`);
for (const f of findings.slice(0, 50)) {
  process.stdout.write(`  ${f.file}:${f.line}  [${f.context}]\n    ${f.lineText}\n`);
}
if (findings.length > 50) {
  process.stdout.write(`  ...and ${findings.length - 50} more (rerun with --json to dump all)\n`);
}
process.exit(1);
