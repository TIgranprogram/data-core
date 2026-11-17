/* C137 Э1: отчёт «противоречия в текстах паспортов» (ТОЛЬКО ЧТЕНИЕ, ничего не пишет): все паспорта с текстом,
 * тот же код проверки, что в карточке (dist/…/passport-lint-run.js; запуск — в контейнере).
 *
 *   bash remote-access/run-script.sh passport-lint-report        (MONGO_URI в контейнере уже есть)
 * Итог — в вывод (кнопка пульта кладёт его в журнал); ключ --json — построчно для машины.
 */
const path = require('path');
(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const base = [process.cwd(), path.join(__dirname, '..')];
  const { lintDoc } = require(require.resolve('./dist/src/modules/product-passport/passport-lint-run.js', { paths: base }));
  const { MongoClient } = require(require.resolve('mongoose', { paths: base })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — только чтение`);
    const docs = await db.collection('productpassports').find({ deletedAt: null, status: { $ne: 'annulled' }, 'textSnapshot.sections.0': { $exists: true } },
      { projection: { name: 1, passportNumber: 1, status: 1, passportCategory: 1, joints: 1, elements: 1, materialsSpec: 1, images: 1, textSnapshot: 1 } }).toArray();
    const byCode = new Map(); const bad = [];
    for (const d of docs) {
      const f = await lintDoc(db, d);
      for (const x of f) byCode.set(x.code, (byCode.get(x.code) || 0) + 1);
      if (f.length) bad.push({ no: d.passportNumber, status: d.status, name: String(d.name || '').slice(0, 50), errors: f.filter((x) => x.severity === 'error').length, warns: f.filter((x) => x.severity === 'warn').length, first: f.slice(0, 3).map((x) => `${x.code}: ${x.where}`) });
    }
    console.log(`Паспортов с текстом: ${docs.length}; с замечаниями: ${bad.length}; ошибок: ${bad.reduce((n, b) => n + b.errors, 0)}; предупреждений: ${bad.reduce((n, b) => n + b.warns, 0)}`);
    console.log('По правилам:', [...byCode].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}=${n}`).join(', ') || '—');
    bad.sort((a, b) => b.errors - a.errors || b.warns - a.warns);
    for (const b of bad.slice(0, 40)) console.log(`№ ${b.no} [${b.status}] ${b.name} — ошибок ${b.errors}, предупреждений ${b.warns}; ${b.first.join(' | ')}`);
    if (bad.length > 40) console.log(`… и ещё ${bad.length - 40}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(2); });
