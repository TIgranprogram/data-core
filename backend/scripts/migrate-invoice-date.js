/* Перенос даты счёта: supplyrequests.sheetExtra.invoiceDate → supplyrequests.invoiceDate (TASKS Ф.2).
 *
 * По умолчанию — ТОЛЬКО ОТЧЁТ (dry-run): сколько записей, сколько разобралось, какие нет. Ничего не пишет.
 * Запись — флаг --apply. На живой базе запускать только после «да» пользователя и свежего бэкапа.
 *
 *   MONGO_URI='mongodb://user:pw@host:port/db?authSource=admin&replicaSet=rs0&directConnection=true' \
 *   MONGO_DB=datacore node scripts/migrate-invoice-date.js [--apply]
 *
 * На VM (в образе нет scripts/): docker cp scripts/migrate-invoice-date.js datacore-backend:/tmp/ &&
 *   docker exec -w /app datacore-backend node /tmp/migrate-invoice-date.js   (MONGO_URI/MONGO_DB — из окружения контейнера)
 * Трогает только записи без invoiceDate; sheetExtra не удаляется (откат — $unset invoiceDate по списку из отчёта).
 */
const path = require('path');
// драйвер — из mongoose (pnpm не кладёт mongodb в корень node_modules)
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

// Тот же разбор, что src/common/date-parse.ts (там юнит-тесты): дд.мм.гггг, ГГГГ-ММ-ДД, число-дата Google.
function utc(y, m, d) {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt : undefined;
}
function parseSheetDate(v) {
  if (v === null || v === undefined || v === '') return undefined;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : utc(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 25000 || v > 80000) return undefined;
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000);
    return utc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) return utc(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})(?:\s.*)?$/.exec(s);
  if (m) return utc(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if (/^\d+(\.\d+)?$/.test(s)) return parseSheetDate(Number(s));
  return undefined;
}

(async () => {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || undefined);
  const coll = db.collection('supplyrequests');
  const docs = await coll.find({ deletedAt: null, invoiceDate: { $exists: false }, 'sheetExtra.invoiceDate': { $exists: true } },
    { projection: { num: 1, title: 1, 'sheetExtra.invoiceDate': 1 } }).toArray();
  const ok = [], bad = [];
  for (const d of docs) {
    const parsed = parseSheetDate(d.sheetExtra.invoiceDate);
    (parsed ? ok : bad).push({ _id: d._id, num: d.num, title: d.title, raw: d.sheetExtra.invoiceDate, parsed });
  }
  console.log(`База: ${db.databaseName}. Режим: ${apply ? 'ЗАПИСЬ' : 'только отчёт (dry-run)'}`);
  console.log(`Заявок с датой счёта в sheetExtra и без invoiceDate: ${docs.length}`);
  console.log(`  разобралось: ${ok.length}`);
  console.log(`  не разобралось: ${bad.length}`);
  for (const b of bad) console.log(`    №${b.num ?? '—'} «${String(b.title ?? '').slice(0, 60)}»: ${JSON.stringify(b.raw)}`);
  if (ok.length) console.log(`  пример: №${ok[0].num} ${JSON.stringify(ok[0].raw)} → ${ok[0].parsed.toISOString().slice(0, 10)}`);
  if (apply && ok.length) {
    const res = await coll.bulkWrite(ok.map((x) => ({ updateOne: { filter: { _id: x._id, invoiceDate: { $exists: false } }, update: { $set: { invoiceDate: x.parsed } } } })));
    console.log(`Записано: ${res.modifiedCount}`);
  }
  await client.close();
})().catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
