/* ПЧ-1 (2026-10-30): исправление passportCategory у ≈30 паспортов — аудит AUDIT-PASSPORT-PARTS §4.4.
 * Источник: разбор картинок 342 паспортов; списки номеров проверены вручную.
 *
 * Три группы:
 *   А) TRN → WRK: воркаут и спортивное оборудование (турники, брусья, скамьи, баскетбол, волейбол)
 *   Б) TRN → BLG: благоустройство (урна, стела, калитка)
 *   В) WRK → TRN: уличные тренажёры, ошибочно попавшие в «Спортивное оборудование»
 *
 *   План:     MONGO_URI=… [MONGO_DB=datacore] node scripts/fix-passport-categories.js
 *   Записать: … --apply
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const CHANGES = [
  // А) TRN → WRK: воркаут (турники, брусья, скамьи) и спортивное (баскетбол, волейбол, ворота)
  { numbers: [230, 287, 288, 298, 299, 300, 308, 318, 319, 320, 348, 383, 407, 474, 510, 511, 512, 552, 509, 549, 550], from: 'TRN', to: 'WRK', reason: 'воркаут/спортивное — ошибочно в TRN' },
  // Б) TRN → BLG: благоустройство
  { numbers: [283, 356, 489], from: 'TRN', to: 'BLG', reason: 'благоустройство (урна, стела, калитка) — ошибочно в TRN' },
  // В) WRK → TRN: уличные тренажёры («Спортивное оборудование» + «Тренажёр» в названии)
  { numbers: [247, 248, 249, 250, 265, 284, 286, 332, 475, 477], from: 'WRK', to: 'TRN', reason: 'уличный тренажёр — ошибочно в WRK' },
];

(async () => {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/?replicaSet=rs0';
  const cl = await MongoClient.connect(uri);
  try {
    const db = cl.db(process.env.MONGO_DB || 'datacore');
    const pp = db.collection('productpassports');
    const now = new Date();

    console.log(`${apply ? '== ЗАПИСЬ ==' : '== ПЛАН (ничего не пишем) =='}`);
    let totalPlan = 0, totalDone = 0;

    for (const g of CHANGES) {
      const nums = g.numbers.map(String);
      const docs = await pp.find(
        { passportNumber: { $in: nums }, passportCategory: g.from, deletedAt: null },
        { projection: { passportNumber: 1, passportCategory: 1 } }
      ).toArray();

      const notFound = nums.filter((n) => !docs.find((d) => d.passportNumber === n));
      const wrongCat = await pp.find(
        { passportNumber: { $in: nums }, passportCategory: { $ne: g.from }, deletedAt: null },
        { projection: { passportNumber: 1, passportCategory: 1 } }
      ).toArray();

      console.log(`\n${g.from} → ${g.to} (${g.reason}):`);
      console.log(`  Найдено с нужной категорией: ${docs.length} — ${docs.map((d) => d.passportNumber).join(', ') || 'нет'}`);
      if (wrongCat.length) console.log(`  Уже другая категория: ${wrongCat.map((d) => `${d.passportNumber}(${d.passportCategory})`).join(', ')}`);
      if (notFound.length) console.log(`  Не найдено / уже удалены: ${notFound.join(', ')}`);
      totalPlan += docs.length;

      if (apply && docs.length) {
        const ids = docs.map((d) => d._id);
        const r = await pp.updateMany(
          { _id: { $in: ids } },
          { $set: { passportCategory: g.to, updatedAt: now } }
        );
        totalDone += r.modifiedCount;
        console.log(`  → Записано: ${r.modifiedCount}`);
      }
    }

    console.log(`\nИтого: ${apply ? `записано ${totalDone}` : `будет изменено ${totalPlan}`} паспортов`);
    if (!apply) console.log('Для записи добавьте флаг --apply');
  } finally {
    await cl.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
