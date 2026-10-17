#!/usr/bin/env -S npx ts-node
/**
 * TZ-91 §4 Phase B.1 — Audit @Roles coverage across all backend controllers.
 *
 * WHY THIS SCRIPT
 * ---------------
 * TZ-91A shipped on commit `4a2d6bd` (security bundle v1: registerDto + login
 * @Throttle + admin seed gate + CORS multi-origin). Phase B completes the
 * RBAC sweep: every write endpoint MUST declare `@Roles('admin', 'manager')`
 * so RBAC chain activates uniformly.
 *
 * Without this script, applying `@Roles` across 73 controllers is a
 * high-risk manual sweep that historically produces "forgot one" bugs —
 * exactly the regression that motivated TZ-91 §1 ("@Public регистрация +
 * RBAC не на write endpoints = 2 из 3 CRITICAL findings").
 *
 * WHAT IT DOES
 * ------------
 * Walks every `*.controller.ts` under `backend/src/**`, parses each method
 * decoration block, and flags write endpoints (`@Post`, `@Put`, `@Patch`,
 * `@Delete`) that lack `@Roles(...)`.
 *
 * Per-endpoint status:
 *   - OK              : has @Roles(...) decorator (canonical coverage)
 *   - PUBLIC_TEMP     : has @Public() — acceptable on /auth/register +
 *                       /auth/login + /auth/refresh under TZ-91A.2 deferral;
 *                       flagged so reviewer sees the surface
 *   - MISSING         : write endpoint without @Roles AND without @Public —
 *                       TZ-91 §4 Phase B acceptance criteria: 0 MISSING
 *
 * OUTPUT
 * ------
 * 1. Console table  — human-readable summary grouped by status.
 * 2. JSON report    — written to `tmp/audit-roles-coverage.json` (gitignored
 *                     per TZ-91D — see `.gitignore` tmp/ rule). Structured
 *                     for future CI gate (`exit 1 if missingCount > 0`).
 *
 * EXIT CODE
 * ---------
 *   0 — all write endpoints have coverage (OK or PUBLIC_TEMP).
 *   1 — at least one write endpoint is MISSING (Phase B incomplete).
 *
 * USAGE
 * -----
 *   $ cd backend
 *   $ npx ts-node scripts/audit-roles-coverage.ts
 *
 * Cross-references: TZ-91 §4 Phase B.1 + TZ-45 audit-di.ts (project-wide
 * precedent for static-analysis scripts in `backend/scripts/`).
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// ---- paths -------------------------------------------------------------

const BACKEND_ROOT = join(__dirname, '..'); // __dirname = backend/scripts/, '..' = backend/
const SRC = join(BACKEND_ROOT, 'src');
const REPORT_PATH = join(BACKEND_ROOT, '..', 'tmp', 'audit-roles-coverage.json');

// ---- types -------------------------------------------------------------

interface ScannedMethod {
  name: string;
  decoratorLines: string[]; // every `@XYZ(...)` line preceding the method name
}

interface WriteEndpointFinding {
  file: string;
  controller: string;
  method: string;
  verb: 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  hasRoles: boolean;
  hasPublic: boolean;
  status: 'OK' | 'PUBLIC_TEMP' | 'MISSING';
}

interface AuditReport {
  generated: string;
  schemaVersion: 1;
  totalControllers: number;
  totalWriteEndpoints: number;
  okCount: number;
  publicTempCount: number;
  missingCount: number;
  findings: WriteEndpointFinding[];
}

// ---- file walk ---------------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'dist', 'test', '__tests__', '.git']);

function findControllers(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findControllers(full));
    } else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

// ---- regex parser ------------------------------------------------------

/**
 * Decorator-line regex — matches `@DecoratorName(...)` even when arguments
 * span multiple lines, have inner commas, or inner parens (rare).
 * Non-greedy `[\s\S]*?\(...\)` prevents over-matching.
 */
const DECORATOR_LINE = /@(\w+)\s*\([\s\S]*?\)|@(\w+)(?=\s|$)/g;

/**
 * Method-declaration regex — captures a sequence of decorator lines
 * preceding `async methodName(` (or sync `methodName(`).
 * `[\s\S]*?` lets decorators be separated by any whitespace incl. CRLF.
 */
const METHOD_REGEX = /((?:\s*@\s*\w+(?:\s*\([\s\S]*?\))?\s*)+)\s*(?:async\s+)?(\w+)\s*\(/g;

function parseController(source: string): { className: string; methods: ScannedMethod[] } {
  const classMatch = source.match(/export\s+class\s+(\w+Controller|Controller)\b/);
  const className = classMatch ? classMatch[1] : 'Unknown';
  const methods: ScannedMethod[] = [];

  for (const m of source.matchAll(METHOD_REGEX)) {
    const decsBlock = m[1];
    const methodName = m[2];
    // Extract individual decorator lines from the block.
    const lines = decsBlock.split(/[\r\n]+/).map((l) => l.trim()).filter(Boolean);
    const decoratorLines = lines.filter((line) => line.startsWith('@'));
    if (decoratorLines.length === 0) continue;
    methods.push({ name: methodName, decoratorLines });
  }
  return { className, methods };
}

// ---- classification ----------------------------------------------------

const WRITE_VERBS = new Set(['Post', 'Put', 'Patch', 'Delete']) as Set<string>;

function classify(
  file: string,
  controller: string,
  method: ScannedMethod,
): WriteEndpointFinding | null {
  // Extract just the decorator names (without per-decorator args).
  const decoratorNames = method.decoratorLines.map((line) => {
    const m = line.match(/@(\w+)/);
    return m ? m[1] : '';
  });
  // Verb is first @Post/@Put/@Patch/@Delete in the block.
  const verbName = decoratorNames.find((n) => WRITE_VERBS.has(n));
  if (!verbName) return null;

  const hasRoles = method.decoratorLines.some((l) => l.startsWith('@Roles('));
  const hasPublic = method.decoratorLines.some((l) => l.startsWith('@Public('));

  let status: WriteEndpointFinding['status'];
  if (hasRoles) status = 'OK';
  else if (hasPublic) status = 'PUBLIC_TEMP';
  else status = 'MISSING';

  return {
    file,
    controller,
    method: method.name,
    verb: verbName.toUpperCase() as WriteEndpointFinding['verb'],
    hasRoles,
    hasPublic,
    status,
  };
}

// ---- output ------------------------------------------------------------

function printTable(findings: WriteEndpointFinding[], totalControllers: number): void {
  const ok = findings.filter((f) => f.status === 'OK');
  const temp = findings.filter((f) => f.status === 'PUBLIC_TEMP');
  const mis = findings.filter((f) => f.status === 'MISSING');

  console.log(`\n📊 @Roles coverage audit (TZ-91 §4 Phase B.1)`);
  console.log(`─────────────────────────────────────────────`);
  console.log(`Controllers scanned:           ${totalControllers}`);
  console.log(`Write endpoints total:         ${findings.length}`);
  console.log(`  ✅ OK (have @Roles):         ${ok.length}`);
  console.log(`  ⚠️  PUBLIC_TEMP (TZ-91A.2):  ${temp.length}`);
  console.log(`  ❌ MISSING (need fix):       ${mis.length}`);

  if (mis.length > 0) {
    console.log(`\n--- ❌ MISSING: write endpoints without @Roles ---`);
    // Sort by file for easier manual batching.
    const sorted = [...mis].sort((a, b) => a.file.localeCompare(b.file));
    for (const f of sorted) {
      const rel = relative(BACKEND_ROOT, f.file);
      console.log(`  ${rel}: ${f.controller}.${f.method}() [${f.verb}]`);
    }
  }

  if (temp.length > 0) {
    console.log(`\n--- ⚠️ PUBLIC_TEMP (TZ-91A.2 deferral — register/login/refresh) ---`);
    for (const f of temp) {
      const rel = relative(BACKEND_ROOT, f.file);
      console.log(`  ${rel}: ${f.controller}.${f.method}() [${f.verb}]`);
    }
  }

  console.log(`\nJSON report: ${relative(process.cwd(), REPORT_PATH)}`);
}

// ---- main --------------------------------------------------------------

function main(): void {
  const files = findControllers(SRC);
  const findings: WriteEndpointFinding[] = [];
  let totalControllers = 0;

  for (const file of files) {
    totalControllers++;
    const src = readFileSync(file, 'utf8');
    const { className, methods } = parseController(src);
    for (const m of methods) {
      const finding = classify(file, className, m);
      if (finding) findings.push(finding);
    }
  }

  const report: AuditReport = {
    generated: new Date().toISOString(),
    schemaVersion: 1,
    totalControllers,
    totalWriteEndpoints: findings.length,
    okCount: findings.filter((f) => f.status === 'OK').length,
    publicTempCount: findings.filter((f) => f.status === 'PUBLIC_TEMP').length,
    missingCount: findings.filter((f) => f.status === 'MISSING').length,
    findings,
  };

  printTable(findings, totalControllers);
  writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2));

  // Phase B acceptance: 0 MISSING.
  if (report.missingCount > 0) {
    console.error(
      `\n❌ ${report.missingCount} write endpoints MISSING @Roles coverage. ` +
      `TZ-91 §4 Phase B acceptance: 0 missing. ` +
      `Apply @Roles('admin','manager') on each.\n`,
    );
    process.exit(1);
  }

  console.log(`\n✅ All write endpoints have @Roles coverage.`);
  process.exit(0);
}

main();
