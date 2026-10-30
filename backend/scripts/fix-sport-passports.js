/* ПЧ-1, ответ пользователя 2026-10-30: баскетбол, волейбол и другие спортивные игры — не «Воркаут», а «Спортивное оборудование».
 * Код категории WRK не меняется: у обеих групп один раздел паспорта, отличается название в карточке и галерее.
 *   План:     MONGO_URI=… [MONGO_DB=datacore] node scripts/fix-sport-passports.js
 *   Записать: … --apply
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const NAME = 'Спортивное оборудование';
const GAMES = /баскет|стритбол|волейб|теннис|футбол|гандбол|мини-футбол|ворота/i;

(async () => {
  const apply = process.argv.includes('--apply');
  const cl = await MongoClient.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/?replicaSet=rs0');
  try {
    const pp = cl.db(process.env.MONGO_DB || 'datacore').collection('productpassports');
    const docs = (await pp.find({ passportCategory: 'WRK', deletedAt: null, category: { $ne: NAME } }, { projection: { passportNumber: 1, name: 1, category: 1 } }).toArray())
      .filter((d) => GAMES.test(d.name || ''));
    console.log(`${apply ? '== ЗАПИСЬ ==' : '== ПЛАН (ничего не пишем) =='} → «${NAME}»: ${docs.length}`);
    for (const d of docs) console.log(`  №${d.passportNumber} ${d.name} (было «${d.category || ''}»)`);
    if (apply && docs.length) {
      const r = await pp.updateMany({ _id: { $in: docs.map((d) => d._id) } }, { $set: { category: NAME, updatedAt: new Date() } });
      console.log(`Записано: ${r.modifiedCount}`);
    }
  } finally {
    await cl.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
