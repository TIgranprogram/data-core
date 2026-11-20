/* C169: план по умолчанию. --apply создаёт только перечисленные индексы, без удаления и правки документов. */
const SPECS = [
  { collection: 'photos', field: 'intakeUid', name: 'c169_photo_intake_uid', unique: true },
  { collection: 'supplyinvoices', field: 'intakeUid', name: 'c169_supply_invoice_uid', unique: true },
  { collection: 'supplyinvoices', field: 'intakeBusinessKey', name: 'c169_supply_invoice_business', unique: true },
  { collection: 'supplyinvoices', field: 'intakeSourceSha256', name: 'c169_supply_invoice_sha', unique: true },
  { collection: 'supplyinvoices', field: 'fileIds', name: 'fileIds_1', unique: false },
];

const ALLOWED_DATABASE = /^(datacore|datacore-test(?:-[a-z0-9-]+)?)$/;
const simpleCollation = { locale: 'simple' };
const sameKey = (index, spec) => Object.keys(index.key).length === 1 && index.key[spec.field] === 1;

function compatible(index, spec) {
  return index.name === spec.name && sameKey(index, spec) && (index.unique === true) === spec.unique
    && index.sparse === true && !index.partialFilterExpression && !index.hidden
    && index.expireAfterSeconds === undefined && (!index.collation || index.collation.locale === 'simple');
}

class IntakeIndexError extends Error {
  constructor(message, name) {
    super(name ? `${name}: ${message}` : message);
  }
}

async function listIndexes(collection) {
  try {
    return await collection.indexes();
  } catch (error) {
    if (error.code === 26) return [];
    throw error;
  }
}

async function assertClean(collection, spec) {
  const found = await collection.aggregate([
    { $match: { [spec.field]: { $exists: true } } },
    { $group: { _id: `$${spec.field}`, type: { $first: { $type: `$${spec.field}` } }, count: { $sum: 1 } } },
    { $match: { $or: [{ count: { $gt: 1 } }, { type: { $ne: 'string' } }] } },
    { $limit: 1 },
    { $project: { _id: 0, count: 1 } },
  ], { collation: simpleCollation }).toArray();
  if (found.length) throw new IntakeIndexError('есть дубли или ключи не строкового типа', spec.name);
}

async function plan(db) {
  const byCollection = new Map();
  const result = [];
  for (const spec of SPECS) {
    const collection = db.collection(spec.collection);
    if (!byCollection.has(spec.collection)) byCollection.set(spec.collection, await listIndexes(collection));
    const related = byCollection.get(spec.collection).filter(index => index.name === spec.name || sameKey(index, spec));
    if (related.length && (related.length !== 1 || !compatible(related[0], spec))) {
      throw new IntakeIndexError('существует несовместимый индекс', spec.name);
    }
    if (spec.unique) await assertClean(collection, spec);
    result.push({ spec, state: related.length ? 'ready' : 'missing' });
  }
  return result;
}

async function ensure(db, apply = false) {
  const before = await plan(db);
  if (apply) {
    for (const { spec, state } of before) {
      if (state !== 'missing') continue;
      await db.collection(spec.collection).createIndex({ [spec.field]: 1 }, {
        name: spec.name, sparse: true, ...(spec.unique ? { unique: true } : {}), collation: simpleCollation,
      });
    }
    if ((await plan(db)).some(index => index.state !== 'ready')) throw new IntakeIndexError('индексы не прошли итоговую проверку');
  }
  return before.map(({ spec, state }) => ({
    collection: spec.collection, name: spec.name, state: apply && state === 'missing' ? 'created' : state,
  }));
}

async function main(args, env) {
  if (args.length > 1 || (args.length === 1 && args[0] !== '--apply')) throw new IntakeIndexError('допустим только флаг --apply');
  if (!ALLOWED_DATABASE.test(env.MONGO_DB || '') || !env.MONGO_URI) throw new IntakeIndexError('требуются MONGO_URI и явное имя базы data-core');
  const { MongoClient } = require('mongoose').mongo;
  const client = new MongoClient(env.MONGO_URI, { serverSelectionTimeoutMS: 5_000 });
  try {
    await client.connect();
    const apply = args[0] === '--apply';
    const indexes = await ensure(client.db(env.MONGO_DB), apply);
    console.log(JSON.stringify({ apply, indexes }));
  } finally {
    await client.close();
  }
}

if (require.main === module || process.argv[1] === '-') {
  main(process.argv.slice(2), process.env).catch(error => {
    const reason = error instanceof IntakeIndexError ? error.message : 'операция индексации не выполнена';
    console.error('Стоп C169. ' + reason);
    process.exitCode = 1;
  });
}

module.exports = { SPECS, compatible, ensure };
