#!/usr/bin/env node
/**
 * СКЛ-1: слить склады-зоны «Профильная труба» и «Трубы» в одну «Трубы».
 *
 *   MONGO_URI=… [MONGO_DB=datacore] node scripts/stockzones-merge-pipes.js          — ПЛАН (ничего не пишет)
 *   BACKUP_DIR=… MONGO_URI=… node scripts/stockzones-merge-pipes.js --apply         — запись (нужен бэкап не старше 24 ч)
 *
 * Что делает: «Трубы» — categoryIds / includeMaterialIds / excludeMaterialIds объединяются; «Профильная труба»
 * мягко удаляется (deletedAt); её id в roles.warehouseIds и materialrequests.zoneId заменяется на «Трубы».
 * Позиции и категории не трогаются. Повторный запуск ничего не меняет. Прод — только по решению пользователя.
 */
const path = require('path');
const mongoose = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] }));
const { backupFresh } = require('./lib/backup-fresh');
const { MongoClient } = mongoose.mongo;

const KEEP = 'Трубы';
const DROP = 'Профильная труба';
const union = (a, b) => {
  const seen = new Set(); const out = [];
  for (const x of [...(a || []), ...(b || [])]) { const k = String(x); if (!seen.has(k)) { seen.add(k); out.push(x); } }
  return out;
};

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('Нужен MONGO_URI'); process.exit(2); }
  if (apply) {
    const b = backupFresh();
    if (!b.ok) { console.error('Запись остановлена: ' + b.text); process.exit(2); }
    console.log(b.text);
  }
  const dbName = process.env.MONGO_DB || 'datacore';
  const client = await MongoClient.connect(uri, { ignoreUndefined: true });
  try {
    const db = client.db(dbName);
    const zones = db.collection('stockzones');
    const keep = await zones.findOne({ name: KEEP, deletedAt: null });
    const drop = await zones.findOne({ name: DROP, deletedAt: null });
    const plan = { apply, db: dbName, keep: null, drop: null, rolesAffected: 0, requestsAffected: 0, notes: [] };

    if (!drop) plan.notes.push(`Зоны «${DROP}» нет (или уже удалена) — менять нечего`);
    if (!keep && drop) plan.notes.push(`Зоны «${KEEP}» нет — слить не во что; будет переименована «${DROP}» в «${KEEP}»`);
    if (!keep && !drop) plan.notes.push('Обе зоны не найдены');

    if (keep && drop) {
      const cats = union(keep.categoryIds, drop.categoryIds);
      const inc = union(keep.includeMaterialIds, drop.includeMaterialIds);
      const exc = union(keep.excludeMaterialIds, drop.excludeMaterialIds);
      plan.keep = { id: String(keep._id), categoryIds: { было: (keep.categoryIds || []).length, стало: cats.length }, includeMaterialIds: inc.length, excludeMaterialIds: exc.length };
      plan.drop = { id: String(drop._id), softDelete: true };
      plan.rolesAffected = await db.collection('roles').countDocuments({ warehouseIds: drop._id });
      plan.requestsAffected = await db.collection('materialrequests').countDocuments({ zoneId: drop._id });
      if (apply) {
        const now = new Date();
        await zones.updateOne({ _id: keep._id }, { $set: { categoryIds: cats, includeMaterialIds: inc, excludeMaterialIds: exc, updatedAt: now } });
        // роль: убрать id удалённой зоны, добавить «Трубы» (без дублей)
        const roles = await db.collection('roles').find({ warehouseIds: drop._id }).toArray();
        for (const r of roles) {
          const ids = union((r.warehouseIds || []).filter((x) => String(x) !== String(drop._id)), [keep._id]);
          await db.collection('roles').updateOne({ _id: r._id }, { $set: { warehouseIds: ids, updatedAt: now } });
        }
        await db.collection('materialrequests').updateMany({ zoneId: drop._id }, { $set: { zoneId: keep._id, updatedAt: now } });
        await zones.updateOne({ _id: drop._id }, { $set: { deletedAt: now, updatedAt: now } });
      }
    } else if (!keep && drop && apply) {
      await zones.updateOne({ _id: drop._id }, { $set: { name: KEEP, updatedAt: new Date() } });
    }

    console.log(JSON.stringify(plan, null, 2));
    console.log(apply ? 'Готово.' : 'Это план. Для записи: BACKUP_DIR=… и --apply (на проде — только с разрешения).');
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
