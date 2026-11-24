// Аудит циклов между модулями: взаимные пары A<->B и простые циклы длины ≥3.
// Запуск из backend/: node scripts/audit-cycles.js
// Код выхода 0 — новых находок нет. 1 — пара, цикл ≥3 вне белого списка
// или усечённый поиск. Строка списка, которой уже нет в дереве, только печатается.
// KNOWN_LONG — снимок долга 2026-11-24 (C256). Новую строку не добавлять молча.
// C251: matching и product-passport больше не импортируют incomes (запись через common/income-owner-port).
// Проверка детектора: node scripts/audit-cycles.js --self-test
//   или из корня: node --test backend/scripts/audit-cycles.test.mjs
// -v — файлы импортов и известные циклы.
const fs = require('fs');
const os = require('os');
const path = require('path');

const IMPORT_RE = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]*)['"]/g;
const MAX_CYCLES = 200;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

function scan(root) {
  const edges = new Map();
  for (const file of walk(root, [])) {
    const mod = path.relative(root, file).split(path.sep)[0];
    const src = fs.readFileSync(file, 'utf8');
    IMPORT_RE.lastIndex = 0;
    let m;
    while ((m = IMPORT_RE.exec(src))) {
      const rel = path.relative(root, path.resolve(path.dirname(file), m[1]));
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      const tm = rel.split(path.sep)[0];
      if (!tm || tm === mod) continue;
      const key = mod + '>' + tm;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(path.relative(root, file).split(path.sep).join('/'));
    }
  }
  const found = enumerateCycles(edgesToAdj(edges));
  return { edges, pairs: findPairs(edges), long: found.cycles, truncated: found.truncated };
}

function findPairs(edges) {
  const pairs = [];
  for (const key of edges.keys()) {
    const [a, b] = key.split('>');
    if (a < b && edges.has(b + '>' + a)) pairs.push([a, b]);
  }
  pairs.sort((x, y) => (x[0] === y[0] ? x[1].localeCompare(y[1]) : x[0].localeCompare(y[0])));
  return pairs;
}

function edgesToAdj(edges) {
  const adj = new Map();
  for (const key of edges.keys()) {
    const [a, b] = key.split('>');
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
  }
  return adj;
}

// Каждый простой цикл один раз: обход только от наименьшего имени, дальше — узлы больше него.
function enumerateCycles(adj, minLen = 3) {
  const cycles = [];
  let truncated = false;
  const nodes = [...adj.keys()].sort();

  function dfs(start, node, path) {
    if (truncated) return;
    const nexts = adj.get(node);
    if (!nexts) return;
    for (const nxt of [...nexts].sort()) {
      if (nxt === start) {
        if (path.length >= minLen) {
          cycles.push(path.slice());
          if (cycles.length >= MAX_CYCLES) { truncated = true; return; }
        }
      } else if (nxt > start && !path.includes(nxt)) {
        path.push(nxt);
        dfs(start, nxt, path);
        path.pop();
        if (truncated) return;
      }
    }
  }

  for (const start of nodes) {
    dfs(start, start, [start]);
    if (truncated) break;
  }
  cycles.sort((x, y) => x.join('>').localeCompare(y.join('>')));
  return { cycles, truncated };
}

function findLongCycles(adj, minLen = 3) {
  return enumerateCycles(adj, minLen).cycles;
}

function filesOf(edges, a, b) {
  return [...new Set(edges.get(a + '>' + b) || [])].join(', ');
}

// Канонический ключ — путь от наименьшего имени модуля, как его даёт enumerateCycles.
const KNOWN_LONG = [
  'design>salesorders>incomes',
  'design>salesorders>incomes>product-requests',
  'design>salesorders>incomes>product-requests>matching',
  'design>salesorders>matching',
  'design>salesorders>product-passport>productattachments>incomes',
  'design>salesorders>product-passport>productattachments>incomes>product-requests',
  'design>salesorders>product-passport>productattachments>incomes>product-requests>matching',
  'design>salesorders>productattachments>incomes',
  'design>salesorders>productattachments>incomes>product-requests',
  'design>salesorders>productattachments>incomes>product-requests>matching',
];

function splitKnown(cycles, knownList = KNOWN_LONG) {
  const known = new Set(knownList);
  const fresh = [];
  const hit = new Set();
  for (const cyc of cycles) {
    const key = cyc.join('>');
    if (known.has(key)) hit.add(key);
    else fresh.push(cyc);
  }
  return { fresh, stale: knownList.filter((k) => !hit.has(k)) };
}

function printCycle(cyc, edges, verbose) {
  console.log(`  ${cyc.join(' -> ')} -> ${cyc[0]}`);
  if (!verbose) return;
  for (let i = 0; i < cyc.length; i++) {
    const a = cyc[i];
    const b = cyc[(i + 1) % cyc.length];
    console.log(`    ${a} -> ${b}: ${filesOf(edges, a, b)}`);
  }
}

function report(result, verbose, knownList = KNOWN_LONG) {
  const { pairs, long, edges, truncated } = result;
  const { fresh, stale } = splitKnown(long, knownList);
  console.log(`Взаимных пар модулей: ${pairs.length}`);
  for (const [a, b] of pairs) {
    console.log(`  ${a} <-> ${b}`);
    if (verbose) {
      console.log(`    ${a} -> ${b}: ${filesOf(edges, a, b)}`);
      console.log(`    ${b} -> ${a}: ${filesOf(edges, b, a)}`);
    }
  }
  console.log(`Длинных циклов: ${long.length}${truncated ? '+' : ''}`);
  console.log(`Новых длинных циклов: ${fresh.length}`);
  for (const cyc of fresh) printCycle(cyc, edges, verbose);
  console.log(`Белый список длинных циклов: ${knownList.length}, лишних строк: ${stale.length}`);
  for (const key of stale) console.log(`  нет в дереве: ${key.split('>').join(' -> ')}`);
  if (verbose) for (const cyc of long) if (knownList.includes(cyc.join('>'))) printCycle(cyc, edges, true);
  if (truncated) console.log(`Поиск остановлен на ${MAX_CYCLES} циклах`);
  // Лишняя строка списка не краснит прогон: цикл уже исчез, список сожмут отдельной правкой.
  return pairs.length + fresh.length + (truncated ? 1 : 0);
}

function writeMod(root, name, body) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${name}.ts`), body);
}

// Искусственное дерево: треугольник a→b→c→a, пара d↔e, цепочка f→g, spec не рисует ребро.
function fixtureScan() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-cycles-'));
  try {
    writeMod(root, 'a', "import { b } from '../b/b';\nimport { local } from './local';\nimport { out } from '../../outside';\n");
    writeMod(root, 'b', "import { c } from '../c/c';\n");
    writeMod(root, 'c', "import { a } from '../a/a';\n");
    writeMod(root, 'd', "import { e } from '../e/e';\n");
    writeMod(root, 'e', "import { d } from '../d/d';\n");
    writeMod(root, 'f', "import { g } from '../g/g';\n");
    writeMod(root, 'g', 'export const g = 1;\n');
    writeMod(root, 'z', "import { a } from '../a/a';\n");
    fs.writeFileSync(path.join(root, 'a', 'local.ts'), 'export const local = 1;\n');
    fs.writeFileSync(path.join(root, 'a', 'a.spec.ts'), "import { z } from '../z/z';\n");
    return scan(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function selfTest() {
  const { pairs, long, edges } = fixtureScan();
  const keys = [...edges.keys()].sort();
  const four = findLongCycles(new Map([
    ['b', new Set(['c'])],
    ['c', new Set(['d'])],
    ['d', new Set(['e'])],
    ['e', new Set(['b'])],
  ]));
  const clean = findLongCycles(new Map([
    ['a', new Set(['b'])],
    ['b', new Set(['c'])],
    ['c', new Set()],
  ]));
  const hidden = splitKnown(long);
  const ok = keys.join(',') === 'a>b,b>c,c>a,d>e,e>d,f>g,z>a'
    && pairs.length === 1 && pairs[0].join('>') === 'd>e'
    && long.length === 1 && long[0].join('>') === 'a>b>c'
    && four.length === 1 && four[0].join('>') === 'b>c>d>e'
    && clean.length === 0
    && hidden.fresh.length === 1;
  if (!ok) {
    console.error('self-test FAIL', JSON.stringify({ keys, pairs, long, four, clean }));
    return 1;
  }
  console.log('self-test: треугольник, цикл длины 4 и пара пойманы; цепочка без цикла чистая');
  return 0;
}

function main() {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  const n = report(scan(path.join(__dirname, '..', 'src', 'modules')), process.argv.includes('-v'));
  if (n) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  scan, findPairs, findLongCycles, edgesToAdj, fixtureScan, report, selfTest, splitKnown, KNOWN_LONG,
};
