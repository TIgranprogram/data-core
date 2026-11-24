// Границы доменов (C255). Аналог eslint-plugin-boundaries без нового пакета.
// Включено (код 1): закрытый файл incomes/salesorders/product снаружи;
//   платформа auth/user/role/permissions/feature-flag не импортирует бизнес-модуль.
// Включено ещё: common (не spec) входит в эти три домена только через index или свой порт.
// Не включено: «любой чужой модуль только через index» и common во все остальные бизнес-модули —
//   прямых импортов десятки, список — --census. Порты цикла остаются на *-writes (L-251…254).
// Запуск из корня: node backend/scripts/audit-domain-boundaries.js [--census|--self-test]
const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..');

/** Уже открытые файлы трёх доменов. Новый закрытый файл сюда не добавлять. */
const LEGACY = {
  incomes: new Set([
    'income-cancel.service.ts',
    'income-payment-identities.ts',
    'income-writes.ts',
    'income.schema.ts',
    'incomes.module.ts',
    'incomes.service.ts',
  ]),
  salesorders: new Set([
    'production-orders.service.ts',
    'salesorder-writes.ts',
    'salesorders.module.ts',
    'salesorders.service.ts',
  ]),
  product: new Set([
    'product-writes.ts',
    'product.module.ts',
    'product.service.ts',
  ]),
};

const PLATFORM = new Set(['auth', 'user', 'role', 'permissions', 'feature-flag']);

/** Прямой импорт writes из порта не долг: бочка с Nest-модулем возвращает цикл. */
const PORT_WRITES = {
  'src/common/income-owner-port.ts': 'src/modules/incomes/income-writes.ts',
  'src/common/passport/line-source.ts': 'src/modules/incomes/income-writes.ts',
  'src/common/salesorder-owner-port.ts': 'src/modules/salesorders/salesorder-writes.ts',
  'src/common/order-archive/write.ts': 'src/modules/salesorders/salesorder-writes.ts',
  'src/common/product-owner-port.ts': 'src/modules/product/product-writes.ts',
  'src/common/stock-owner-port.ts': 'src/modules/stock/stock-writes.ts',
  'src/common/supply-owner-port.ts': 'src/modules/supply/supply-writes.ts',
};

const IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]*)['"]/g;

function domainOf(rel) {
  const m = String(rel).match(/^src\/modules\/([^/]+)\//);
  return m ? m[1] : null;
}

function baseName(rel) {
  return String(rel).split('/').pop();
}

/** Находки включённого правила. Пустой список — импорт разрешён. */
function checkRel(importerRel, targetRel) {
  const out = [];
  const impDom = domainOf(importerRel);
  const tgtDom = domainOf(targetRel);
  if (!tgtDom) return out;
  if (PLATFORM.has(impDom) && !PLATFORM.has(tgtDom)) {
    out.push({ kind: 'platform', importerRel, targetRel, importerDomain: impDom, targetDomain: tgtDom });
  }
  const legacy = LEGACY[tgtDom];
  if (legacy && impDom !== tgtDom) {
    const base = baseName(targetRel);
    if (base !== 'index.ts' && !legacy.has(base)) {
      out.push({ kind: 'private', importerRel, targetRel, targetDomain: tgtDom, base });
    }
  }
  if (legacy && importerRel.startsWith('src/common/') && !importerRel.endsWith('.spec.ts')) {
    const viaIndex = baseName(targetRel) === 'index.ts';
    const viaPort = PORT_WRITES[importerRel] === targetRel;
    if (!viaIndex && !viaPort) {
      out.push({ kind: 'common', importerRel, targetRel, targetDomain: tgtDom, base: baseName(targetRel) });
    }
  }
  return out;
}

/** Полное правило «только index» (не включено). Порт цикла на свой writes — не долг. */
function isStrictDebt(importerRel, targetRel) {
  const tgtDom = domainOf(targetRel);
  if (!LEGACY[tgtDom] || domainOf(importerRel) === tgtDom) return false;
  if (baseName(targetRel) === 'index.ts') return false;
  if (PORT_WRITES[importerRel] === targetRel) return false;
  return true;
}

/** common тянет бизнес не через index и не через порт хозяина (не включено). */
function isCommonDeep(importerRel, targetRel) {
  if (!importerRel.startsWith('src/common/')) return false;
  if (PORT_WRITES[importerRel] === targetRel) return false;
  const tgtDom = domainOf(targetRel);
  if (!tgtDom || PLATFORM.has(tgtDom)) return false;
  if (baseName(targetRel) === 'index.ts') return false;
  return true;
}

function message(f) {
  if (f.kind === 'platform') {
    return `Платформа «${f.importerDomain}» не импортирует бизнес-модуль «${f.targetDomain}»`;
  }
  if (f.kind === 'common') {
    return `common не импортирует «${f.targetDomain}/${f.base}» вглубь: только index.ts или порт цикла`;
  }
  return `Модуль «${f.targetDomain}»: снаружи только index.ts или уже открытый файл, не «${f.base}»`;
}

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, out);
    } else if (e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

function relOf(abs) {
  return path.relative(BACKEND, abs).split(path.sep).join('/');
}

function resolveImport(importerAbs, spec) {
  if (!spec.startsWith('.')) return null;
  const base = path.resolve(path.dirname(importerAbs), spec);
  const candidates = [base, base + '.ts', base + '.tsx', path.join(base, 'index.ts')];
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** Пары импортов внутри каталога (относительно backend/). */
function collect(absDir) {
  const pairs = [];
  for (const file of walk(absDir, [])) {
    const src = fs.readFileSync(file, 'utf8');
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(src))) {
      const target = resolveImport(file, m[1]);
      if (!target) continue;
      pairs.push({ importerRel: relOf(file), targetRel: relOf(target) });
    }
  }
  return pairs;
}

function gate(pairs) {
  const found = [];
  for (const p of pairs) found.push(...checkRel(p.importerRel, p.targetRel));
  return found;
}

/** То же решение, что у ворот: ESLint не должен расходиться со скриптом. */
function findingsFor(importerAbs, spec) {
  const target = resolveImport(importerAbs, spec);
  if (!target) return [];
  return checkRel(relOf(importerAbs), relOf(target));
}

function selfTest() {
  const bad = checkRel('src/modules/finance/finance.service.ts', 'src/modules/incomes/dto.ts');
  const ok = checkRel('src/modules/finance/finance.service.ts', 'src/modules/incomes/income-writes.ts');
  const viaIndex = checkRel('src/modules/finance/finance.service.ts', 'src/modules/incomes/index.ts');
  const inside = checkRel('src/modules/incomes/incomes.service.ts', 'src/modules/incomes/dto.ts');
  const plat = checkRel('src/modules/auth/auth.service.ts', 'src/modules/incomes/index.ts');
  const platOk = checkRel('src/modules/auth/auth.service.ts', 'src/modules/user/user.service.ts');
  const port = isStrictDebt('src/common/income-owner-port.ts', 'src/modules/incomes/income-writes.ts');
  const debt = isStrictDebt('src/modules/finance/finance.service.ts', 'src/modules/incomes/income-writes.ts');
  const portOk = checkRel('src/common/income-owner-port.ts', 'src/modules/incomes/income-writes.ts');
  const commonBad = checkRel('src/common/foo.ts', 'src/modules/incomes/income.schema.ts');
  if (bad.length !== 1 || bad[0].kind !== 'private') return 1;
  if (ok.length || viaIndex.length || inside.length || platOk.length || portOk.length) return 1;
  if (plat.length !== 1 || plat[0].kind !== 'platform') return 1;
  if (commonBad.length !== 1 || commonBad[0].kind !== 'common') return 1;
  if (port !== false || debt !== true) return 1;
  if (LEGACY.incomes.has('dto.ts') || !LEGACY.product.has('product-writes.ts')) return 1;
  return 0;
}

function bucket(rel) {
  if (rel.includes('.spec.ts')) return 'spec';
  if (rel.startsWith('src/common/seed/')) return 'seed';
  return 'runtime';
}

function census(srcPairs, testPairs) {
  const strict = srcPairs.filter((p) => isStrictDebt(p.importerRel, p.targetRel));
  const common = srcPairs.filter((p) => isCommonDeep(p.importerRel, p.targetRel));
  const byTarget = new Map();
  for (const p of strict) byTarget.set(p.targetRel, (byTarget.get(p.targetRel) || 0) + 1);
  const byCommon = new Map();
  for (const p of common) {
    const key = `${bucket(p.importerRel)} ${domainOf(p.targetRel)}`;
    byCommon.set(key, (byCommon.get(key) || 0) + 1);
  }
  return { strict, byTarget, common, byCommon, testDeep: testPairs.filter((p) => isStrictDebt(p.importerRel, p.targetRel)) };
}

function main() {
  const arg = process.argv[2];
  if (arg === '--self-test') {
    const code = selfTest();
    console.log(code === 0 ? 'self-test: ок' : 'self-test: сбой');
    process.exit(code);
  }
  const srcPairs = collect(path.join(BACKEND, 'src'));
  const found = gate(srcPairs);
  const strictN = srcPairs.filter((p) => isStrictDebt(p.importerRel, p.targetRel)).length;
  if (found.length) {
    for (const f of found) console.log(`${f.importerRel} → ${f.targetRel} — ${message(f)}`);
    console.log(`Границы: нарушений ${found.length}. Полное «только index» выключено, прямых импортов ${strictN}.`);
    process.exit(1);
  }
  console.log(`Границы: закрытые файлы 0, платформа 0, common в три домена только через порт или index. Полное «только index» выключено, прямых импортов ${strictN}.`);
  if (arg === '--census') {
    const testDir = path.join(BACKEND, 'test');
    const report = census(srcPairs, fs.existsSync(testDir) ? collect(testDir) : []);
    console.log('— только index, по файлам (src, порты цикла не долг):');
    for (const [k, v] of [...report.byTarget.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      console.log(`  ${v} ${k}`);
    }
    const byImporter = new Map();
    for (const p of report.strict) {
      const mod = p.importerRel.startsWith('src/modules/') ? p.importerRel.split('/')[2]
        : p.importerRel.split('/').slice(0, 3).join('/');
      byImporter.set(mod, (byImporter.get(mod) || 0) + 1);
    }
    console.log('— только index, кто импортирует:');
    for (const [k, v] of [...byImporter.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      console.log(`  ${v} ${k}`);
    }
    console.log('— common вглубь бизнеса, кроме портов и платформы:');
    for (const [k, v] of [...report.byCommon.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      console.log(`  ${v} ${k}`);
    }
    console.log(`— e2e/test прямых импортов трёх доменов (ворота eslint их не видят): ${report.testDeep.length}`);
    for (const p of report.testDeep) console.log(`  ${p.importerRel} → ${p.targetRel}`);
  }
  process.exit(0);
}

module.exports = {
  LEGACY, PLATFORM, PORT_WRITES, checkRel, isStrictDebt, isCommonDeep, message,
  collect, gate, selfTest, census, resolveImport, findingsFor,
};

if (require.main === module) main();
