/* C057-Э0: общее для скриптов c057-*.js — аргументы, чтение выгрузки или базы, запись планов/отчётов, подключение к Mongo.
 *
 *   План по выгрузке (без базы):  node scripts/c057-kind.js --from <папка с materials.json, categories.json, products.json>
 *   План по базе (только чтение): MONGO_URI=… MONGO_DB=… node scripts/c057-kind.js
 *   Запись:                       … --apply [--out файл-для-отката.json]   (только MONGO_URI + MONGO_DB; с --from нельзя)
 * Планы пишутся в docs/crew/C057-pdm-import/data/ (--data-dir другая папка). Прод — только координатор, после «да» и бэкапа. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', '..', 'docs', 'crew', 'C057-pdm-import', 'data');

function args(argv = process.argv.slice(2)) {
  const a = { apply: false, from: null, out: null, dataDir: DATA_DIR, rest: [] };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === '--apply') a.apply = true;
    else if (x === '--from') a.from = argv[++i];
    else if (x === '--out') a.out = argv[++i];
    else if (x === '--data-dir') a.dataDir = argv[++i];
    else a.rest.push(x);
  }
  if (a.apply && a.from) { console.error('--apply нельзя вместе с --from: запись идёт только в базу (MONGO_URI + MONGO_DB).'); process.exit(2); }
  return a;
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const idOf = (v) => (v && typeof v === 'object' && v._id != null ? String(v._id) : v != null ? String(v) : null);

/** Нормализованная позиция: id (строка), catName/catPath, прочие поля как в базе. */
function normalize(m, cats) {
  const cid = idOf(m.categoryId);
  const c = (m.categoryId && typeof m.categoryId === 'object' && m.categoryId.name ? m.categoryId : cats.get(cid)) || null;
  return { ...m, id: String(m._id), categoryKey: cid, catName: c ? c.name : '', catPath: c ? (c.fullPath || c.name) : '' };
}

function connectMongo() {
  const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..', '..')] })).mongo;
  if (!process.env.MONGO_URI) { console.error('Нужен MONGO_URI (и MONGO_DB), либо --from <папка выгрузки>'); process.exit(2); }
  return MongoClient.connect(process.env.MONGO_URI);
}

/** Загрузка данных: из выгрузки (--from) или из базы (только чтение). Возвращает { materials, categories, products, db, client }. */
async function load(a, { products = false } = {}) {
  if (a.from) {
    const cats = readJson(path.join(a.from, 'categories.json'));
    const catMap = new Map(cats.map((c) => [String(c._id), c]));
    const raw = readJson(path.join(a.from, 'materials.json'));
    const prods = products && fs.existsSync(path.join(a.from, 'products.json')) ? readJson(path.join(a.from, 'products.json')) : [];
    return { source: `выгрузка прода (${path.basename(path.resolve(a.from))})`, materials: raw.filter((m) => !m.deletedAt).map((m) => normalize(m, catMap)), categories: cats, products: prods, db: null, client: null };
  }
  const client = await connectMongo();
  const db = client.db(process.env.MONGO_DB || undefined);
  const cats = await db.collection('categories').find({}).toArray();
  const catMap = new Map(cats.map((c) => [String(c._id), c]));
  const raw = await db.collection('materials').find({ $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }).toArray();
  const prods = products ? await db.collection('products').find({}, { projection: { name: 1, sku: 1, composition: 1 } }).toArray() : [];
  return { source: `база ${db.databaseName}`, materials: raw.map((m) => normalize(m, catMap)), categories: cats, products: prods, db, client };
}

/** Записать план: json (для --apply) и md (для человека) в папку данных. */
function writePlan(a, base, plan, md) {
  fs.mkdirSync(a.dataDir, { recursive: true });
  const j = path.join(a.dataDir, `${base}.json`), m = path.join(a.dataDir, `${base}.md`);
  fs.writeFileSync(j, JSON.stringify(plan, null, 1));
  fs.writeFileSync(m, md);
  return { json: j, md: m };
}

/** Сохранить выгрузку «было» для отката (--out или во временную папку). */
function writeRollback(a, name, data) {
  const f = a.out || path.join(os.tmpdir(), `${name}-rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(f, JSON.stringify(data, null, 1));
  return f;
}

/** Таблица markdown из строк-массивов. */
function table(head, rows) {
  const esc = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '--').join('|')}|`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}

const today = () => new Date().toISOString().slice(0, 10);

module.exports = { args, load, writePlan, writeRollback, table, today, DATA_DIR, idOf };
