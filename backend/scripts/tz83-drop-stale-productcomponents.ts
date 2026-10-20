/**
 * TZ-83 Phase A cleanup script: drop stale `productcomponents` collection.
 *
 * Background:
 *   В TZ-83 Фазе A.2 удалена вся сущность `ProductComponent` (схема, модуль,
 *   сервис, контроллер). Но MongoDB-коллекция `productcomponents` могла уже
 *   содержать документы из dev/prod-окружений до рефактора. Mongoose их
 *   больше не видит (model не зарегистрирован), но место в БД расходуется
 *   и seed'ы / миграции могут наткнуться на старые orphan id.
 *
 * Safety / idempotency:
 *   - estimatedDocumentCount() сначала — no-op если коллекция пустая
 *   - drop() только при count > 0
 *   - disconnect в `finally` даже если drop упал
 *   - re-runnable: повторный запуск увидит 0 документов и выйдет чисто
 *
 * Запуск: из `backend/` → `pnpm ts-node scripts/tz83-drop-stale-productcomponents.ts`
 * Проверка без удаления: закомментируйте `await coll.drop()` строку.
 */
import { connect, disconnect, connection } from 'mongoose';
import configuration from '../src/config/configuration';

const TARGET_COLLECTION = 'productcomponents';

async function main(): Promise<void> {
  const cfg = configuration();
  // Review #1 (round-4 nit): env override названием `MONGO_URI` —
  // совпадает с каноническим ключом в src/config/configuration.ts:18
  // (NestJS runtime знает только это имя). Dev/ops не путаются.
  const uri = process.env.MONGO_URI ?? cfg.mongo.uri;
  // eslint-disable-next-line no-console
  console.log(`[tz83-cleanup] connecting to ${uri}`);

  try {
    // Review #3: connect() внутри try — единый failure-path с finally.
    await connect(uri);
    const db = connection.db;
    if (!db) throw new Error('No db connection after connect()');

    const collections = await db.listCollections().toArray();
    const exists = collections.some((c) => c.name === TARGET_COLLECTION);
    if (!exists) {
      // eslint-disable-next-line no-console
      console.log(`[tz83-cleanup] collection "${TARGET_COLLECTION}" does not exist — no-op`);
      return;
    }

    const coll = db.collection(TARGET_COLLECTION);
    const count = await coll.estimatedDocumentCount();
    if (count === 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[tz83-cleanup] collection "${TARGET_COLLECTION}" exists but is empty (0 docs) — no-op`,
      );
      return;
    }

    await coll.drop();
    // eslint-disable-next-line no-console
    console.log(
      `[tz83-cleanup] ✓ dropped "${TARGET_COLLECTION}" (${count} orphan documents removed)`,
    );
  } finally {
    await disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[tz83-cleanup] FAILED:', err);
  process.exitCode = 1;
});
