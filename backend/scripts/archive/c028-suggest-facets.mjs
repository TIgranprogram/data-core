// C028 R1 — подсказка признака по названию изделия (без ИИ).
// Чистая функция suggest(name, category, seed) + CLI-прогон по products.json.
// Правило (facets-seed.json wordsRule): корни через |, без регистра, ё=е,
// подстрока в названии; значения по order, первое совпадение — подсказка.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const norm = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');

/** suggestion для одного названия по всем признакам категории: [{ facet, value, word }] */
export function suggest(name, category, seed) {
  const cat = seed.categories.find((c) => c.category === category);
  if (!cat) return [];
  const n = norm(name);
  const out = [];
  for (const facet of cat.facets) {
    const values = [...facet.values].sort((a, b) => a.order - b.order);
    for (const v of values) {
      const words = String(v.words || '').split('|').map((w) => norm(w)).filter(Boolean);
      const hit = words.find((w) => n.includes(w));
      if (hit) { out.push({ facet: facet.code, value: v.code, word: hit }); break; }
    }
  }
  return out;
}

function main() {
  const products = JSON.parse(readFileSync(resolve(ROOT, 'tools/logs/c028/products.json'), 'utf8'));
  const seed = JSON.parse(readFileSync(resolve(ROOT, 'docs/crew/C028-passport-funnel/facets-seed.json'), 'utf8'));

  const rows = [];
  for (const p of products.items) {
    for (const s of suggest(p.name, p.ppCategory, seed)) {
      rows.push({ id: p.id, sku: p.sku, name: p.name, category: p.ppCategory, facet: s.facet, value: s.value, word: s.word });
    }
  }
  const outDir = resolve(ROOT, 'tools/logs/c028');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(resolve(outDir, 'suggest.json'), JSON.stringify(rows, null, 1), 'utf8');

  // покрытие по признакам-шагам
  const byFacet = {};
  for (const r of rows) {
    byFacet[r.facet] ??= {};
    byFacet[r.facet][r.value] = (byFacet[r.facet][r.value] || 0) + 1;
  }
  const catCounts = {};
  for (const p of products.items) catCounts[p.ppCategory] = (catCounts[p.ppCategory] || 0) + 1;
  const step1 = { TRN: 'trn.kind', WRK: 'wrk.kind' };
  for (const [cat, facet] of Object.entries(step1)) {
    const got = rows.filter((r) => r.facet === facet).length;
    console.log(`${facet}: ${got}/${catCounts[cat]} (${Math.round((got / catCounts[cat]) * 100)}%)`);
  }
  console.log(`suggest.json: ${rows.length} строк`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
