/* Пары болтов «… M10х100, DIN 933» и «… M10х100, кп 8.8, DIN 933» — одно и то же (пользователь 2026-10-30): две строки старой таблицы «Склад».
 * Остаётся позиция с «кп 8.8»: к ней прибавляется остаток второй, переходят движения, заявки и цены; вторая уходит в корзину. Всё в одной транзакции.
 * Пара пропускается, если у лишней позиции есть бронь или она в составе изделия / в CRM.
 *   План:     bash remote-access/run-script.sh stock-dedupe-bolts
 *   Записать: bash remote-access/run-script.sh stock-dedupe-bolts --apply
 */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
const { isUsedInComposition, isUsedByCrm } = require('/app/dist/src/common/catalog/catalog-references.js');

(async () => {
  const apply = process.argv.includes('--apply');
  const cl = await MongoClient.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/?replicaSet=rs0');
  try {
    const db = cl.db(process.env.MONGO_DB || 'datacore');
    const mats = db.collection('materials'), storage = db.collection('storageitems'), reqs = db.collection('supplyrequests');
    const REFS = ['stockmovements', 'supplyrequests', 'materialprices', 'supplieritems'];
    const graded = await mats.find({ deletedAt: null, name: /, кп 8\.8, DIN 933\s*$/i }, { projection: { name: 1 } }).toArray();
    console.log(`${apply ? '== ЗАПИСЬ ==' : '== ПЛАН (ничего не пишем) =='} позиций с «кп 8.8»: ${graded.length}`);
    let done = 0;
    for (const keep of graded) {
      const plain = keep.name.replace(/, кп 8\.8,/i, ',');
      const extra = await mats.findOne({ deletedAt: null, name: plain });
      if (!extra) continue;
      const stock = await storage.find({ materialId: extra._id, deletedAt: null }).toArray();
      const qty = stock.reduce((s, x) => s + (x.quantity || 0), 0), held = stock.reduce((s, x) => s + (x.reservedQty || 0), 0);
      const used = (await isUsedInComposition(db, 'material', extra._id)) || (await isUsedByCrm(db, 'material', extra._id));
      const open = await reqs.find({ deletedAt: null, status: { $nin: ['received', 'cancelled'] }, $or: [{ materialId: extra._id }, { title: plain }] }, { projection: { num: 1 } }).toArray();
      if (held || used) { console.log(`  ПРОПУСК «${plain}»: бронь ${held}, в составе/CRM: ${used ? 'да' : 'нет'}`); continue; }
      const rows = await storage.find({ materialId: keep._id, deletedAt: null }).toArray();
      if (rows.length !== 1 || stock.length > 1) { console.log(`  ПРОПУСК «${plain}»: строк остатка у позиций ${rows.length} и ${stock.length}, нужно по одной`); continue; }
      console.log(`  «${plain}» (${qty}) → «${keep.name}» (${rows[0].quantity || 0}), станет ${(rows[0].quantity || 0) + qty}; открытые заявки: ${open.map((r) => '№' + r.num).join(', ') || 'нет'}`);
      if (!apply) continue;
      const now = new Date();
      const session = cl.startSession();
      try {
        await session.withTransaction(async () => {
          const o = { session };
          for (const c of REFS) await db.collection(c).updateMany({ materialId: extra._id }, { $set: { materialId: keep._id } }, o);
          if (open.length) await reqs.updateMany({ _id: { $in: open.map((r) => r._id) } }, { $set: { title: keep.name, updatedAt: now } }, o);
          await storage.updateOne({ _id: rows[0]._id }, { $inc: { quantity: qty }, $set: { updatedAt: now } }, o);
          await storage.updateMany({ materialId: extra._id, deletedAt: null }, { $set: { quantity: 0, deletedAt: now } }, o);
          await mats.updateOne({ _id: extra._id }, { $set: { deletedAt: now, editedInApp: true, mergedInto: keep._id, updatedAt: now } }, o);
        });
      } finally { await session.endSession(); }
      done++;
    }
    console.log(apply ? `Готово: объединено ${done}` : 'Для записи добавьте --apply');
  } finally {
    await cl.close();
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
