/* C155: только productpassports.creationScopeKey_1. План — без аргументов, создание — с --apply.
 * Запускается в контейнере, в том числе через stdin: remote-access/run-script.sh passport-creation-index [--apply].
 */
const COLLECTION = 'productpassports';
const NAME = 'creationScopeKey_1';
const KEY = { creationScopeKey: 1 };
const OPTIONS = { name: NAME, unique: true, sparse: true };
const DATABASES = new Set(['datacore', 'datacore-night', 'datacore-test']);

class PassportIndexError extends Error {}

function databaseName(env) {
  if (!DATABASES.has(env.MONGO_DB) && !/^datacore-[a-f0-9]{24}-night$/.test(env.MONGO_DB || '')) {
    throw new PassportIndexError('MONGO_DB должен быть datacore, datacore-test или собственной night-копией');
  }
  return env.MONGO_DB;
}

const sameKey = (index) => index.key?.creationScopeKey === 1 && Object.keys(index.key).length === 1;
const compatible = (index) => index.name === NAME && sameKey(index)
  && index.unique === true && index.sparse === true
  && index.partialFilterExpression === undefined && index.expireAfterSeconds === undefined
  && (!index.collation || index.collation.locale === 'simple') && index.hidden !== true;

async function indexStatus(collection) {
  const indexes = await collection.indexes().catch((error) => {
    if (error.code === 26) throw new PassportIndexError('Коллекция productpassports отсутствует, создание остановлено');
    throw error;
  });
  if (!indexes.length) throw new PassportIndexError('У коллекции productpassports нет индексов, создание остановлено');
  const related = indexes.filter((index) => index.name === NAME || sameKey(index));
  if (!related.length) return 'missing';
  if (related.length === 1 && compatible(related[0])) return 'ready';
  throw new PassportIndexError('Есть несовместимый индекс с тем же именем или ключом, требуется отдельная проверка');
}

async function ensurePassportCreationIndex(db, apply = false) {
  const collection = db.collection(COLLECTION);
  const before = await indexStatus(collection);
  if (before === 'ready' || !apply) return before;
  await collection.createIndex(KEY, OPTIONS);
  if (await indexStatus(collection) !== 'ready') throw new PassportIndexError('Создание завершилось без подтверждения индекса');
  return 'created';
}

async function main(args, env) {
  if (args.length > 1 || (args.length && args[0] !== '--apply')) throw new PassportIndexError('Аргумент: только --apply');
  const database = databaseName(env);
  if (!env.MONGO_URI) throw new PassportIndexError('MONGO_URI не задан в контейнере');
  const { MongoClient } = require('mongoose').mongo;
  const client = new MongoClient(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
    const state = await ensurePassportCreationIndex(client.db(database), args[0] === '--apply');
    const message = {
      missing: 'план — создать unique sparse индекс по { creationScopeKey: 1 }',
      created: 'индекс создан и проверен',
      ready: 'индекс уже установлен и соответствует схеме',
    };
    console.log(`${database}.${COLLECTION}.${NAME} — ${message[state]}`);
  } finally {
    await client.close();
  }
}

if (require.main === module || process.argv[1] === '-') {
  main(process.argv.slice(2), process.env).catch((error) => {
    const reason = error instanceof PassportIndexError ? error.message
      : Number.isInteger(error?.code) ? `ошибка MongoDB, код ${error.code}` : 'не удалось проверить или создать индекс MongoDB';
    // Драйвер может включить URI или значение ключа в ошибку. Выводим только безопасную причину.
    console.error(`СТОП — ${reason}`);
    process.exitCode = 1;
  });
}

module.exports = { databaseName, ensurePassportCreationIndex };
