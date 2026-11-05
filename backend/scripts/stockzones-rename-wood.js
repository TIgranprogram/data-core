#!/usr/bin/env node
/**
 * СКЛ-1: склад «Плитные материалы» → «Деревообработка», в него добавляется категория «Дерево»,
 * роль «Кладовщик плит (телефон)» → «Кладовщик дерева (телефон)».
 *
 *   MONGO_URI=… [MONGO_DB=datacore] node scripts/stockzones-rename-wood.js          — ПЛАН (ничего не пишет)
 *   BACKUP_DIR=… MONGO_URI=… node scripts/stockzones-rename-wood.js --apply         — запись (нужен бэкап не старше 24 ч)
 *
 * Идемпотентно. Id зоны и роли не меняются (ссылки целы). Прод — только по решению пользователя.
 */
const path = require('path');
const mongoose = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] }));
const { backupFresh } = require('./lib/backup-fresh');
const { MongoClient } = mongoose.mongo;

const OLD_ZONE = 'Плитные материалы';
const NEW_ZONE = 'Деревообработка';
const OLD_ROLE = 'Кладовщик плит (телефон)';
const NEW_ROLE = 'Кладовщик дерева (телефон)';

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
    const roles = db.collection('roles');
    const now = new Date();
    const plan = { apply, db: dbName, zone: null, wood: null, role: null, notes: [] };

    const old = await zones.findOne({ name: OLD_ZONE, deletedAt: null });
    const fresh = await zones.findOne({ name: NEW_ZONE, deletedAt: null });
    if (old && fresh) plan.notes.push(`Есть обе зоны «${OLD_ZONE}» и «${NEW_ZONE}» — переименование пропущено, разберите вручную`);
    const zone = fresh || old;
    if (!zone) plan.notes.push(`Зоны «${OLD_ZONE}» / «${NEW_ZONE}» нет — менять нечего`);
    else {
      plan.zone = { id: String(zone._id), name: zone.name, rename: !!old && !fresh };
      const wood = await db.collection('categories').findOne({ type: 'material', name: 'Дерево', deletedAt: null });
      if (!wood) plan.notes.push('Категории «Дерево» нет — в зону добавить нечего');
      else {
        const has = (zone.categoryIds || []).some((x) => String(x) === String(wood._id));
        plan.wood = { id: String(wood._id), addToZone: !has };
        if (apply && !has) await zones.updateOne({ _id: zone._id }, { $addToSet: { categoryIds: wood._id }, $set: { updatedAt: now } });
      }
      if (apply && old && !fresh) await zones.updateOne({ _id: old._id }, { $set: { name: NEW_ZONE, updatedAt: now } });
    }

    const oldRole = await roles.findOne({ name: OLD_ROLE, deletedAt: null });
    const newRole = await roles.findOne({ name: NEW_ROLE, deletedAt: null });
    if (oldRole && newRole) plan.notes.push(`Есть обе роли «${OLD_ROLE}» и «${NEW_ROLE}» — роль пропущена`);
    else if (oldRole) {
      plan.role = { id: String(oldRole._id), rename: `${OLD_ROLE} → ${NEW_ROLE}` };
      if (apply) await roles.updateOne({ _id: oldRole._id }, { $set: { name: NEW_ROLE, updatedAt: now } });
    } else plan.notes.push(newRole ? 'Роль уже переименована' : `Роли «${OLD_ROLE}» нет`);

    console.log(JSON.stringify(plan, null, 2));
    console.log(apply ? 'Готово.' : 'Это план. Для записи: BACKUP_DIR=… и --apply (на проде — только с разрешения).');
  } finally {
    await client.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
