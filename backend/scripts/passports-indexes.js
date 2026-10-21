/* Индексы паспортов (TASKS ПС.1) — миграция для базы, где autoIndex выключен (прод). НА ПРОДЕ — только после «да» пользователя
 * и backup.sh. kppdf читает ту же коллекцию: снимается только уникальность productId (паспорт = экземпляр, на модель их много).
 *
 *   План (по умолчанию, ничего не меняет):  MONGO_URI=… [MONGO_DB=…] node scripts/passports-indexes.js
 *   Применить:                             … --apply
 *   Откат (вернуть unique productId — только если дублей productId нет): … --rollback [--apply]
 *
 * Что делает --apply: productId_1 (unique) → productId_1 (обычный); создаёт passportNumber_unique, productCode_unique
 * (частичный: без помеченных дублей productCodeDuplicate=true), warrantyCode_unique. Перед этим проверяет дубли —
 * если есть, ничего не меняет и печатает их. */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const has = (k) => process.argv.includes(k);
const apply = has('--apply');
const WANT = [
  { key: { passportNumber: 1 }, name: 'passportNumber_unique', unique: true },
  { key: { productCode: 1 }, name: 'productCode_unique', unique: true, partialFilterExpression: { productCodeDuplicate: { $eq: false }, productCode: { $type: 'string' } } },
  { key: { warrantyCode: 1 }, name: 'warrantyCode_unique', unique: true, partialFilterExpression: { warrantyCode: { $type: 'string' } } },
];

async function dups(c, field, extra = {}) {
  return c.aggregate([{ $match: { [field]: { $type: 'string' }, ...extra } }, { $group: { _id: `$${field}`, n: { $sum: 1 }, nos: { $push: '$passportNumber' } } }, { $match: { n: { $gt: 1 } } }]).toArray();
}

(async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const client = await MongoClient.connect(uri);
  const db = client.db(process.env.MONGO_DB || undefined);
  const c = db.collection('productpassports');
  const idx = await c.indexes().catch(() => []);
  console.log(`База ${db.databaseName}: паспортов ${await c.countDocuments()}; индексы: ${idx.map((i) => `${i.name}${i.unique ? '(unique)' : ''}`).join(', ') || '—'}`);
  if (has('--rollback')) {
    const d = await c.aggregate([{ $match: { productId: { $ne: null } } }, { $group: { _id: '$productId', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]).toArray();
    if (d.length) { console.log(`Откат невозможен: у ${d.length} моделей больше одного паспорта`); return client.close(); }
    console.log(apply ? 'Возвращаю productId_1 unique' : 'План отката: productId_1 → unique (dry-run)');
    if (apply) { if (idx.some((i) => i.name === 'productId_1')) await c.dropIndex('productId_1'); await c.createIndex({ productId: 1 }, { name: 'productId_1', unique: true }); }
    return client.close();
  }
  const conflicts = {
    passportNumber: await dups(c, 'passportNumber'),
    productCode: await dups(c, 'productCode', { productCodeDuplicate: false }),
    warrantyCode: await dups(c, 'warrantyCode'),
  };
  const bad = Object.entries(conflicts).filter(([, v]) => v.length);
  for (const [f, v] of bad) console.log(`  дубли ${f}: ${v.map((x) => `${x._id} (паспорта ${x.nos.join(', ')})`).join('; ')}`);
  const plan = [];
  const pid = idx.find((i) => i.name === 'productId_1');
  if (pid?.unique) plan.push('снять unique с productId_1 (пересоздать обычным)');
  for (const w of WANT) if (!idx.some((i) => i.name === w.name)) plan.push(`создать ${w.name}`);
  console.log(plan.length ? `План:\n  - ${plan.join('\n  - ')}` : 'Всё уже на месте');
  if (!apply) { console.log('dry-run — ничего не изменено'); return client.close(); }
  if (bad.length) { console.log('Есть дубли — индексы не создаю. Сначала решить дубли (пометить productCodeDuplicate или исправить по «да»).'); return client.close(); }
  if (pid?.unique) { await c.dropIndex('productId_1'); await c.createIndex({ productId: 1 }, { name: 'productId_1' }); }
  for (const w of WANT) if (!idx.some((i) => i.name === w.name)) { const { key, ...o } = w; await c.createIndex(key, o); }
  console.log('Готово:', (await c.indexes()).map((i) => `${i.name}${i.unique ? '(unique)' : ''}`).join(', '));
  await client.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
