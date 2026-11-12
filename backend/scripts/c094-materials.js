#!/usr/bin/env node
/**
 * C094: материал изделия для паспорта (`passportDefaults.materialIds`) — от него зависят признаки «металл» / «древесина» в условиях текстов.
 * Пустое поле заполняется выводом, неясное НЕ пишется (остаётся пустым — тогда в паспорте пункты на металл и дерево остаются, ничего не пропадает):
 *   1) по таблице материалов изделия (`materialsSpec`: части + покрытия) — материалы справочника «Материалы и покрытия» как есть;
 *   2) по названию — только явный металл (стальн / металлическ / «из стали» / труба) без слов дерева, материал «Сталь»;
 *   3) иначе — «неясно»: в таблице плана с причиной, не пишется.
 * Заполненное не меняется; изделия без умолчаний паспорта пропускаются. Перед записью «было» сверяется (изменили — стоп). Откат печатается в вывод. Выданные паспорта не меняются.
 *
 *   MONGO_URI=… MONGO_DB=… node backend/scripts/c094-materials.js [--apply]
 *   На проде: bash deploy/synology/c094-materials.sh [--apply]  (через remote-access/run-script.sh)
 *   Без базы: node backend/scripts/c094-materials.js --dump папка  (в папке products.json + d_passportMaterials.json; только план)
 */
const fs = require('fs');
const path = require('path');

const WOOD_WORDS = /дерев|бревн|лиственн|сосн|фанер|массив|древесин|(^|[^а-я])брус([^а-я]|$)/;
const METAL_WORDS = /стальн|металлическ|из стали|труб/;
const lower = (s) => String(s ?? '').toLowerCase().replace(/ё/g, 'е');
const idOf = (r) => String(r.id || r._id);

/** Чистая функция: изделие + справочник материалов → { ids[], why, state }. state: ok | filled | unclear. */
function derive(p, mats) {
  const cur = ((p.passportDefaults || {}).materialIds || []).map(String);
  if (cur.length) return { state: 'filled', ids: cur, why: 'уже заполнено' };
  const known = new Set(mats.map(idOf));
  const sp = p.materialsSpec || {};
  const fromSpec = [...(sp.rows || []).map((r) => String(r.materialId)), ...(sp.coatingIds || []).map(String)].filter((id) => known.has(id));
  const uniq = [...new Set(fromSpec)];
  if (uniq.length) return { state: 'ok', ids: uniq, why: 'по таблице материалов изделия' };
  const name = lower(`${p.name} ${p.orderName || ''}`);
  const steel = mats.find((m) => m.code === 'STEEL');
  if (steel && METAL_WORDS.test(name) && !WOOD_WORDS.test(name)) return { state: 'ok', ids: [idOf(steel)], why: 'по названию: металл' };
  return { state: 'unclear', ids: [], why: WOOD_WORDS.test(name) ? 'по названию дерево, порода неизвестна — выбрать вручную' : 'в названии и таблице материалов нет ответа' };
}

/** Строки плана для изделий, у которых материал пуст. */
function buildPlan(products, mats) {
  const names = new Map(mats.map((m) => [idOf(m), m.name]));
  // изделия без умолчаний паспорта (геопластика, услуги) не трогаем
  return products.filter((p) => p.passportDefaults).map((p) => ({ p, ...derive(p, mats) })).filter((r) => r.state !== 'filled').map((r) => ({
    _id: String(r.p._id), sku: String(r.p.sku), name: r.p.name, state: r.state, ids: r.ids, why: r.why,
    materials: r.ids.map((i) => names.get(i) || i).join(', '),
  }));
}

async function load() {
  const dump = process.argv.indexOf('--dump');
  if (dump > 0) {
    const dir = process.argv[dump + 1];
    const mats = JSON.parse(fs.readFileSync(path.join(dir, 'd_passportMaterials.json'), 'utf8')).items;
    return { products: JSON.parse(fs.readFileSync(path.join(dir, 'products.json'), 'utf8')), mats, db: null };
  }
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname || process.cwd(), '..')] })).mongo;
  const client = await new MongoClient(process.env.MONGO_URI).connect();
  const db = client.db(process.env.MONGO_DB || 'datacore');
  const mats = (await db.collection('dict_values').find({ dict: 'passportMaterials', deletedAt: null }).toArray()).map((m) => ({ ...m, id: String(m._id) }));
  const products = (await db.collection('products').find({ deletedAt: null }).project({ sku: 1, name: 1, orderName: 1, materialsSpec: 1, passportDefaults: 1 }).toArray());
  return { products, mats, db, client, ObjectId };
}

module.exports = { derive, buildPlan };

if (!module.parent && !process.env.JEST_WORKER_ID) (async () => {
  const apply = process.argv.includes('--apply');
  const L = await load();
  try {
    const plan = buildPlan(L.products, L.mats);
    console.log(`${L.db ? 'База ' + L.db.databaseName : 'Выгрузка'} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    console.log('изделие | материал | почему');
    for (const r of plan) console.log(`${r.state === 'ok' ? '  +' : '  ?'} ${r.sku.padEnd(10)} ${String(r.name).slice(0, 38).padEnd(38)} | ${r.materials || '—'} | ${r.why}`);
    const ok = plan.filter((r) => r.state === 'ok');
    console.log(`\nпустых ${plan.length}: к записи ${ok.length}, неясно ${plan.length - ok.length} (не пишутся)`);
    if (!apply) { console.log('ПЛАН. Запись — только с --apply.'); return; }
    if (!L.db) throw new Error('--apply нужна база (MONGO_URI), не --dump');
    const col = L.db.collection('products');
    const bad = [];
    for (const r of ok) { const p = await col.findOne({ _id: L.products.find((x) => String(x._id) === r._id)._id }, { projection: { 'passportDefaults.materialIds': 1 } }); if (!p || ((p.passportDefaults || {}).materialIds || []).length) bad.push(r.sku); }
    if (bad.length) throw new Error('база изменилась, материал уже заполнен: ' + bad.join(', '));
    console.log('ОТКАТ (сохранить): снять passportDefaults.materialIds у ' + ok.map((r) => r.sku).join(', '));
    for (const r of ok) await col.updateOne({ _id: L.products.find((x) => String(x._id) === r._id)._id }, { $set: { 'passportDefaults.materialIds': r.ids.map((i) => new L.ObjectId(i)), updatedAt: new Date() } });
    console.log('записано: ' + ok.length);
  } finally { if (L.client) await L.client.close(); }
})().catch((e) => { console.error(e.message); process.exit(2); });
