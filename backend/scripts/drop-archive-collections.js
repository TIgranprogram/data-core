/* Удаление архивных таблиц прежнего приложения (TASKS 7.2, решение пользователя 2026-10-20 — «хлам удаляй»).
 * Данные из них уже в рабочих таблицах (заявки → supplyrequests, склад → materials/storageitems, движения →
 * stockmovements, реестр счетов → даты счетов в заявках). Перед удалением каждая таблица выгружается в JSON
 * (папка OUT_DIR, по умолчанию /tmp/archive-export) — на всякий случай. По умолчанию — только отчёт; --apply — удалить.
 *   MONGO_URI=… node scripts/drop-archive-collections.js [--apply] */
const fs = require('fs');
const path = require('path');
const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;

const ARCHIVE = ['app_supply_requests', 'app_supply_invoices', 'app_warehouse_items', 'app_warehouse_movements', 'app_smokeshop_orders'];
(async () => {
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const apply = process.argv.includes('--apply');
  const out = process.env.OUT_DIR || '/tmp/archive-export';
  const c = await MongoClient.connect(process.env.MONGO_URI);
  const db = c.db(process.env.MONGO_DB || undefined);
  const have = new Set((await db.listCollections().toArray()).map((x) => x.name));
  fs.mkdirSync(out, { recursive: true });
  for (const name of ARCHIVE) {
    if (!have.has(name)) { console.log(`${name}: нет — пропуск`); continue; }
    const docs = await db.collection(name).find().toArray();
    const file = path.join(out, `${name}.json`);
    fs.writeFileSync(file, JSON.stringify(docs));
    console.log(`${name}: ${docs.length} записей → выгружено в ${file}${apply ? ', удаляю' : ''}`);
    if (apply) await db.collection(name).drop();
  }
  if (!apply) console.log('Это проверка. Удалить: --apply');
  await c.close();
})().catch((e) => { console.error(e.message); process.exit(1); });
