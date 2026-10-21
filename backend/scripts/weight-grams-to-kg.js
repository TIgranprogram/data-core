/* Вес 1 шт.: граммы, записанные в поле «кг», → килограммы (TASKS НО.0). ТОЛЬКО ОТЧЁТ (dry-run).
 * Синхронизация листа «Склад» писала «Вес 1 шт.» (граммы: 8; 16,5; 49) прямо в `weightKg` — гайка M10 = «10».
 * Приложение с 2026-10-21 читает такие записи (без пометки `weightUnit: 'kg'`) как граммы (`stock/weight.ts weightGOf`),
 * поэтому до миграции всё показывается верно. Миграция приводит их к общей записи: weightKg = значение ÷ 1000 + пометка
 * (materials и storageitems) — тогда и CRM видит настоящие килограммы. Применение — после «да» пользователя и свежего
 * бэкапа, отдельным шагом (с --apply скрипт откажется работать).
 *   MONGO_URI=… [MONGO_DB=…] node scripts/weight-grams-to-kg.js */
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

(async () => {
  if (process.argv.includes('--apply')) { console.error('Только отчёт. Применение — после «да» пользователя и бэкапа.'); process.exit(2); }
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const legacy = { deletedAt: null, weightKg: { $gt: 0 }, weightUnit: { $ne: 'kg' } };
  const mats = await db.collection('materials').find(legacy, { projection: { name: 1, unit: 1, weightKg: 1 } }).sort({ name: 1 }).toArray();
  const st = await db.collection('storageitems').countDocuments(legacy);
  const done = await db.collection('materials').countDocuments({ deletedAt: null, weightUnit: 'kg' });
  console.log(`К переводу г -> кг: позиций ${mats.length}, строк остатка ${st}; уже в кг (с пометкой): ${done}`);
  console.log('');
  console.log('Позиция | ед. | сейчас weightKg (г) | станет weightKg (кг) + weightUnit kg | в интерфейсе (не меняется)');
  for (const m of mats) console.log(`${m.name} | ${m.unit} | ${m.weightKg} | ${m.weightKg / 1000} | ${m.weightKg} г`);
  console.log('');
  console.log('Ничего не изменено (dry-run).');
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
