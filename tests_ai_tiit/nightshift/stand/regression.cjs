const assert = require('node:assert/strict');
const mongoose = require('/app/node_modules/mongoose');

async function main() {
  const db = process.env.MONGO_DB;
  const testDb = process.env.MONGO_DB_TEST;
  assert.match(db || '', /^datacore-[a-f0-9]{32}-night$/);
  assert.equal(testDb, db.replace('datacore-', 'datacore-test-'));
  assert.equal(process.env.MONGO_URI, `mongodb://mongo:27017/${db}?replicaSet=rs0`);
  // Ни URL, ни URI не принимаются извне: только внутренний app и mongo.
  for (const [path, expected] of [['/api/health/ready', 200], ['/api/stock/items', 401]]) {
    const response = await fetch(`http://127.0.0.1:3000${path}`, { redirect: 'error', signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, expected, `${path}: HTTP ${response.status}`);
    const body = await response.json();
    assert.ok(body && typeof body === 'object', `${path}: JSON response`);
    if (path.endsWith('/ready')) assert.ok(body.status === 'ok', 'Mongo readiness');
    console.log(`CHECK ${path}: ${expected}`);
  }
  await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  try {
    assert.equal(mongoose.connection.name, db);
    const ping = await mongoose.connection.db.command({ ping: 1 });
    assert.equal(ping.ok, 1);
    const collections = await mongoose.connection.db.listCollections({}, { nameOnly: true }).toArray();
    assert.ok(collections.length > 0, 'DataCore seed/restored collections exist');
    console.log(`CHECK Mongo target/ping: ${collections.length} collections; read-only`);
  } finally {
    await mongoose.disconnect();
  }
}
main().catch(error => { console.error(`APP_FAILURE: ${error.message}`); process.exitCode = 1; });
