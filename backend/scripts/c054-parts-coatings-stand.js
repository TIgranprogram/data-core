/**
 * C054-P: применить categories из планов частей/покрытий.
 *   MONGO_URI=… node scripts/c054-parts-coatings-stand.js [--seed-from-dump] [--apply]
 * Без --apply — только отчёт. --seed-from-dump подставляет записи из docs/crew/C054-…/data,
 * если в БД нет passportParts (локальный пустой стенд). Новые 29 частей не создаёт.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const ROOT = path.resolve(__dirname, '../..');
const PARTS_PLAN = path.join(ROOT, 'docs/crew/C054-passport-funnel/parts-categories-plan.json');
const COATS_PLAN = path.join(ROOT, 'docs/crew/C054-passport-funnel/coatings-categories-plan.json');
const PARTS_DUMP = path.join(ROOT, 'docs/crew/C054-passport-funnel/data/dict-passportParts.json');
const MATS_DUMP = path.join(ROOT, 'docs/crew/C054-passport-funnel/data/dict-passportMaterials-full.json');

const apply = process.argv.includes('--apply');
const seed = process.argv.includes('--seed-from-dump');

function items(x) {
  return Array.isArray(x) ? x : (x.items || []);
}

function norm(s) {
  return String(s || '').replace(/\s+/g, '');
}

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('нужен MONGO_URI');
  await mongoose.connect(uri);
  const col = mongoose.connection.db.collection('dict_values');
  const { ObjectId } = mongoose.Types;

  if (seed) {
    const nParts = await col.countDocuments({ dict: 'passportParts', deletedAt: null });
    if (nParts === 0) {
      const now = new Date();
      const docs = [];
      for (const [file, dict] of [[PARTS_DUMP, 'passportParts'], [MATS_DUMP, 'passportMaterials']]) {
        for (const r of items(JSON.parse(fs.readFileSync(file, 'utf8')))) {
          const id = String(r.id || r._id);
          const { id: _i, _id, ...rest } = r;
          docs.push({ ...rest, _id: new ObjectId(id), dict, deletedAt: null, updatedAt: now, createdAt: rest.createdAt ? new Date(rest.createdAt) : now });
        }
      }
      if (docs.length) await col.insertMany(docs, { ordered: false }).catch((e) => {
        if (e.code !== 11000) throw e;
      });
      console.log(`seed: вставлено до ${docs.length} записей из выгрузки`);
    } else {
      console.log(`seed: пропуск — уже есть ${nParts} passportParts`);
    }
  }

  const plans = [
    ...JSON.parse(fs.readFileSync(PARTS_PLAN, 'utf8')).map((x) => ({ ...x, dict: 'passportParts' })),
    ...JSON.parse(fs.readFileSync(COATS_PLAN, 'utf8')).map((x) => ({ ...x, dict: 'passportMaterials' })),
  ];

  let ok = 0, skip = 0, miss = 0, bad = 0;
  for (const x of plans) {
    const doc = await col.findOne({ _id: new ObjectId(x.id), dict: x.dict });
    if (!doc) { console.log(`✗ нет ${x.dict} ${x.name || x.id}`); miss++; continue; }
    if (norm(doc.categories) === norm(x.categories)) { skip++; continue; }
    if (!apply) { console.log(`· будет: ${x.dict} ${x.name} «${doc.categories || ''}» → «${x.categories}»`); ok++; continue; }
    const r = await col.updateOne({ _id: doc._id }, { $set: { categories: x.categories, updatedAt: new Date() } });
    if (r.modifiedCount) { console.log(`✓ ${x.dict} ${x.name} → ${x.categories}`); ok++; }
    else { console.log(`✗ не записалось ${x.name}`); bad++; }
  }
  console.log(`Итог${apply ? '' : ' (план)'}: изменить/изменено ${ok}, уже так ${skip}, нет ${miss}, ошибок ${bad}`);
  await mongoose.disconnect();
  if (miss || bad) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
