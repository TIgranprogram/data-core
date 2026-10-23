/* НМ (2026-10-23, «да» пользователя): все существующие паспорта с номером → статус «Выпущен» (status: 'issued').
 * Номера, тексты (textSnapshot), категории и прочие поля НЕ меняются; паспорта в корзине остаются в корзине.
 * Дата выпуска — когда скачан PDF, иначе когда создан, иначе дата паспорта. Счётчик номеров — проверка: не меньше максимума.
 *
 *   План:      MONGO_URI=… [MONGO_DB=…] node scripts/migrate-passport-status.js
 *   Записать:  … --apply
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

(async () => {
  const apply = process.argv.includes('--apply');
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const pp = db.collection('productpassports');
  const filter = { status: { $exists: false }, passportNumber: { $nin: [null, ''] } };
  const docs = await pp.find(filter, { projection: { passportNumber: 1, pdfIssuedAt: 1, createdAt: 1, date: 1, deletedAt: 1 } }).toArray();
  const noNumber = await pp.countDocuments({ status: { $exists: false }, passportNumber: { $in: [null, ''] } });
  const nums = (await pp.find({}, { projection: { passportNumber: 1 } }).toArray()).map((d) => Number(d.passportNumber)).filter(Number.isFinite);
  const max = nums.length ? Math.max(...nums) : 0;
  const counter = await db.collection('counters').findOne({ entity: 'passport', prefix: 'passportNumber', year: 0 });
  console.log(`${apply ? 'ЗАПИСЬ' : 'ПЛАН (ничего не пишем)'}: «Выпущен» получат ${docs.length} (из них в корзине ${docs.filter((d) => d.deletedAt).length}); без номера и статуса — ${noNumber} (не трогаем)`);
  console.log(`Максимальный номер ${max}; счётчик ${counter?.seq ?? 'нет'} → следующий выпуск получит ${Math.max(Number(counter?.seq ?? 0), max) + 1}`);
  if (apply && docs.length) {
    let n = 0;
    for (const d of docs) {
      const r = await pp.updateOne({ _id: d._id, status: { $exists: false } }, { $set: { status: 'issued', issuedAt: d.pdfIssuedAt || d.createdAt || d.date || new Date(), revision: 1 } });
      n += r.modifiedCount;
    }
    console.log(`Записано: ${n}`);
  }
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
