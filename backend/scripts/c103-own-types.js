#!/usr/bin/env node
/**
 * C103: «свой» тип паспорта у изделия (`products.passportDefaults.passportCategory`), совпадающий с типом группы
 * (своим у группы или у её раздела), — снять: тип берётся из группы, двусмыслицы нет. Несовпадающие НЕ трогаем —
 * только список (это изделие в чужой группе или особый случай: решает владелец).
 * Идемпотентен: снятое второй раз не находится.
 *
 *   MONGO_URI=… MONGO_DB=… node backend/scripts/c103-own-types.js [--apply]
 *   На проде (запускает пользователь): bash remote-access/run-script.sh c103-own-types [--apply]  (--apply сам делает бэкап)
 */
const path = require('path');

const s = (v) => String(v ?? '').trim();

/** Чистая функция плана: { same: [{id, sku, name, code}], diff: [{id, sku, name, group, own, inherited}] }. */
function buildPlan({ products, cats }) {
  const byId = new Map(cats.map((c) => [String(c._id), c]));
  const inherited = (catId) => {
    const g = catId ? byId.get(String(catId)) : null;
    if (!g) return { code: '', group: '' };
    const sec = g.parentId ? byId.get(String(g.parentId)) : null;
    return { code: s(g.passportCategory) || s(sec?.passportCategory), group: s(g.name) };
  };
  const same = [], diff = [];
  for (const p of products) {
    const own = s(p.passportDefaults?.passportCategory);
    if (!own) continue;
    const inh = inherited(p.categoryId);
    const row = { id: String(p._id), sku: s(p.sku), name: s(p.name) };
    if (inh.code && inh.code === own) same.push({ ...row, code: own });
    else diff.push({ ...row, group: inh.group || '(без группы)', own, inherited: inh.code || '—' });
  }
  return { same, diff };
}

async function load() {
  const { MongoClient } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;
  const client = await new MongoClient(process.env.MONGO_URI).connect();
  const db = client.db(process.env.MONGO_DB || undefined);
  const [products, cats] = await Promise.all([
    db.collection('products').find({ deletedAt: null, 'passportDefaults.passportCategory': { $nin: [null, ''] } }, { projection: { sku: 1, name: 1, categoryId: 1, 'passportDefaults.passportCategory': 1 } }).toArray(),
    db.collection('categories').find({ type: 'product' }, { projection: { name: 1, parentId: 1, passportCategory: 1 } }).toArray(),
  ]);
  return { client, db, data: { products, cats } };
}

module.exports = { buildPlan };

if (!module.parent && !process.env.JEST_WORKER_ID) (async () => {
  const apply = process.argv.includes('--apply');
  const L = await load();
  try {
    const { same, diff } = buildPlan(L.data);
    console.log(`База ${L.db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    console.log(`свой тип паспорта у изделий: ${same.length + diff.length}; совпадает с группой (снять): ${same.length}; не совпадает (не трогаем): ${diff.length}`);
    if (diff.length) {
      console.log('\nНе совпадает с группой — решает владелец (перенести в нужную группу или задать вид изделия):');
      console.log('артикул | название | группа | своё → группы');
      for (const r of diff) console.log(`  ${r.sku} | ${r.name} | ${r.group} | ${r.own} → ${r.inherited}`);
    }
    if (!apply) { console.log('\nПЛАН. Запись — только с --apply.'); return; }
    const { ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;
    let n = 0;
    for (const r of same) {
      // снимаем, только если своё всё ещё то же (пока шёл разбор, могли поменять)
      const res = await L.db.collection('products').updateOne({ _id: new ObjectId(r.id), 'passportDefaults.passportCategory': r.code }, { $unset: { 'passportDefaults.passportCategory': '' }, $set: { updatedAt: new Date() } });
      n += res.modifiedCount;
    }
    console.log('ОТКАТ (сохранить): вернуть passportDefaults.passportCategory по списку: ' + same.map((r) => `${r.id}=${r.code}`).join(', '));
    console.log(`снято: ${n} из ${same.length}`);
  } finally { await L.client.close(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
