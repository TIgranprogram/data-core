// Проверка совместимости бэкенда с MongoDB 4.4 (VM без AVX не тянет 5.0+).
//
// Зачем: прод-контур data-core придётся поднять на mongo:4.4 (тот же хост,
// что и kppdf). Перед решением проверяем, что mongoose 8.3 умеет всё, что нам
// нужно: connect + CRUD + транзакции (rs0) + listCollections (админ-страница
// «Таблицы») + createIndex (миграции).
//
// Запуск (из образа бэкенда, где уже есть mongoose):
//   docker run --rm --network dc44-net \
//     -v backend/scripts/test-mongoose-compat.js:/tmp/test.js:ro \
//     -e MONGO_URI='mongodb://user:pass@mongo:27017/datacore?replicaSet=rs0&authSource=datacore' \
//     --entrypoint node data-core-backend /tmp/test.js
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI is required');

  await mongoose.connect(uri);
  const build = await mongoose.connection.db.admin().command({ buildInfo: 1 });
  console.log('1. connect OK, server=' + build.version);

  const coll = mongoose.connection.db.collection('compat_test');

  // CRUD
  await coll.deleteMany({});
  const ins = await coll.insertOne({ name: 'probe', n: 1, at: new Date() });
  const doc = await coll.findOne({ _id: ins.insertedId });
  if (!doc || doc.name !== 'probe') throw new Error('CRUD read-back failed');
  console.log('2. CRUD OK');

  // Транзакция (rs0) — самое хрупкое место на старых версиях
  const session = mongoose.connection.getClient().startSession();
  session.startTransaction();
  await coll.insertOne({ name: 'tx-doc' }, { session });
  await session.commitTransaction();
  session.endSession();
  const txDoc = await coll.findOne({ name: 'tx-doc' });
  if (!txDoc) throw new Error('transaction did not commit');
  console.log('3. transaction OK');

  // listCollections (это делает GET /api/admin/collections)
  const cols = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
  if (!Array.isArray(cols)) throw new Error('listCollections failed');
  console.log('4. listCollections OK (' + cols.length + ' collections)');

  // createIndex (это делают миграции + autoIndex)
  await coll.createIndex({ name: 1 }, { background: true });
  const idx = await coll.indexes();
  console.log('5. createIndex OK (' + idx.length + ' indexes)');

  // estimatedDocumentCount (счётчики в админке)
  const cnt = await coll.estimatedDocumentCount();
  console.log('6. estimatedDocumentCount OK (' + cnt + ')');

  await coll.drop();
  await mongoose.disconnect();
  console.log('ALL COMPAT CHECKS PASSED on mongoose ' + mongoose.version);
}

main().catch((e) => {
  console.error('COMPAT FAILED:', e.message);
  process.exit(1);
});
