/* Болты с фото шайбы (пользователь 2026-11-06: «в базе болты с фотографией шайбы»).
 *
 * Найдено скриптом scripts/photo-dupes.mjs --sheet: у 6 позиций «Болт с шестигр. головкой, M10…, кп 8.8, DIN 933»
 * главное фото — плоская шайба (позиции идут в базе сразу за шайбами M10/M12 — фото сдвинулись при переносе каталога).
 * Исправление: у каждой из 6 позиций фото шайбы заменить фото болта того же ряда «M10х80, DIN 933».
 * Записи photos не удаляются (файл остаётся), меняется только ссылка materials.photoIds / mainPhotoId.
 * Пишет, только если у позиции всё ещё ровно это фото шайбы — ручная правка не затирается.
 *
 *   План:     MONGO_URI=… [MONGO_DB=…] node scripts/fix-bolt-photos.js
 *   Записать: … --apply [--out backup.json]
 *   Откат: для каждой записи выгрузки `materials.updateOne({ _id }, { $set: { photoIds, mainPhotoId } })` старыми значениями.
 */
const path = require('path');
const fs = require('fs');

/** Эталон: фото болта «M10х80, DIN 933» (материал 6ad52bf3863df73f344ea647). */
const GOOD = '6ad6ce0121977df51c55fe8e';
/** Позиция → фото шайбы, которое сейчас стоит. */
const WRONG = [
  ['6ad52bf4863df73f344ea713', '6ad6ce5b21977df51c55ff5e', 'M10х30, кп 8.8'],
  ['6ad52bf4863df73f344ea717', '6ad6ce5c21977df51c55ff62', 'M10х90, кп 8.8'],
  ['6ad52bf4863df73f344ea71b', '6ad6ce5e21977df51c55ff66', 'M10х100, кп 8.8'],
  ['6ad52bf4863df73f344ea71f', '6ad6ce5f21977df51c55ff6a', 'M10х110, кп 8.8'],
  ['6ad52bf4863df73f344ea723', '6ad6ce6021977df51c55ff6e', 'M10х120, кп 8.8'],
  ['6ad52bf4863df73f344ea727', '6ad6cf19a0db9be1ccbd72eb', 'M10х70, кп 8.8'],
];

/** Чистая функция: что поменять. materials — текущие документы (photoIds, mainPhotoId, name). */
function buildPlan(materials) {
  const byId = new Map(materials.map((m) => [String(m._id), m]));
  const plan = { change: [], skip: [] };
  for (const [id, bad, label] of WRONG) {
    const m = byId.get(id);
    const ids = ((m && m.photoIds) || []).map(String);
    if (!m) { plan.skip.push({ id, label, why: 'позиции нет' }); continue; }
    if (!ids.includes(bad)) { plan.skip.push({ id, label, why: 'фото шайбы уже нет — не трогаем' }); continue; }
    const next = [GOOD, ...ids.filter((p) => p !== bad && p !== GOOD)];
    plan.change.push({ id, label, name: m.name, oldPhotoIds: ids, oldMain: m.mainPhotoId ? String(m.mainPhotoId) : null, photoIds: next });
  }
  return plan;
}

async function applyPlan(db, plan, { ObjectId }) {
  let n = 0;
  for (const f of plan.change) {
    const ids = f.photoIds.map((x) => new ObjectId(x));
    const r = await db.collection('materials').updateOne({ _id: new ObjectId(f.id), deletedAt: null, photoIds: new ObjectId(WRONG.find((w) => w[0] === f.id)[1]) },
      { $set: { photoIds: ids, mainPhotoId: ids[0], updatedAt: new Date() } });
    n += r.modifiedCount;
  }
  return n;
}

function printPlan(plan, log = console.log) {
  log(`Заменить фото шайбы на фото болта: ${plan.change.length}`);
  for (const f of plan.change) log(`  ${f.label} — «${String(f.name || '').slice(0, 60)}»`);
  for (const s of plan.skip) log(`  пропуск ${s.label}: ${s.why}`);
}

module.exports = { buildPlan, applyPlan, printPlan, GOOD, WRONG };

if (require.main === module || String(module.id).includes('[stdin]')) (async () => {
  const uri = process.env.MONGO_URI;
  if (!uri) throw new Error('MONGO_URI не задан');
  const apply = process.argv.includes('--apply');
  const i = process.argv.indexOf('--out'); let outFile = i > 0 ? process.argv[i + 1] : null;
  if (apply && !outFile) outFile = '/tmp/fix-bolt-photos-' + Date.now() + '.json';
  const { MongoClient, ObjectId } = require(require.resolve('mongoose', { paths: [process.cwd(), path.join(__dirname, '..')] })).mongo;
  const client = await MongoClient.connect(uri);
  try {
    const db = client.db(process.env.MONGO_DB || undefined);
    console.log(`База ${db.databaseName} — ${apply ? 'ЗАПИСЬ' : 'ПЛАН, ничего не меняется'}`);
    const [good, materials] = await Promise.all([
      db.collection('photos').findOne({ _id: new ObjectId(GOOD) }, { projection: { _id: 1 } }),
      db.collection('materials').find({ _id: { $in: WRONG.map((w) => new ObjectId(w[0])) } }, { projection: { name: 1, photoIds: 1, mainPhotoId: 1 } }).toArray(),
    ]);
    if (!good) throw new Error('Фото-эталон болта не найдено — ничего не меняю');
    const plan = buildPlan(materials);
    printPlan(plan);
    if (outFile) { fs.writeFileSync(outFile, JSON.stringify({ at: new Date(), backup: plan.change.map((f) => ({ _id: f.id, photoIds: f.oldPhotoIds, mainPhotoId: f.oldMain })), plan }, null, 2)); console.log(`\nВыгрузка (для отката): ${outFile}`); }
    if (!apply) { console.log('\nНичего не записано. Записать: --apply'); return; }
    console.log(`\nГотово: заменено ${await applyPlan(db, plan, { ObjectId })}`);
  } finally { await client.close(); }
})().catch((e) => { console.error(e.message || e); process.exit(1); });
