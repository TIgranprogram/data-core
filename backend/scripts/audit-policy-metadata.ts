/**
 * TZ-258 §ШАГ 2 — `audit-policy-metadata.ts` (run via `ts-node` or compiled entrypoint).
 *
 * Walks every `*.controller.ts` in `backend/src/modules/` (excluding the
 * scripts scan root itself), regex-extracts the metadata-bearing decorators
 * per handler (`@Permissions(...)`, `@Roles(...)`, `@OwnerOnly(...)`,
 * `@Public()` — the latter TBD), and reports:
 *
 *   - Handlers with NONE of the metadata → flagging (potential gap);
 *   - Handlers with @Roles but NO @Permissions → flagging (legacy gap);
 *   - Handlers with @Permissions + @OwnerOnly → flagging (overlap check);
 *   - Handlers in `LEGACY_RBAC_EXCEPTIONS.json` → exempt and listed;
 *   - Handlers NOT covered by any of the above → FAIL exit 1.
 *
 * This SCRIPT is the seam between contract documentation and runtime gates.
 * It is NOT a NestJS lifecycle hook — it lives in `backend/scripts/` and
 * is invoked from CI as a `pnpm run audit:policy` script.
 *
 * Exit codes:
 *   0 = all handlers covered (or listed as legacy exception)
 *   1 = at least one handler uncategorized; human review required
 *
 * NOTE: regex parsing is intentionally narrow. Future migration to AST
 * parsing (e.g. via `typescript` compiler API) is a TZ-258.D candidate
 * if dynamic metadata detection is required.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

interface HandlerFinding {
  controllerPath: string;
  handlerName: string;
  hasPermissions: boolean;
  hasRoles: boolean;
  hasOwnerOnly: boolean;
  permissionsKeys: string[];
  rolesKeys: string[];
  ownerOnlyKeys: string[];
}

interface ScriptOptions {
  modulesRoot: string;
  legacyExceptionsPath: string;
}

function main(opts: ScriptOptions): number {
  const { modulesRoot, legacyExceptionsPath } = opts;

  // 1. Load legacy exceptions list.
  let exceptions: Array<{ controllerPath: string; reason: string }> = [];
  try {
    const raw = fs.readFileSync(legacyExceptionsPath, 'utf-8');
    exceptions = JSON.parse(raw);
  } catch {
    // eslint-disable-next-line no-console
    console.warn(
      `[audit-policy-metadata] WARN: could not load legacy exceptions list at ${legacyExceptionsPath}; treating as empty.`,
    );
  }
  const exemptPaths = new Set(exceptions.map((e) => e.controllerPath.replace(/\\/g, '/')));

  // 2. Walk the modules tree.
  const controllers = walkControllers(modulesRoot);

  // 3. Extract metadata per handler per controller.
  const findings: HandlerFinding[] = [];
  for (const c of controllers) {
    const normPath = c.path.replace(/\\/g, '/');
    if (exemptPaths.has(normPath)) continue; // exempt controllers are not scanned
    const handlers = extractHandlers(c.content);
    for (const h of handlers) {
      if (isNestjsLifecycleHandler(h.name)) continue;
      findings.push({
        controllerPath: normPath,
        handlerName: h.name,
        hasPermissions: h.permissions.length > 0,
        hasRoles: h.roles.length > 0,
        hasOwnerOnly: h.ownerOnly.length > 0,
        permissionsKeys: h.permissions,
        rolesKeys: h.roles,
        ownerOnlyKeys: h.ownerOnly,
      });
    }
  }

  // 4. Categorize each finding.
  const uncovered: HandlerFinding[] = [];
  const rolesOnly: HandlerFinding[] = [];
  const rolesAndPermissions: HandlerFinding[] = [];
  const ownerOverlap: HandlerFinding[] = [];

  for (const f of findings) {
    if (!f.hasPermissions && !f.hasRoles && !f.hasOwnerOnly) {
      uncovered.push(f);
    } else if (f.hasRoles && !f.hasPermissions && !f.hasOwnerOnly) {
      rolesOnly.push(f);
    } else if (f.hasPermissions && f.hasOwnerOnly) {
      ownerOverlap.push(f);
    } else {
      rolesAndPermissions.push(f);
    }
  }

  // 5. Report.
  // eslint-disable-next-line no-console
  console.log(`[audit-policy-metadata] scanned ${findings.length} handlers across ${controllers.length} controllers`);
  // eslint-disable-next-line no-console
  console.log(`  ⊘ legacy-exempt controllers: ${exemptPaths.size}`);
  // eslint-disable-next-line no-console
  console.log(`  ✓ roles+permissions+ownerOnly: ${rolesAndPermissions.length}`);
  // eslint-disable-next-line no-console
  console.log(`  ⚠ @Roles-only (legacy gap): ${rolesOnly.length}`);
  // eslint-disable-next-line no-console
  console.log(`  ⚠ @OwnerOnly+@Permissions overlap (overlap audit): ${ownerOverlap.length}`);
  // eslint-disable-next-line no-console
  console.log(`  ✕ no metadata (uncategorized): ${uncovered.length}`);

  if (uncovered.length > 0) {
    // eslint-disable-next-line no-console
    console.log('\n[audit-policy-metadata] FAIL — uncovered handlers:');
    for (const u of uncovered) {
      // eslint-disable-next-line no-console
      console.log(`  - ${u.controllerPath}::${u.handlerName}`);
    }
    // eslint-disable-next-line no-console
    console.log(
      '\nFix options:\n' +
        '  1. Add @Public() decorator if the handler MUST stay open.\n' +
        '  2. Add @Roles(...) / @Permissions(...) to gate it explicitly.\n' +
        '  3. Add a {@OwnerOnly(...)} if it manipulates a single resource.\n' +
        '  4. Add an entry to LEGACY_RBAC_EXCEPTIONS.json with `reason` and `planned_remediation_tz`.',
    );
    return 1;
  }

  return 0;
}

/**
 * Recursively find `*.controller.ts` under `modulesRoot`. We avoid the
 * `scripts/` and `node_modules/` directories automatically.
 */
function walkControllers(modulesRoot: string): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];
  const stack: string[] = [modulesRoot];
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        stack.push(full);
      } else if (e.isFile() && e.name.endsWith('.controller.ts') && !e.name.endsWith('.spec.ts')) {
        results.push({ path: full, content: fs.readFileSync(full, 'utf-8') });
      }
    }
  }
  return results;
}

/**
 * Per-handler metadata extraction. The patterns are deliberately
 * conservative: they match decorator args WITHOUT considering heredocs /
 * template literals. Sufficient for the catalog-style @Permissions() /
 * @Roles() / @OwnerOnly() calls in this codebase.
 */
interface HandlerMetadata {
  name: string;
  permissions: string[];
  roles: string[];
  ownerOnly: string[];
}

function extractHandlers(content: string): HandlerMetadata[] {
  const trimmed = stripComments(content);
  // Crude handler extractor: any METHOD_DECORATORS-precursor + `name(args...) {`.
  const HANDLER_RE = /@[\s\S]*?\n\s*(?:public\s+|protected\s+|private\s+)?async?\s*([a-zA-Z0-9_]+)\s*\(/g;
  const out: HandlerMetadata[] = [];
  let cursor = 0;
  while (true) {
    const m = HANDLER_RE.exec(trimmed);
    if (m === null) break;
    // Find the LAST @Permissions/@Roles/@OwnerOnly decorator immediately before the handler signature.
    const head = trimmed.slice(Math.max(0, m.index - 800), m.index);
    const perms = extractLastArgument(head, '@Permissions');
    const roles = extractLastArgument(head, '@Roles');
    const ownr = extractLastArgument(head, '@OwnerOnly');
    out.push({
      name: m[1],
      permissions: perms,
      roles,
      ownerOnly: ownr,
    });
    if (cursor === HANDLER_RE.lastIndex) break;
    cursor = HANDLER_RE.lastIndex;
  }
  return out;
}

/** Conservatively strip TS-style block comments and line comments. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Pull all top-level string-literal args from the last occurrence of a decorator. */
function extractLastArgument(block: string, decorator: string): string[] {
  const re = new RegExp(`@${decorator}\\s*\\(([\\s\\S]*?)\\)`, 'g');
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) {
    last = m[1];
  }
  if (last === null) return [];
  // Capture string literals.
  const stringRe = /'([^']*)'|"([^"]*)"|`([^`]*)`/g;
  const out: string[] = [];
  let s: RegExpExecArray | null;
  while ((s = stringRe.exec(last)) !== null) {
    out.push(s[1] ?? s[2] ?? s[3] ?? '');
  }
  return out;
}

function isNestjsLifecycleHandler(name: string): boolean {
  // Built-in hot-word handlers NestJS auto-generates; not subject to RBAC.
  return ['ngOnInit', 'ngOnDestroy', 'ngOnChanges', 'constructor'].includes(name);
}

// ========= CLI entrypoint =========

if (require.main === module) {
  const modulesRoot = path.resolve(__dirname, '..', 'src', 'modules');
  const legacyExceptionsPath = path.resolve(
    __dirname,
    'scripts-fields-helpers',
    'LEGACY_RBAC_EXCEPTIONS.json',
  );
  const exitCode = main({ modulesRoot, legacyExceptionsPath });
  process.exit(exitCode);
}

export { main, walkControllers, extractHandlers, extractLastArgument, stripComments };
export type { HandlerFinding, HandlerMetadata };
