// Аудит циклов между модулями: взаимные пары A<->B по относительным импортам.
// Запуск: node scripts/audit-cycles.js   (из backend/)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'modules');
const edges = new Map(); // "A>B" -> [файлы]

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) out.push(p);
  }
  return out;
}

const re = /(?:from|import|require)\s*\(?\s*['"](\.[^'"]*)['"]/g;
for (const file of walk(root, [])) {
  const mod = path.relative(root, file).split(path.sep)[0];
  const src = fs.readFileSync(file, 'utf8');
  let m;
  while ((m = re.exec(src))) {
    const target = path.resolve(path.dirname(file), m[1]);
    const rel = path.relative(root, target);
    if (rel.startsWith('..')) continue;
    const tm = rel.split(path.sep)[0];
    if (tm === mod) continue;
    const key = mod + '>' + tm;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push(path.relative(root, file).split(path.sep).join('/'));
  }
}

const pairs = [];
for (const key of edges.keys()) {
  const [a, b] = key.split('>');
  if (a < b && edges.has(b + '>' + a)) pairs.push([a, b]);
}
pairs.sort();
console.log(`Взаимных пар модулей: ${pairs.length}`);
for (const [a, b] of pairs) {
  console.log(`  ${a} <-> ${b}`);
  if (process.argv.includes('-v')) {
    console.log(`    ${a} -> ${b}: ${[...new Set(edges.get(a + '>' + b))].join(', ')}`);
    console.log(`    ${b} -> ${a}: ${[...new Set(edges.get(b + '>' + a))].join(', ')}`);
  }
}
