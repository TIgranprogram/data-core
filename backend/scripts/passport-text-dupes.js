/* Отчёт дублей текстов паспортов (БЗ-6 Э3b): materials, installationMethod, purpose. ТОЛЬКО ЧТЕНИЕ — в базу ничего не пишет, флага --apply нет.
 *
 *   MONGO_URI=… [MONGO_DB=…] node scripts/passport-text-dupes.js [--json файл] [--top N]
 */
const path = require('path');
const fs = require('fs');
const { groupExact, findNearDuplicates, byCategory } = require('./lib/text-dupes');

const FIELDS = [['materials', 'Материалы'], ['installationMethod', 'Способ установки'], ['purpose', 'Назначение']];
const arg = (k) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const clip = (s, n = 90) => { s = String(s).replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const top = Number(arg('--top')) || 30;
  const jsonFile = arg('--json');
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    const c = db.collection('productpassports');
    const docs = await c.find({ deletedAt: null }, { projection: { category: 1, materials: 1, installationMethod: 1, purpose: 1 } }).toArray();
    const report = { db: db.databaseName, passports: docs.length, fields: {} };
    console.log(`База ${db.databaseName}: паспортов (не удалённых) ${docs.length}. Режим: только чтение.\n`);
    for (const [f, title] of FIELDS) {
      const vals = docs.filter((d) => typeof d[f] === 'string' && d[f].trim()).map((d) => ({ category: d.category, value: d[f] }));
      const counts = new Map();
      for (const v of vals) counts.set(v.value, (counts.get(v.value) || 0) + 1);
      const exact = groupExact(counts);
      const near = findNearDuplicates(counts);
      const cats = byCategory(vals);
      report.fields[f] = { filled: vals.length, uniqueRaw: counts.size, exact, near, byCategory: cats };
      console.log(`=== ${title} (${f}) ===`);
      console.log(`Заполнено у ${vals.length} паспортов; уникальных написаний ${counts.size}.`);
      console.log(`\nа) Одинаковые после нормализации (разное написание): групп ${exact.length}`);
      for (const g of exact.slice(0, top)) {
        console.log(`  • всего ${g.total} пасп.; предлагаемый вариант: «${clip(g.canonical)}»`);
        for (const v of g.variants) console.log(`      ${String(v.count).padStart(4)} × «${clip(v.text)}»`);
      }
      console.log(`\nб) Похожие (Дайс по словам ≥ 0.85 или Левенштейн ≤ 10%): пар ${near.pairs.length}${near.skipped ? ` (сравнено первых 2000 форм, пропущено ${near.skipped})` : ''}`);
      for (const p of near.pairs.slice(0, top)) {
        console.log(`  • Дайс ${p.dice}, Лев. ${p.lev}\n      ${String(p.countA).padStart(4)} × «${clip(p.a)}»\n      ${String(p.countB).padStart(4)} × «${clip(p.b)}»`);
      }
      console.log('\nв) По категориям (разных текстов после нормализации):');
      for (const k of cats) console.log(`  ${String(k.distinctNorm).padStart(4)} разных (написаний ${k.distinctRaw}) на ${k.passports} пасп. — ${k.category}`);
      console.log('');
    }
    if (jsonFile) { fs.writeFileSync(jsonFile, JSON.stringify(report, null, 2)); console.log(`JSON записан: ${jsonFile}`); }
  } finally { await client.close(); }
}

if (require.main === module) main().catch((e) => { console.error(e.message || e); process.exit(1); });
