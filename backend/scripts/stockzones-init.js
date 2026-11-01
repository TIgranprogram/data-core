#!/usr/bin/env node
/**
 * Склады-зоны (WZ-6): создаёт три склада справочника `stockzones` и переносит у ролей `stockCategoryIds` -> `warehouseIds`.
 *   «Основной» (isDefault) — все категории материалов, кроме профильной трубы и листового металла (+ позиции без категории);
 *   «Профильная труба»; «Листовой материал». Категории ищутся по названию среди `categories` type=material (с подкатегориями).
 *
 *   MONGO_URI=… [MONGO_DB=datacore] node scripts/stockzones-init.js                       - ПЛАН, ничего не пишет
 *   MONGO_URI=… [MONGO_DB=datacore] node scripts/stockzones-init.js --apply [--out откат.json]  - запись + файл отката (по умолчанию /tmp)
 *   MONGO_URI=… [MONGO_DB=datacore] node scripts/stockzones-init.js --undo откат.json     - вернуть роли и убрать созданные склады
 *
 * Повторный запуск безопасен: склад с таким названием уже есть - не трогается; роль со `warehouseIds` пропускается.
 * Роль, чьи категории не покрыты складами, остаётся на старом пути `stockCategoryIds` (в плане - предупреждение).
 * Новая категория материалов после запуска ни в одном складе не числится - её отмечают в «Справочники - Склады».
 * Прод - только по решению пользователя (запись), план читать можно.
 */
const fs = require('fs');

const PIPE_RE = /профильн/i; // «Профильная труба»
const SHEET_RE = /листов/i; // «Листовой металл» / «Листовой материал»

const sid = (v) => (v == null ? '' : String(v));

/** Все потомки (включая саму) по дереву categories. */
function subtree(cats, rootIds) {
  const out = new Set(rootIds.map(sid));
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of cats) if (!out.has(sid(c._id)) && c.parentId && out.has(sid(c.parentId))) { out.add(sid(c._id)); grew = true; }
  }
  return out;
}

/** Предки категорий (родитель, родитель родителя...). */
function ancestors(cats, ids) {
  const byId = new Map(cats.map((c) => [sid(c._id), c]));
  const out = new Set();
  for (const id of ids) for (let cur = byId.get(sid(id))?.parentId, d = 0; cur && d < 30; cur = byId.get(sid(cur))?.parentId, d++) out.add(sid(cur));
  return out;
}

/**
 * Чистая: какие склады создать и что сделать с ролями. `cats` — живые категории материалов; `zones` — уже существующие склады;
 * `roles` — роли ({name, stockCategoryIds, warehouseIds}). Возвращает { zones: [{name, categoryIds, isDefault, order, exists}], roles: [{name, warehouseNames, skip?}], warnings }.
 */
function planZones(cats, zones, roles) {
  const warnings = [];
  const roots = (re) => cats.filter((c) => re.test(String(c.name ?? ''))).map((c) => c._id);
  const pipeRoots = roots(PIPE_RE), sheetRoots = roots(SHEET_RE);
  if (!pipeRoots.length) warnings.push('Категория «профильная труба» не найдена - склад «Профильная труба» не создаётся');
  if (!sheetRoots.length) warnings.push('Категория «листовой металл» не найдена - склад «Листовой материал» не создаётся');
  const pipe = subtree(cats, pipeRoots), sheet = subtree(cats, sheetRoots);
  const banned = new Set([...pipe, ...sheet]);
  const above = ancestors(cats, [...banned]); // родитель трубы/листа тянул бы их в «Основной» через потомков
  const main = cats.map((c) => sid(c._id)).filter((id) => !banned.has(id) && !above.has(id));
  const wanted = [
    { name: 'Основной', categoryIds: main, isDefault: true, order: 10 },
    ...(pipeRoots.length ? [{ name: 'Профильная труба', categoryIds: pipeRoots.map(sid), isDefault: false, order: 20 }] : []),
    ...(sheetRoots.length ? [{ name: 'Листовой материал', categoryIds: sheetRoots.map(sid), isDefault: false, order: 30 }] : []),
  ];
  const have = new Map(zones.map((z) => [String(z.name).trim().toLowerCase(), z]));
  const plan = wanted.map((z) => ({ ...z, exists: have.has(z.name.toLowerCase()) }));
  // категории каждого склада с потомками - для переноса ролей
  const all = plan.map((z) => ({ name: z.name, set: subtree(cats, z.categoryIds) }));
  const rolePlan = [];
  for (const r of roles) {
    const own = (r.stockCategoryIds ?? []).map(sid);
    if (!own.length) continue;
    if (r.warehouseIds?.length) { rolePlan.push({ name: r.name, skip: 'склады уже выбраны' }); continue; }
    const mine = subtree(cats, own);
    const hit = all.filter((z) => [...mine].some((id) => z.set.has(id)));
    const covered = own.every((id) => hit.some((z) => z.set.has(id)));
    if (!hit.length || !covered) {
      warnings.push(`Роль «${r.name}»: категории не покрыты складами - остаётся на старом пути stockCategoryIds`);
      rolePlan.push({ name: r.name, skip: 'категории не покрыты складами' });
      continue;
    }
    // склад, лишний для роли (в нём больше, чем у роли), - предупреждение: роль получит больше, чем имела
    const wide = hit.filter((z) => [...z.set].some((id) => !mine.has(id)));
    if (wide.length) warnings.push(`Роль «${r.name}»: склады ${wide.map((z) => '«' + z.name + '»').join(', ')} шире её прежних категорий`);
    rolePlan.push({ name: r.name, warehouseNames: hit.map((z) => z.name) });
  }
  return { zones: plan, roles: rolePlan, warnings };
}

async function main() {
  let MongoClient;
  try { ({ MongoClient } = require('mongodb')); } catch { MongoClient = require('mongoose').mongo.MongoClient; }
  const argv = process.argv.slice(2);
  const val = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : undefined);
  const apply = argv.includes('--apply'), undo = val('--undo');
  const out = val('--out') && !val('--out').startsWith('--') ? val('--out') : `/tmp/stockzones-undo-${Date.now()}.json`; // без --out - выгрузка для отката в /tmp
  if (!process.env.MONGO_URI) { console.error('Нужна переменная MONGO_URI'); process.exit(2); }
  const client = await MongoClient.connect(process.env.MONGO_URI);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База: ${db.databaseName}`);
    if (undo) {
      const back = JSON.parse(fs.readFileSync(undo, 'utf8'));
      for (const r of back.roles) await db.collection('roles').updateOne({ name: r.name }, { $set: { stockCategoryIds: r.stockCategoryIds }, $unset: { warehouseIds: '' } });
      const ids = back.createdZoneIds.map((x) => new (require('mongoose').Types.ObjectId)(x));
      await db.collection('stockzones').updateMany({ _id: { $in: ids } }, { $set: { deletedAt: new Date() } });
      console.log(`Откат: ролей ${back.roles.length}, складов убрано ${ids.length}`);
      return;
    }
    const cats = await db.collection('categories').find({ type: 'material', deletedAt: null }, { projection: { name: 1, parentId: 1 } }).toArray();
    const zones = await db.collection('stockzones').find({ deletedAt: null }).toArray();
    const roles = await db.collection('roles').find({}, { projection: { name: 1, stockCategoryIds: 1, warehouseIds: 1 } }).toArray();
    const counts = new Map((await db.collection('materials').aggregate([{ $match: { deletedAt: null } }, { $group: { _id: '$categoryId', n: { $sum: 1 } } }]).toArray()).map((x) => [sid(x._id), x.n]));
    const plan = planZones(cats, zones, roles);
    const name = new Map(cats.map((c) => [sid(c._id), c.name]));
    console.log(apply ? '\nЗАПИСЬ' : '\nПЛАН, ничего не меняется');
    for (const z of plan.zones) {
      const pos = [...subtree(cats, z.categoryIds)].reduce((s, id) => s + (counts.get(id) ?? 0), 0) + (z.isDefault ? counts.get('null') ?? 0 : 0);
      console.log(`  склад «${z.name}»${z.isDefault ? ' (основной, + позиции без категории)' : ''}: ${z.exists ? 'уже есть - не трогаю' : 'создать'}; категорий ${z.categoryIds.length}, позиций ~${pos}`);
      console.log(`      ${z.categoryIds.map((id) => name.get(id)).join(', ')}`);
    }
    for (const r of plan.roles) console.log(`  роль «${r.name}»: ${r.skip ? 'пропуск - ' + r.skip : 'склады ' + r.warehouseNames.map((n) => '«' + n + '»').join(', ')}`);
    if (!plan.roles.length) console.log('  ролей со старыми категориями склада нет');
    for (const w of plan.warnings) console.log(`  ВНИМАНИЕ: ${w}`);
    if (!apply) return;

    const { Types } = require('mongoose');
    const now = new Date();
    const ids = new Map(zones.map((z) => [String(z.name).trim().toLowerCase(), z._id]));
    const created = [];
    for (const z of plan.zones) {
      if (z.exists) continue;
      const _id = new Types.ObjectId();
      await db.collection('stockzones').insertOne({ _id, name: z.name, categoryIds: z.categoryIds.map((x) => new Types.ObjectId(x)), includeMaterialIds: [], excludeMaterialIds: [], isDefault: z.isDefault, order: z.order, deletedAt: null, createdAt: now, updatedAt: now });
      ids.set(z.name.toLowerCase(), _id);
      created.push(String(_id));
    }
    const backup = { at: now.toISOString(), db: db.databaseName, createdZoneIds: created, roles: [] };
    for (const r of plan.roles) {
      if (r.skip) continue;
      const before = roles.find((x) => x.name === r.name);
      backup.roles.push({ name: r.name, stockCategoryIds: before.stockCategoryIds ?? [] });
      await db.collection('roles').updateOne({ name: r.name }, { $set: { warehouseIds: r.warehouseNames.map((n) => String(ids.get(n.toLowerCase()))) }, $unset: { stockCategoryIds: '' } });
    }
    fs.writeFileSync(out, JSON.stringify(backup, null, 2));
    console.log(`Готово: складов создано ${created.length}, ролей перенесено ${backup.roles.length}. Откат: ${out}`);
    console.log('Склады сервер подхватит за минуту, роли - при перезапуске сервера.');
  } finally { await client.close(); }
}

if (require.main === module || String(module.id).includes('[stdin]')) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { planZones, subtree, ancestors };
