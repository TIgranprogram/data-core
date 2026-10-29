/* Скорость С6 (2026-10-22): на проде autoIndex выключен — индексы, описанные в схемах позже первой выкладки, не созданы
 * (incomes, photos, auditlogs — только _id). Скрипт только СОЗДАЁТ недостающие индексы своих коллекций; ничего не удаляет
 * (syncIndexes не используем: он удалил бы индексы CRM на общих коллекциях).
 *
 * Внутри контейнера backend:
 *   docker cp backend/scripts/ensure-indexes.js datacore-backend:/app/scripts/
 *   План:      docker exec datacore-backend node scripts/ensure-indexes.js
 *   Создать:   docker exec datacore-backend node scripts/ensure-indexes.js --apply
 */
const path = require('path');
const root = path.join(__dirname, '..');
const { NestFactory } = require(require.resolve('@nestjs/core', { paths: [root] }));
const { getConnectionToken } = require(require.resolve('@nestjs/mongoose', { paths: [root] }));

/** Модели data-core (коллекции, которые пишет data-core): индексы — из их схем. */
const MODELS = ['Income', 'SalesOrder', 'Shipment', 'DesignTask', 'DesignOrder', 'DesignSticker', 'DesignNote', 'ProductPassport', 'Photo', 'AuditLog', 'ClientError', 'SupplierItem', 'SupplyRequest', 'SupplyInvoice', 'MaterialPrice', 'Notification', 'Message', 'ProductAlias'];
/** Индексы без схемы (коллекции читаются напрямую): частые запросы. */
const RAW = [
  ['photos', { parentPhotoId: 1, variant: 1 }],
  ['payroll_timesheets', { personId: 1, month: 1 }, { unique: true }], // ФОТ: один табель на сотрудника и месяц
  ['payroll_payments', { month: 1, deletedAt: 1 }], // ФОТ: выплаты месяца
  ['payroll_payments', { date: 1 }], // ФОТ: выплаты периода
  ['finance_settings', { key: 1 }, { unique: true }], // Старт учёта
  ['dict_values', { dict: 1, deletedAt: 1 }],
  ['reservations', { salesOrderId: 1 }, { sparse: true }], // SK-6: брони заказа
  ['stockmovements', { salesOrderId: 1 }, { sparse: true }], // SK-5: выдано по заказу (lines-lookup)
  ['stockmovements', { salesOrderLineId: 1 }, { sparse: true }], // SK-7: состав изделия из выдач под позицию
  ['materials', { 'passportSpec.materialId': 1 }, { sparse: true }], // МЦ-2: позиции склада по материалу паспорта
];

(async () => {
  const apply = process.argv.includes('--apply');
  const { AppModule } = require(path.join(root, 'dist/src/app.module'));
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const conn = app.get(getConnectionToken());
    console.log(apply ? 'СОЗДАНИЕ' : 'ПЛАН, ничего не меняется');
    for (const name of MODELS) {
      const m = conn.models[name];
      if (!m) { console.log(`  ${name}: модели нет — пропуск`); continue; }
      const { toCreate } = await m.diffIndexes();
      console.log(`  ${m.collection.name}: недостаёт ${toCreate.length}${toCreate.length ? ' — ' + toCreate.map((x) => JSON.stringify(x)).join(', ') : ''}`);
      if (apply && toCreate.length) await m.createIndexes().catch((e) => console.log(`    ошибка: ${e.message}`));
    }
    for (const [coll, key, opts] of RAW) {
      const have = (await conn.collection(coll).indexes().catch(() => [])).some((i) => JSON.stringify(i.key) === JSON.stringify(key));
      console.log(`  ${coll} ${JSON.stringify(key)}: ${have ? 'есть' : 'недостаёт'}`);
      if (apply && !have) await conn.collection(coll).createIndex(key, opts || {}).catch((e) => console.log(`    ошибка: ${e.message}`));
    }
  } finally { await app.close(); }
})().catch((e) => { console.error(e.message); process.exit(1); });
