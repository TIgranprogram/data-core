#!/usr/bin/env node
/**
 * Склад «Деревообработка» (бывш. «Плитные материалы»; фанера, ДСП, ДВП, OSB, МДФ) — отдельно от «Листовой материал» (металл).
 *
 *   MONGO_URI=… [MONGO_DB=datacore] node scripts/stockzones-boards.js            — ПЛАН
 *   MONGO_URI=… node scripts/stockzones-boards.js --apply                        — запись
 *
 * Создаёт/дополняет категории под «Дерево», склад stockzones, роль «Кладовщик дерева (телефон)»
 * (appSections: stock-mobile, warehouseIds: этот склад, baseRole: manager).
 * Категории плит убирает из «Основной», чтобы другие кладовщики их не видели.
 * Прод — только по решению пользователя.
 */
const path = require('path');
const mongoose = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] }));
const { MongoClient, ObjectId } = mongoose.mongo;

const ZONE = 'Деревообработка'; // было «Плитные материалы» (СКЛ-1, stockzones-rename-wood.js)
const ROLE = 'Кладовщик дерева (телефон)';
const BOARD_CATS = [
  { name: 'Фанера', slug: 'plywood', skuPrefix: 'PLY' },
  { name: 'ДСП', slug: 'chipboard', skuPrefix: 'CHIP' },
  { name: 'ДВП', slug: 'fiberboard', skuPrefix: 'FIB' },
  { name: 'OSB', slug: 'osb', skuPrefix: 'OSB' },
  { name: 'МДФ', slug: 'mdf', skuPrefix: 'MDF' },
];

async function main() {
  const apply = process.argv.includes('--apply');
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('Нужен MONGO_URI'); process.exit(2); }
  const dbName = process.env.MONGO_DB || 'datacore';
  const client = await MongoClient.connect(uri, { ignoreUndefined: true });
  const db = client.db(dbName);
  const cats = db.collection('categories');
  const zones = db.collection('stockzones');
  const roles = db.collection('roles');

  let wood = await cats.findOne({ type: 'material', name: 'Дерево', deletedAt: null });
  const plan = { createWood: !wood, categories: [], zone: null, trimMain: false, role: null, warnings: [] };

  if (!wood && apply) {
    const ins = await cats.insertOne({
      name: 'Дерево', slug: 'wood', type: 'material', parentId: null, isActive: true,
      skuPrefix: 'WOOD', sortOrder: 50, createdAt: new Date(), updatedAt: new Date(),
    });
    wood = { _id: ins.insertedId, name: 'Дерево' };
  }
  if (!wood) plan.warnings.push('Нет категории «Дерево» — в плане; --apply создаст');

  const boardIds = [];
  for (const c of BOARD_CATS) {
    let doc = wood
      ? await cats.findOne({ type: 'material', name: c.name, parentId: wood._id, deletedAt: null })
      : null;
    if (!doc && wood) doc = await cats.findOne({ type: 'material', name: c.name, deletedAt: null });
    if (doc) {
      plan.categories.push({ name: c.name, id: String(doc._id), exists: true });
      boardIds.push(doc._id);
    } else {
      plan.categories.push({ name: c.name, exists: false, parent: 'Дерево' });
      if (apply && wood) {
        const ins = await cats.insertOne({
          name: c.name, slug: c.slug, type: 'material', parentId: wood._id, isActive: true,
          skuPrefix: c.skuPrefix, sortOrder: 10, createdAt: new Date(), updatedAt: new Date(),
        });
        boardIds.push(ins.insertedId);
      }
    }
  }

  let zone = await zones.findOne({ name: ZONE, deletedAt: null });
  if (zone) plan.zone = { name: ZONE, id: String(zone._id), exists: true, categoryIds: (zone.categoryIds || []).map(String) };
  else {
    plan.zone = { name: ZONE, exists: false, categoryIds: boardIds.map(String), order: 40 };
    if (apply && boardIds.length) {
      const ins = await zones.insertOne({
        name: ZONE, categoryIds: boardIds, includeMaterialIds: [], excludeMaterialIds: [],
        isDefault: false, order: 40, createdAt: new Date(), updatedAt: new Date(),
      });
      zone = { _id: ins.insertedId };
      plan.zone.id = String(ins.insertedId);
    }
  }
  if (zone && apply && boardIds.length) {
    await zones.updateOne({ _id: zone._id }, { $addToSet: { categoryIds: { $each: boardIds } }, $set: { updatedAt: new Date() } });
  }

  const mainZ = await zones.findOne({ isDefault: true, deletedAt: null });
  if (mainZ && boardIds.length) {
    const before = (mainZ.categoryIds || []).map(String);
    const remove = new Set(boardIds.map(String));
    // также убрать «Дерево», если целиком уходит в плиты
    if (wood) remove.add(String(wood._id));
    const after = before.filter((id) => !remove.has(id));
    plan.trimMain = { zone: mainZ.name, remove: [...remove], from: before.length, to: after.length };
    if (apply && after.length !== before.length) {
      await zones.updateOne({ _id: mainZ._id }, { $set: { categoryIds: after.map((id) => new ObjectId(id)), updatedAt: new Date() } });
    }
  } else plan.warnings.push('Склад «Основной» не найден — категории плит не вычтены');

  let role = await roles.findOne({ name: ROLE, deletedAt: null });
  if (role) plan.role = { name: ROLE, exists: true, id: String(role._id) };
  else {
    plan.role = { name: ROLE, exists: false, appSections: ['stock-mobile'], baseRole: 'manager' };
    if (apply && zone) {
      const ins = await roles.insertOne({
        name: ROLE, baseRole: 'manager', appSections: ['stock-mobile'],
        warehouseIds: [zone._id], money: false, isActive: true,
        createdAt: new Date(), updatedAt: new Date(),
      });
      plan.role.id = String(ins.insertedId);
    }
  }
  if (role && apply && zone) {
    await roles.updateOne({ _id: role._id }, {
      $set: { appSections: ['stock-mobile'], baseRole: 'manager', warehouseIds: [zone._id], updatedAt: new Date() },
    });
  }

  console.log(JSON.stringify({ apply, db: dbName, ...plan }, null, 2));
  console.log(apply
    ? 'Готово. Назначьте сотруднику роль «Кладовщик дерева (телефон)» в админке и задайте пароль.'
    : 'Это план. Для записи: --apply (на проде — только с разрешения).');
  await client.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
