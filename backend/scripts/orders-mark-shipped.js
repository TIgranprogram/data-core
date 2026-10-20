/* Разовая правка после загрузки заказов из Excel (TASKS З.3): в файлах нет этапа, все заказы пришли «Новый».
 * Заказ «Новый» с датой отгрузки раньше сегодняшней считаем отгруженным (stage → shipped).
 * По умолчанию — только отчёт; --apply — применить. MONGO_URI, MONGO_DB (как import-orders-xlsx.js).
 *   node backend/scripts/orders-mark-shipped.js [--apply] */
const { MongoClient } = require('mongoose').mongo;

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('Нужен MONGO_URI'); process.exit(1); }
  const apply = process.argv.includes('--apply');
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || undefined);
  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const filter = { stage: 'new', deletedAt: null, shipDate: { $lt: today } };
  const list = await db.collection('salesorders').find(filter, { projection: { orderNo: 1, customer: 1, shipDate: 1 } }).sort({ shipDate: 1 }).toArray();
  console.log(`База: ${db.databaseName}. «Новый» с прошедшей датой отгрузки: ${list.length}`);
  for (const o of list) console.log(`  № ${o.orderNo} · ${o.customer || ''} · отгрузка ${o.shipDate.toISOString().slice(0, 10)}`);
  if (apply && list.length) {
    const r = await db.collection('salesorders').updateMany(filter, { $set: { stage: 'shipped', updatedAt: new Date() } });
    console.log(`Применено: ${r.modifiedCount} → «Отгружен»`);
  } else if (!apply) console.log('Это проверка. Применить: --apply');
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
